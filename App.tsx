import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Modal, Pressable, SafeAreaView, StatusBar, StyleSheet, Text, View } from "react-native";
import * as Updates from "expo-updates";
import * as Notifications from "expo-notifications";

import type { Host } from "./src/lib/host-logic";
import { normalizeHostUrl, resolveStartupHost } from "./src/lib/host-logic";
import { deleteHost, listHosts, markHostUsed, renameHost } from "./src/lib/hosts";
import { configurePushNotifications, ensurePushRegistered, extractBotTarget, setVisibleBot } from "./src/lib/push";
import { fetchMobileRelease, installAndroidRelease, isNewerMobileRelease, type MobileRelease } from "./src/lib/mobile-release";
import AddHostScreen from "./src/screens/AddHostScreen";
import HostManagerScreen from "./src/screens/HostManagerScreen";
import WebViewScreen from "./src/screens/WebViewScreen";

// No navigation library: three screens, switched by local state. Adding
// react-navigation for this would be an unrequested abstraction — bring it
// in when a fourth screen or deep-link routing actually needs it.
type Route =
  | { name: "firstrun"; initialUrl?: string }
  | { name: "hosts" }
  | { name: "webview"; host: Host; botId?: string };

export default function App() {
  const [route, setRoute] = useState<Route>({ name: "firstrun" });
  const [hosts, setHosts] = useState<Host[]>([]);
  const hostsRef = useRef<Host[]>([]);
  // Przy pierwszym załadowaniu otwieramy ostatnio używanego hosta. Lista hostów
  // pozostaje dostępna po cofnięciu z WebView i z jego paska hosta.
  const didInit = useRef(false);
  const [loading, setLoading] = useState(true);

  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [downloadingUpdate, setDownloadingUpdate] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [mobileRelease, setMobileRelease] = useState<MobileRelease | null>(null);

  const refresh = useCallback(() => {
    void listHosts().then((h) => {
      setHosts(h);
      setLoading(false);
      if (!didInit.current && h.length >= 1) {
        didInit.current = true;
        const startup = resolveStartupHost(h);
        if (startup) setRoute({ name: "webview", host: startup });
      }
    });
  }, []);

  const openHost = useCallback((host: Host) => {
    const usedAt = Date.now();
    const updated = { ...host, lastUsedAt: usedAt };
    void markHostUsed(host.id, usedAt).catch(() => {}).then(() => {
      setHosts((current) => [updated, ...current.filter((item) => item.id !== host.id)].sort((a, b) => b.lastUsedAt - a.lastUsedAt));
      setRoute({ name: "webview", host: updated });
    });
  }, []);

  const openHostManager = useCallback(() => {
    void refresh();
    setRoute({ name: "hosts" });
  }, [refresh]);

  const removeStoredHost = useCallback(async (hostId: string) => {
    await deleteHost(hostId);
    const remaining = (await listHosts());
    setHosts(remaining);
    if (!remaining.length) {
      didInit.current = false;
      setRoute({ name: "firstrun" });
    } else {
      setRoute({ name: "hosts" });
    }
  }, []);

  const renameStoredHost = useCallback(async (hostId: string, name: string) => {
    await renameHost(hostId, name);
    const updated = await listHosts();
    setHosts(updated);
    setRoute((current) => current.name === "webview" && current.host.id === hostId
      ? { ...current, host: updated.find((host) => host.id === hostId) ?? current.host }
      : current);
  }, []);

  useEffect(refresh, [refresh]);

  useEffect(() => {
    hostsRef.current = hosts;
  }, [hosts]);

  // Push: stuknięcie w powiadomienie ma otworzyć WebView właściwego hosta
  // (przewinięty do bota). O zgodę na powiadomienia nie pytamy tutaj —
  // robi to rejestracja niżej, czyli dopiero wtedy, gdy jest host, któremu
  // można oddać token. Dwa równoległe pytania o to samo uprawnienie potrafią
  // się zablokować nawzajem.
  useEffect(() => {
    configurePushNotifications();

    const openFromTarget = (target: ReturnType<typeof extractBotTarget>) => {
      if (!target.hostUrl) {
        // Bez adresu hosta otwieramy ostatnio używanego hosta.
        const existing = resolveStartupHost(hostsRef.current);
        // `botId` przekazujemy TAKŻE tutaj — serwer nie wysyła `hostUrl`, więc
        // bez tego tapnięcie otwierało aplikację, ale nie tego bota.
        if (existing) setRoute({ name: "webview", host: existing, botId: target.botId });
        return;
      }
      let normalized: string;
      try {
        normalized = normalizeHostUrl(target.hostUrl);
      } catch {
        return;
      }
      const host = hostsRef.current.find((h) => h.url === normalized);
      if (host) setRoute({ name: "webview", host, botId: target.botId });
    };

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      openFromTarget(extractBotTarget(response.notification.request.content.data));
    });

    void Notifications.getLastNotificationResponseAsync().then((last) => {
      if (last) openFromTarget(extractBotTarget(last.notification.request.content.data));
    });

    return () => sub.remove();
  }, []);

  // Rejestracja tokenu push na hoście. Serwer wysyła powiadomienia wyłącznie
  // na tokeny, które sam dostał trasą `POST /api/devices/:id/push` — bez tego
  // kroku jego lista urządzeń zostaje pusta i telefon nie dostaje NIC, mimo że
  // reszta łańcucha (wyzwalacz `needsAttention`, wysyłka do exp.host) działa.
  // Ponawiamy przy każdym powrocie aplikacji na wierzch, bo pierwsza próba
  // pada, kiedy telefon jest chwilowo poza siecią hosta (np. sieć jeszcze
  // nie wstał), a wtedy jedna nieudana próba uciszyłaby powiadomienia na stałe.
  useEffect(() => {
    const host = hosts[0];
    if (!host) return;
    void ensurePushRegistered(host);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void ensurePushRegistered(host);
    });
    return () => sub.remove();
  }, [hosts]);

  const checkForUpdate = useCallback(async (showError = false) => {
    if (checkingUpdate || downloadingUpdate) return;
    setCheckingUpdate(true);
    if (showError) setUpdateError(null);
    let otaAvailable = false;
    let apkAvailable = false;
    try {
      if (!__DEV__ && Updates.isEnabled) {
        try {
          const result = await Updates.checkForUpdateAsync();
          otaAvailable = result.isAvailable;
          setUpdateAvailable(otaAvailable);
        } catch (e: any) {
          if (showError) setUpdateError(e?.message ? String(e.message) : "Could not check OTA update.");
        }
      }
      try {
        const release = await fetchMobileRelease();
        apkAvailable = isNewerMobileRelease(release);
        setMobileRelease(apkAvailable ? release : null);
      } catch {
        // Build manifest is optional. OTA remains usable when manifest is offline.
      }
      if (showError && !otaAvailable && !apkAvailable) {
        setUpdateError("No update available — you are on latest version.");
      }
    } catch (e: any) {
      const msg = e?.message ? String(e.message) : "Could not check for update.";
      if (showError) setUpdateError(msg);
    } finally {
      setCheckingUpdate(false);
    }
  }, [checkingUpdate, downloadingUpdate]);

  useEffect(() => {
    let cancelled = false;
    void checkForUpdate(false);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && !cancelled) void checkForUpdate(false);
    });
    // ponawiaj check co 60s gdy modal ukryty — naprawia „kliknął Later i już nie widzi aktualizacji"
    const interval = setInterval(() => {
      if (!cancelled && !updateAvailable && !mobileRelease && !checkingUpdate && !downloadingUpdate) void checkForUpdate(false);
    }, 60_000);
    return () => {
      cancelled = true;
      sub.remove();
      clearInterval(interval);
    };
  }, [checkForUpdate, updateAvailable, mobileRelease, checkingUpdate, downloadingUpdate]);

  const applyUpdate = useCallback(async () => {
    if (downloadingUpdate) return;
    if (mobileRelease) {
      setDownloadingUpdate(true);
      setUpdateError(null);
      try {
        await installAndroidRelease(mobileRelease);
        setDownloadingUpdate(false);
      } catch (e: any) {
        setUpdateError(e?.message ? String(e.message) : "Could not download APK update.");
        setDownloadingUpdate(false);
      }
      return;
    }
    if (!Updates.isEnabled) {
      setUpdateError("Updates disabled w tym buildzie. Zainstaluj APK z EAS production (runtime 1.0.0).");
      return;
    }
    setDownloadingUpdate(true);
    setUpdateError(null);

    // przycisk ma DAWAĆ aktualizację po wciśnięciu — retry 3x + timeout 30s, nie poddaje się po jednym błędzie sieci
    let lastError: any = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result: any = await Promise.race([
          Updates.fetchUpdateAsync(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Timeout 30s — sprawdź WiFi/dane, expo.dev musi być dostępny")), 30_000)),
        ]);
        if (result?.isNew) {
          await Updates.reloadAsync();
          return;
        } else {
          // isNew=false: albo już najnowsza, albo kanał/runtime mismatch — spróbuj jeszcze check i reload dla pewności
          // Zamiast pokazywać błąd, wymuś reload żeby na pewno mieć najnowsze JS (gwarancja aktualizacji po kliknięciu)
          try {
            await Updates.reloadAsync();
          } catch {}
          setUpdateAvailable(false);
          setDownloadingUpdate(false);
          return;
        }
      } catch (e: any) {
        lastError = e;
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
          continue;
        }
      }
    }

    const raw = lastError?.message ? String(lastError.message) : "Could not download update.";
    const isNetwork = /network|timeout|fetch|unable|failed|ENOTFOUND|ETIMEDOUT/i.test(raw);
    if (isNetwork) {
      setUpdateError(
        `${raw} — Sprawdź WiFi/dane (expo.dev musi być dostępny). Próba 3/3 nieudana. Tapnij Download ponownie lub pobierz APK ręcznie.`
      );
    } else {
      setUpdateError(raw);
    }
    setDownloadingUpdate(false);
  }, [downloadingUpdate, mobileRelease]);

  return (
    <>
      <SafeAreaView style={styles.root}>
        <StatusBar barStyle="light-content" backgroundColor="#070707" />
        {route.name === "firstrun" && loading && (
          // Splash podczas odczytu hostów z SecureStore: bez tego przez chwilę
          // migał ekran dodawania (route startuje jako "firstrun"), zanim
          // didInit przełączy na zapisanego hosta.
          <View style={styles.splash} />
        )}
        {route.name === "firstrun" && !loading && (
          // Brak zapisanych hostów: pierwszy krok to połączenie z hostem.
          <AddHostScreen
            initialUrl={route.initialUrl}
            onDone={(host) => {
              refresh();
              setRoute({ name: "webview", host });
            }}
            onCancel={() => {
              if (hosts.length) setRoute({ name: "hosts" });
            }}
          />
        )}
        {route.name === "hosts" && !loading && (
          <HostManagerScreen
            hosts={hosts}
            activeHostId={hosts[0]?.id}
            onAdd={() => setRoute({ name: "firstrun" })}
            onSelect={openHost}
            onRename={renameStoredHost}
            onRemove={removeStoredHost}
          />
        )}
        {route.name === "webview" && (
          <WebViewScreen
            host={route.host}
            botId={route.botId}
            onBack={openHostManager}
            onConnectHost={(url) => setRoute({ name: "firstrun", initialUrl: url })}
            onBotVisible={setVisibleBot}
          />
        )}
      </SafeAreaView>

      <Modal
        animationType="fade"
        onRequestClose={() => {
          setUpdateAvailable(false);
          setMobileRelease(null);
        }}
        transparent
        visible={updateAvailable || Boolean(mobileRelease)}
      >
        <Pressable
          onPress={() => {
            setUpdateAvailable(false);
            setMobileRelease(null);
          }}
          style={styles.updateOverlay}
        >
          <Pressable onPress={(event) => event.stopPropagation()} style={styles.updateCard}>
            <Text style={styles.updateTitle}>{mobileRelease ? "New app build" : "Update available"}</Text>
            <Text style={styles.updateBody}>
              {mobileRelease
                ? `MultiBot ${mobileRelease.version} (${mobileRelease.versionCode}) is ready. Download and open Android installer.`
                : "A newer version of the app is ready. Download it now without a new build."}
            </Text>
            {mobileRelease?.notes ? <Text style={styles.updateBody}>{mobileRelease.notes}</Text> : null}
            {checkingUpdate ? <Text style={styles.updateBody}>Checking…</Text> : null}
            {updateError ? <Text style={styles.updateError}>{updateError}</Text> : null}
            {updateError ? (
              <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                <Pressable
                  accessibilityRole="button"
                  disabled={checkingUpdate || downloadingUpdate}
                  onPress={() => void checkForUpdate(true)}
                  style={({ pressed }) => [styles.updateSecondary, { flex: 1 }, pressed && styles.updatePressed, (checkingUpdate || downloadingUpdate) && styles.updateDisabled]}
                >
                  <Text style={styles.updateSecondaryText}>{checkingUpdate ? "Checking…" : "Sprawdź ponownie"}</Text>
                </Pressable>
              </View>
            ) : null}
            <View style={styles.updateActions}>
              <Pressable
                accessibilityRole="button"
                disabled={downloadingUpdate}
                onPress={() => {
                  setUpdateAvailable(false);
                  setMobileRelease(null);
                }}
                style={({ pressed }) => [styles.updateSecondary, pressed && styles.updatePressed, downloadingUpdate && styles.updateDisabled]}
              >
                <Text style={styles.updateSecondaryText}>Later</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={downloadingUpdate}
                onPress={() => void applyUpdate()}
                style={({ pressed }) => [styles.updatePrimary, pressed && styles.updatePressed, downloadingUpdate && styles.updateDisabled]}
              >
                {downloadingUpdate ? (
                  <ActivityIndicator color="#070707" />
                ) : (
                  <Text style={styles.updatePrimaryText}>{mobileRelease ? "Download &amp; install APK" : "Download &amp; restart"}</Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#070707" },
  splash: { flex: 1, backgroundColor: "#070707" },
  updateActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 18,
  },
  updateBody: {
    color: "#9a9a9a",
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
  },
  updateCard: {
    backgroundColor: "#161616",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#2a2a2a",
    maxWidth: 360,
    padding: 18,
    width: "100%",
  },
  updateDisabled: {
    opacity: 0.5,
  },
  updateError: {
    color: "#ff6b6b",
    fontSize: 13,
    lineHeight: 18,
    marginTop: 10,
  },
  updateOverlay: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.7)",
    flex: 1,
    justifyContent: "center",
    padding: 20,
  },
  updatePressed: {
    transform: [{ scale: 0.98 }],
  },
  updatePrimary: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderRadius: 8,
    flex: 1,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 14,
  },
  updatePrimaryText: {
    color: "#070707",
    fontSize: 14,
    fontWeight: "700",
  },
  updateSecondary: {
    alignItems: "center",
    backgroundColor: "#2a2a2a",
    borderRadius: 8,
    flex: 1,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 14,
  },
  updateSecondaryText: {
    color: "#d0d0d0",
    fontSize: 14,
    fontWeight: "700",
  },
  updateTitle: {
    color: "#ffffff",
    fontSize: 21,
    fontWeight: "700",
  },
});
