import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Modal, Pressable, SafeAreaView, StatusBar, StyleSheet, Text, View } from "react-native";
import * as Updates from "expo-updates";
import * as Notifications from "expo-notifications";

import type { Host } from "./src/lib/host-logic";
import { normalizeHostUrl } from "./src/lib/host-logic";
import { listHosts } from "./src/lib/hosts";
import { configurePushNotifications, ensurePushRegistered, extractBotTarget } from "./src/lib/push";
import AddHostScreen from "./src/screens/AddHostScreen";
import WebViewScreen from "./src/screens/WebViewScreen";

// No navigation library: three screens, switched by local state. Adding
// react-navigation for this would be an unrequested abstraction — bring it
// in when a fourth screen or deep-link routing actually needs it.
type Route =
  | { name: "firstrun" }
  | { name: "webview"; host: Host; botId?: string };

export default function App() {
  const [route, setRoute] = useState<Route>({ name: "firstrun" });
  const [hosts, setHosts] = useState<Host[]>([]);
  const hostsRef = useRef<Host[]>([]);
  // Przy pierwszym załadowaniu, jeśli istnieje już host, wchodzimy od razu w
  // panel czatu zamiast do wyboru hostów — aplikacja obsługuje jednego hosta
  // i nie wraca do listy.
  const didInit = useRef(false);
  const [loading, setLoading] = useState(true);

  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [downloadingUpdate, setDownloadingUpdate] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void listHosts().then((h) => {
      setHosts(h);
      setLoading(false);
      if (!didInit.current && h.length >= 1) {
        didInit.current = true;
        setRoute({ name: "webview", host: h[0] });
      }
    });
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
        // Bez adresu hosta otwieramy zapisanego hosta (aplikacja obsługuje
        // jednego) — ekran listy został usunięty.
        const existing = hostsRef.current[0];
        if (existing) setRoute({ name: "webview", host: existing });
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
  // pada, kiedy telefon jest chwilowo poza siecią hosta (np. Tailscale jeszcze
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

  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) {
      return;
    }

    let cancelled = false;

    const checkUpdate = async () => {
      setCheckingUpdate(true);
      try {
        const result = await Updates.checkForUpdateAsync();
        if (!cancelled) {
          setUpdateAvailable(result.isAvailable);
          setUpdateError(null);
        }
      } catch {
        if (!cancelled) {
          setUpdateError("Could not check for update.");
        }
      } finally {
        if (!cancelled) {
          setCheckingUpdate(false);
        }
      }
    };

    void checkUpdate();

    return () => {
      cancelled = true;
    };
  }, []);

  const applyUpdate = useCallback(async () => {
    if (downloadingUpdate || !Updates.isEnabled) {
      return;
    }

    setDownloadingUpdate(true);
    setUpdateError(null);

    try {
      const result = await Updates.fetchUpdateAsync();
      if (result.isNew) {
        await Updates.reloadAsync();
      } else {
        setUpdateAvailable(false);
      }
    } catch {
      setUpdateError("Could not download update.");
    } finally {
      setDownloadingUpdate(false);
    }
  }, [downloadingUpdate]);

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
          // Pierwsze uruchomienie (brak hosta w SecureStore): od razu ekran
          // dodawania. Po dodaniu hosta wchodzimy w WebView i już do niego
          // nie wracamy — stąd brak osobnego ekranu listy.
          <AddHostScreen
            onDone={(host) => {
              refresh();
              setRoute({ name: "webview", host });
            }}
            onCancel={() => {}}
          />
        )}
        {route.name === "webview" && (
          <WebViewScreen host={route.host} botId={route.botId} onBack={() => {}} />
        )}
      </SafeAreaView>

      <Modal animationType="fade" onRequestClose={() => setUpdateAvailable(false)} transparent visible={updateAvailable}>
        <Pressable onPress={() => setUpdateAvailable(false)} style={styles.updateOverlay}>
          <Pressable onPress={(event) => event.stopPropagation()} style={styles.updateCard}>
            <Text style={styles.updateTitle}>Update available</Text>
            <Text style={styles.updateBody}>A newer version of the app is ready. Download it now without a new build.</Text>
            {checkingUpdate ? <Text style={styles.updateBody}>Checking…</Text> : null}
            {updateError ? <Text style={styles.updateError}>{updateError}</Text> : null}
            <View style={styles.updateActions}>
              <Pressable
                accessibilityRole="button"
                disabled={checkingUpdate || downloadingUpdate}
                onPress={() => setUpdateAvailable(false)}
                style={({ pressed }) => [styles.updateSecondary, pressed && styles.updatePressed, (checkingUpdate || downloadingUpdate) && styles.updateDisabled]}
              >
                <Text style={styles.updateSecondaryText}>Later</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={checkingUpdate || downloadingUpdate}
                onPress={() => void applyUpdate()}
                style={({ pressed }) => [styles.updatePrimary, pressed && styles.updatePressed, (checkingUpdate || downloadingUpdate) && styles.updateDisabled]}
              >
                {downloadingUpdate ? (
                  <ActivityIndicator color="#070707" />
                ) : (
                  <Text style={styles.updatePrimaryText}>Download &amp; restart</Text>
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
