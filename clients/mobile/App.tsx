import { useCallback, useEffect, useState } from "react";
import { SafeAreaView, StatusBar, StyleSheet } from "react-native";

import type { Host } from "./src/lib/host-logic";
import { deleteHost, listHosts } from "./src/lib/hosts";
import AddHostScreen from "./src/screens/AddHostScreen";
import HostListScreen from "./src/screens/HostListScreen";
import WebViewScreen from "./src/screens/WebViewScreen";

// No navigation library: three screens, switched by local state. Adding
// react-navigation for this would be an unrequested abstraction — bring it
// in when a fourth screen or deep-link routing actually needs it.
type Route = { name: "list" } | { name: "add" } | { name: "webview"; host: Host };

export default function App() {
  const [route, setRoute] = useState<Route>({ name: "list" });
  const [hosts, setHosts] = useState<Host[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    void listHosts().then((h) => {
      setHosts(h);
      setLoading(false);
    });
  }, []);

  useEffect(refresh, [refresh]);

  const handleRemove = useCallback(
    async (id: string) => {
      await deleteHost(id);
      refresh();
    },
    [refresh],
  );

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#070707" />
      {route.name === "list" && (
        <HostListScreen
          hosts={hosts}
          loading={loading}
          onOpen={(host) => setRoute({ name: "webview", host })}
          onAdd={() => setRoute({ name: "add" })}
          onRemove={(id) => void handleRemove(id)}
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
      {route.name === "webview" && <WebViewScreen host={route.host} onBack={() => setRoute({ name: "list" })} />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#070707" },
});
