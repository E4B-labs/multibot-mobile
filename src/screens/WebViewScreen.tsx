import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Platform, Pressable, StatusBar, StyleSheet, Text, View } from "react-native";
import { WebView, type WebViewNavigation } from "react-native-webview";

import type { Host } from "../lib/host-logic";
import { getHostToken } from "../lib/hosts";
import { WEBUI_HTML } from "../webui-html";

interface Props {
  host: Host;
  botId?: string;
  onBack: () => void;
  /** Który bot jest właśnie na ekranie — powłoka wycisza jego powiadomienia. */
  onBotVisible?: (botId: string | null) => void;
}

// W Android WebView `env(safe-area-inset-top)` nie obejmuje paska stanu (tylko
// notch), więc interfejs webowy by go zakrywał. Podajemy realną wysokość paska
// stanu jako zmienną CSS `--android-status-bar`, a webui dodaje ją do górnych
// marginesów (patrz :root w styles.css). Na iOS zmienna zostaje 0, bo tam
// `env(safe-area-inset-top)` sam pokrywa pasek stanu.
const STATUS_BAR_HEIGHT = Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) : 0;

// How long we wait before the spinner turns into a concrete failure. A host on
// the same network returns the UI in well under a second (measured on device:
// 875 KB in 22 ms), so a dozen-odd seconds already means a broken link, not a
// slow one — without this the spinner spun forever and you couldn't tell
// whether it was the network, the token, or the WebView.
const LOAD_TIMEOUT_MS = 15_000;

