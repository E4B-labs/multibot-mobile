import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";

import type { Host } from "../lib/host-logic";
import { getHostToken } from "../lib/hosts";

interface Props {
  host: Host;
  onBack: () => void;
}

// Ile czekamy, zanim kręcące się kółko zamieni się w konkretną informację.
// Host w tej samej sieci oddaje UI w ułamku sekundy (zmierzone na telefonie:
// 875 KB paczki w 22 ms), więc kilkanaście sekund to już awaria, a nie wolne
// łącze. Bez tego ekran kręcił się w nieskończoność i nie dało się zgadnąć, czy
// to sieć, token, czy WebView.
const LOAD_TIMEOUT_MS = 15_000;

export default function WebViewScreen({ host, onBack }: Props) {
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Ile strony zdążyło wejść, zanim się zatrzymało — bez tego „ładuje się"
  // znaczy tyle samo przy zerze, co przy 99%.
  const [progress, setProgress] = useState(0);

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
      if (!token) {
        // Wpis hosta bez tokenu: WebView pokazałby ekran logowania albo nic.
        setFailed("No access token saved for this host — remove it and add it again.");
        return;
      }
      const fragment = `#access_token=${encodeURIComponent(token)}`;
      setUri(`${host.url}/${fragment}`);
    }, (e: unknown) => {
      if (!cancelled) setFailed(e instanceof Error ? e.message : "Could not read the saved token.");
    });
    return () => {
      cancelled = true;
    };
  }, [host]);

  // Kółko z terminem: po `LOAD_TIMEOUT_MS` bez `onLoadEnd` mówimy, co dokładnie
  // się nie udało, zamiast kręcić dalej.
  useEffect(() => {
    if (loaded || failed) return;
    const timer = setTimeout(
      () =>
        setFailed(
          `${host.url} did not finish loading in ${LOAD_TIMEOUT_MS / 1000}s ` +
            `(stopped at ${Math.round(progress * 100)}%).`,
        ),
      LOAD_TIMEOUT_MS,
    );
    return () => clearTimeout(timer);
  }, [loaded, failed, host.url, attempt, progress]);

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
        <Text style={styles.errorBody}>{failed}</Text>
        <Text style={styles.errorBody}>{host.url}</Text>
        {/* Najczestsza przyczyna nie jest bledem apki: telefon i host sa w
            innych sieciach. Adres `100.x` zyje tylko w tailnecie, wiec bez
            wlaczonego Tailscale polaczenie stoi, az wyjdzie termin. */}
        <Text style={styles.errorHint}>
          A 100.x address only works with Tailscale on. Check that this phone is connected to the same
          tailnet as the host.
        </Text>
        <Pressable
          style={styles.backButton}
          onPress={() => {
            setFailed(null);
            setLoaded(false);
            setAttempt((n) => n + 1);
          }}
        >
          <Text style={styles.backButtonText}>Try again</Text>
        </Pressable>
        <Pressable style={styles.backButton} onPress={onBack}>
          <Text style={styles.backButtonText}>Back to hosts</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <WebView
        key={attempt}
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
        // `startInLoadingState` samo w sobie potrafi zostawić kółko na wieki,
        // gdy `onLoadEnd` nie przyjdzie — stan trzymamy więc u siebie.
        onLoadEnd={() => setLoaded(true)}
        onLoadProgress={({ nativeEvent }) => {
          setProgress(nativeEvent.progress);
          if (nativeEvent.progress >= 1) setLoaded(true);
        }}
        startInLoadingState
        // Deliberately not wrapped in a ScrollView and scrollEnabled is left
        // at its default (true) — pinch-zoom and scroll inside the noVNC
        // screen/fullscreen view must reach the page untouched, not get
        // hijacked by a native scroll container.
        renderLoading={() => (
          <View style={styles.center}>
            <ActivityIndicator color="#fcfcfc" />
            <Text style={styles.errorBody}>{Math.round(progress * 100)}%</Text>
          </View>
        )}
        onError={({ nativeEvent }) =>
          setFailed(nativeEvent.description || `WebView error ${nativeEvent.code ?? ""}`.trim())
        }
        onHttpError={(e) => {
          if (e.nativeEvent.statusCode >= 500) setFailed(`Host answered HTTP ${e.nativeEvent.statusCode}.`);
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
  errorHint: { color: "#fcfcfc66", fontSize: 12, textAlign: "center", marginTop: 4 },
  backButton: { marginTop: 12, backgroundColor: "#fcfcfc", borderRadius: 10, paddingHorizontal: 20, paddingVertical: 12 },
  backButtonText: { color: "#070707", fontWeight: "700" },
  floatingBack: { position: "absolute", top: 8, left: 8, backgroundColor: "#070707cc", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  floatingBackText: { color: "#fcfcfc", fontSize: 13 },
});
