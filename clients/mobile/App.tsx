import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, SafeAreaView, StatusBar, StyleSheet, Text, View } from "react-native";
import * as Updates from "expo-updates";
import * as Notifications from "expo-notifications";

import type { Host } from "./src/lib/host-logic";
import { normalizeHostUrl } from "./src/lib/host-logic";
import { deleteHost, listHosts, renameHost } from "./src/lib/hosts";
import { configurePushNotifications, extractBotTarget, requestPushPermission } from "./src/lib/push";
import AddHostScreen from "./src/screens/AddHostScreen";
import HostListScreen from "./src/screens/HostListScreen";
import WebViewScreen from "./src/screens/WebViewScreen";

// No navigation library: three screens, switched by local state. Adding
// react-navigation for this would be an unrequested abstraction — bring it
// in when a fourth screen or deep-link routing actually needs it.
type Route =
  | { name: "list" }
  | { name: "add" }
  | { name: "webview"; host: Host; botId?: string };

export default function App() {
  const [route, setRoute] = useState<Route>({ name: "list" });
  const [hosts, setHosts] = useState<Host[]>([]);
  const hostsRef = useRef<Host[]>([]);
  const [loading, setLoading] = useState(true);

  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [downloadingUpdate, setDownloadingUpdate] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void listHosts().then((h) => {
      setHosts(h);
      setLoading(false);
    });
  }, []);

  useEffect(refresh, [refresh]);

  useEffect(() => {
    hostsRef.current = hosts;
  }, [hosts]);

  // Push: ask for permission once at launch, then route a tapped notification
  // to the right host's WebView (scrolled to its bot). The server-side push
  // backend is still missing in server/, so notifications only start arriving
  // once that ships — the shell is ready for them now.
  useEffect(() => {
    configurePushNotifications();
    void requestPushPermission();

    const openFromTarget = (target: ReturnType<typeof extractBotTarget>) => {
      if (!target.hostUrl) {
        setRoute({ name: "list" });
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

  const handleRemove = useCallback(
    async (id: string) => {
      await deleteHost(id);
      refresh();
    },
    [refresh],
  );

  const handleRename = useCallback(
    async (id: string, name: string) => {
      await renameHost(id, name);
      refresh();
    },
    [refresh],
  );

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
        {route.name === "list" && (
          <HostListScreen
            hosts={hosts}
            loading={loading}
            onOpen={(host) => setRoute({ name: "webview", host })}
            onAdd={() => setRoute({ name: "add" })}
            onRemove={(id) => void handleRemove(id)}
            onRename={(id, name) => void handleRename(id, name)}
          />
        )}
        {route.name === "add" && (
          <AddHostScreen
            onDone={(host) => {
              refresh();
              setRoute({ name: "webview", host });
            }}
            onCancel={() => setRoute({ name: "list" })}
          />
        )}
        {route.name === "webview" && (
          <WebViewScreen host={route.host} botId={route.botId} onBack={() => setRoute({ name: "list" })} />
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