export default function WebViewScreen({ host, botId, onBack, onBotVisible }: Props) {
  const webRef = useRef<WebView>(null);
  // Skrypt wstrzykiwany przed kodem strony. `null` znaczy „jeszcze nie znam
  // tokenu" — bez niego interfejs wystartowałby wylogowany.
  const [bootstrap, setBootstrap] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // How much of the page made it in before it stopped — "loading" means the
  // same at 0% and at 99% without this.
  const [progress, setProgress] = useState(0);
  // WebView history depth, so the back control (and the hardware button on
  // Android) steps out of the in-page chat before bailing to the host list.
  const [canGoBack, setCanGoBack] = useState(false);
  // Domyślnie włączony: widok pełnoekranowy (WebView edge-to-edge, bez
  // natywnego paska) to domyślny ekran czatu. Przycisk „‹ Hosts" (collapse)
  // przywraca natywny pasek. Toggled, nie auto, bo WebView nie zgłasza scrolla.
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void getHostToken(host.id).then((token) => {
      if (cancelled) return;
      if (!token) {
        // Wpis hosta bez tokenu: interfejs pokazałby ekran logowania albo nic.
        setFailed("Dla tego hosta nie ma zapisanego tokenu — usuń go i dodaj ponownie.");
        return;
      }
      // Interfejs czyta token z `localStorage` pod kluczem `multibot.auth.token`
      // (webui/src/lib/auth.ts) i stamtąd bierze go każde wywołanie API oraz
      // każde połączenie WebSocket. Wcześniej trafiał tam z fragmentu adresu,
      // ale interfejs nie przychodzi już spod adresu — jedzie w paczce
      // aplikacji jako string. Zapis wprost do `localStorage` przed
      // uruchomieniem kodu strony daje ten sam efekt.
      //
      // `localStorage` działa, bo `baseUrl` niżej nadaje dokumentowi origin
      // hosta. To ten sam mechanizm sprawia, że `fetch("/api/...")` w środku
      // interfejsu trafia do serwera MultiBota, a nie w próżnię.
      const deep = botId ? `location.hash = ${JSON.stringify(`#bot=${botId}`)};` : "";
      setBootstrap(
        `try { document.documentElement.style.setProperty('--android-status-bar', '${STATUS_BAR_HEIGHT}px'); } catch (e) {}
         try { localStorage.setItem("multibot.auth.token", ${JSON.stringify(token)}); ${deep} } catch (e) {}
         true;`,
      );
    }, (e: unknown) => {
      if (!cancelled) setFailed(e instanceof Error ? e.message : "Could not read the saved token.");
    });
    return () => {
      cancelled = true;
    };
  }, [host, botId]);

  // Spinner with a deadline: after LOAD_TIMEOUT_MS without onLoadEnd, say what
  // actually failed instead of spinning forever.
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

  // Android hardware back: step out of the in-page history first, only leave to
  // the host list when the WebView itself can't go further.
  useEffect(() => {
    const onHardwareBack = () => {
      if (canGoBack) {
        webRef.current?.goBack();
        return true;
      }
      onBack();
      return true;
    };
    const sub = BackHandler.addEventListener("hardwareBackPress", onHardwareBack);
    return () => sub.remove();
  }, [canGoBack, onBack]);

  // Tapnięcie w powiadomienie przy JUŻ otwartej aplikacji: bootstrap poszedł
  // dawno temu, więc hash trzeba wstrzyknąć teraz.
  useEffect(() => {
    if (!botId || !loaded) return;
    webRef.current?.injectJavaScript(`location.hash = ${JSON.stringify(`#bot=${botId}`)}; true;`);
  }, [botId, loaded]);

  function handleBack() {
    if (canGoBack) webRef.current?.goBack();
    else onBack();
  }

  function retry() {
    setFailed(null);
    setLoaded(false);
    setProgress(0);
    setCanGoBack(false);
    setAttempt((n) => n + 1);
  }

  if (!bootstrap) {
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
        {/* Most common cause isn't an app bug: the phone and host are on
            different networks. A 100.x address only lives inside the tailnet,
            so without Tailscale on the connection just sits until the timeout. */}
        <Text style={styles.errorHint}>
          A 100.x address only works with Tailscale on. Check that this phone is connected to the same
          tailnet as the host.
        </Text>
        <Pressable style={styles.backButton} onPress={retry}>
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
      {!expanded && (
        <View style={styles.header}>
          <Text style={styles.headerName} numberOfLines={1}>
            {host.name}
          </Text>
          <Pressable style={styles.headerToggle} onPress={() => setExpanded(true)}>
            <Text style={styles.headerToggleText}>⤢</Text>
          </Pressable>
        </View>
      )}
      <WebView
        ref={webRef}
        key={attempt}
        // Interfejs jedzie z paczki aplikacji, nie z serwera. `baseUrl` nadaje
        // dokumentowi origin hosta, dzięki czemu względne wywołania `/api/...`
        // i WebSockety w środku interfejsu trafiają tam, gdzie trzeba.
        // Skutek praktyczny: zmiana wyglądu idzie przez `eas update`, bez
        // wgrywania czegokolwiek na serwer MultiBota.
        source={{ html: WEBUI_HTML, baseUrl: host.url.replace(/\/$/, "") }}
        injectedJavaScriptBeforeContentLoaded={bootstrap}
        onMessage={({ nativeEvent }) => {
          try {
            const msg = JSON.parse(nativeEvent.data);
            if (msg?.type === "bot.selected") onBotVisible?.(typeof msg.botId === "string" ? msg.botId : null);
          } catch {
            /* interfejs wysyła też inne wiadomości — nie nasza sprawa */
          }
        }}
        style={[styles.flex, expanded ? { paddingTop: STATUS_BAR_HEIGHT } : undefined]}
        // The harness UI — including the bot-computer noVNC iframe reached
        // through /api/bots/:id/computer/vnc/... — needs JS, DOM storage
        // (for the access-token bootstrap above) and inline media; none of
        // these are the Android/iOS WebView defaults.
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        originWhitelist={["*"]}
        // startInLoadingState alone can leave the spinner forever when
        // onLoadEnd never arrives — so we hold the state ourselves.
        onLoadEnd={() => setLoaded(true)}
        onLoadProgress={({ nativeEvent }) => {
          setProgress(nativeEvent.progress);
          if (nativeEvent.progress >= 1) setLoaded(true);
        }}
        onNavigationStateChange={(nav: WebViewNavigation) => setCanGoBack(nav.canGoBack)}
        startInLoadingState
        // Not wrapped in a ScrollView and scrollEnabled stays at its default
        // (true): pinch-zoom and scroll inside the noVNC/fullscreen view must
        // reach the page untouched, not get hijacked by a native scroller.
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
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: "#070707" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#070707", padding: 24, gap: 10 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#0f0f0f",
    paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight ?? 8) : 8,
    paddingBottom: 8,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#1c1c1c",
  },
  headerBack: { paddingHorizontal: 12, paddingVertical: 6 },
  headerBackText: { color: "#fcfcfc", fontSize: 24, fontWeight: "700" },
  headerName: { flex: 1, color: "#fcfcfc", fontSize: 15, fontWeight: "600", marginLeft: 4 },
  headerToggle: { paddingHorizontal: 12, paddingVertical: 6 },
  headerToggleText: { color: "#fcfcfc99", fontSize: 18 },
  collapseButton: {
    position: "absolute",
    top: 8,
    left: 8,
    backgroundColor: "#070707cc",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  collapseText: { color: "#fcfcfc", fontSize: 13 },
  errorTitle: { color: "#fcfcfc", fontSize: 18, fontWeight: "700" },
  errorBody: { color: "#fcfcfc99", fontSize: 14, textAlign: "center" },
  errorHint: { color: "#fcfcfc66", fontSize: 12, textAlign: "center", marginTop: 4 },
  backButton: { marginTop: 12, backgroundColor: "#fcfcfc", borderRadius: 10, paddingHorizontal: 20, paddingVertical: 12 },
  backButtonText: { color: "#070707", fontWeight: "700" },
});
