import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { WebView, type WebViewHttpErrorEvent } from "react-native-webview";

import type { Host } from "../lib/host-logic";
import { getHostToken } from "../lib/hosts";

interface Props {
  host: Host;
  onBack: () => void;
}

export default function WebViewScreen({ host, onBack }: Props) {
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getHostToken(host.id).then((token) => {
      if (cancelled) return;
      // Same seam the Electron shell already uses (electron/main.mjs
      // localAccessTokenFragment): the fragment never touches the network —
      // src/lib/auth.ts's bootstrapLocalAuthToken() reads it client-side on
      // first paint, stores it in localStorage, and every authFetch /
      // authenticatedWebSocket call in the harness UI picks it up from
      // there. That's how the credential reaches every request, not header
      // injection into the WebView.
      //
      // TODO(firebase-seam): once server/firebase-auth.ts's HTTP route is
      // mounted, replace this with a POST of a Firebase ID token to
      // /api/auth/firebase/session and let the WebView pick up the resulting
      // HttpOnly mb_session cookie instead — no token in the URL or here.
      const fragment = token ? `#access_token=${encodeURIComponent(token)}` : "";
      setUri(`${host.url}/${fragment}`);
    });
    return () => {
      cancelled = true;
    };
  }, [host]);

  if (!uri) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#fcfcfc" />
      </View>
    );
  }

  if (failed) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>Can&apos;t reach {host.name}</Text>
        <Text style={styles.errorBody}>Check that the host is running and reachable (Tailscale/VPN if remote).</Text>
        <Pressable style={styles.backButton} onPress={onBack}>
          <Text style={styles.backButtonText}>Back to hosts</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <WebView
        source={{ uri }}
        style={styles.flex}
        // The harness UI — including the bot-computer noVNC iframe reached
        // through /api/bots/:id/computer/vnc/... — needs JS, DOM storage
        // (for the access-token bootstrap above) and inline media; none of
        // these are the Android/iOS WebView defaults.
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        originWhitelist={["*"]}
        startInLoadingState
        // Deliberately not wrapped in a ScrollView and scrollEnabled is left
        // at its default (true) — pinch-zoom and scroll inside the noVNC
        // screen/fullscreen view must reach the page untouched, not get
        // hijacked by a native scroll container.
        renderLoading={() => (
          <View style={styles.center}>
            <ActivityIndicator color="#fcfcfc" />
          </View>
        )}
        onError={() => setFailed(true)}
        onHttpError={(e: WebViewHttpErrorEvent) => {
          if (e.nativeEvent.statusCode >= 500) setFailed(true);
        }}
      />
      <Pressable style={styles.floatingBack} onPress={onBack}>
        <Text style={styles.floatingBackText}>‹ Hosts</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: "#070707" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#070707", padding: 24, gap: 10 },
  errorTitle: { color: "#fcfcfc", fontSize: 18, fontWeight: "700" },
  errorBody: { color: "#fcfcfc99", fontSize: 14, textAlign: "center" },
  backButton: { marginTop: 12, backgroundColor: "#fcfcfc", borderRadius: 10, paddingHorizontal: 20, paddingVertical: 12 },
  backButtonText: { color: "#070707", fontWeight: "700" },
  floatingBack: { position: "absolute", top: 8, left: 8, backgroundColor: "#070707cc", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  floatingBackText: { color: "#fcfcfc", fontSize: 13 },
});
