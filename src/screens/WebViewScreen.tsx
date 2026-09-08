import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, BackHandler, Platform, Pressable, StatusBar, StyleSheet, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Clipboard from "expo-clipboard";
import { WebView } from "react-native-webview";
import * as Application from "expo-application";
import * as Updates from "expo-updates";

import { buildBootstrap, isOnionHost, isTailnetUrl, probeServer, type Host } from "../lib/host-logic";
import { getHostToken } from "../lib/hosts";
import { joinErrorMessage, type JoinErrorCode } from "../lib/join";
import { requestPushPermission } from "../lib/push";
import { forgetServer, prepareTor } from "../lib/tls";
import { setWebViewProxyFor } from "../lib/tor";
import { WEBUI_HTML } from "../webui-html";

interface Props {
  host: Host;
  botId?: string;
  /** e.g. `#join=<grant>` — the web UI finishes the sign-in from the fragment. */
  fragment?: string;
  onBack: () => void;
  /** Który bot jest właśnie na ekranie — powłoka wycisza jego powiadomienia. */
  onBotVisible?: (botId: string | null) => void;
  /** Sign-in started from inside the web UI: the shell resolves the address and
   * swaps hosts, because the page cannot reach another origin itself. */
  onJoinHost?: (url: string, serverName: string, serverPassword: string) => Promise<{ ok: boolean; error?: JoinErrorCode }>;
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
const PROBE_TIMEOUT_MS = 8_000;

// A `.onion` host is three relays away and its first request also waits for the
// hidden-service rendezvous. Measured elsewhere at 0.3–0.7 s once warm, but the
// first one after a cold bootstrap is seconds, not milliseconds — the LAN
// budgets above would fail a perfectly healthy server.
const ONION_LOAD_TIMEOUT_MS = 90_000;
const ONION_PROBE_TIMEOUT_MS = 45_000;

// Anything running in this WebView can call `postMessage`, including a frame the
// page embeds (the bot-computer noVNC view is one). The privileged messages —
// swapping servers, dropping a certificate pin, installing an update, minting a
// push token, opening the camera, reading the clipboard — must come from the
// page the shell itself loaded, so the shell injects a fresh secret into the
// MAIN FRAME ONLY and ignores any privileged message that doesn't carry it back.
// The camera and clipboard belong on this list for the same reason as the rest:
// the noVNC frame gets a `window.ReactNativeWebView` of its own, and without the
// gate a page inside it could open the camera or pull the clipboard.
const PRIVILEGED = new Set([
  "host.join",
  "tls.forget",
  "push.request",
  "app.update.check",
  "app.update.download",
  "app.update.install",
  "native.camera.request",
  "native.clipboard.image",
  "native.back.result",
]);

function newBridgeNonce(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

type AppUpdateState = {
  status: "idle" | "checking" | "available" | "downloading" | "downloaded" | "error";
  version?: string;
  percent?: number;
  message?: string;
};

async function probeHost(url: string, timeoutMs: number): Promise<string | null> {
  // Certificate is already pinned by the time a host is saved, so a failure here
  // is the network or the server, never trust.
  switch (await probeServer(url, timeoutMs)) {
    case "ok":
      return null;
    case "timeout":
      return `Nie można połączyć z ${url} w ${timeoutMs / 1000}s.`;
    case "not_multibot":
      return `${url} odpowiada, ale to nie jest serwer MultiBota.`;
    default:
      return `Nie można połączyć z ${url}.`;
  }
}

export default function WebViewScreen({ host, botId, fragment, onBack, onBotVisible, onJoinHost }: Props) {
  const webRef = useRef<WebView>(null);
  // Skrypt wstrzykiwany przed kodem strony. `null` znaczy „jeszcze nie znam
  // tokenu" — bez niego interfejs wystartowałby wylogowany.
  const [bootstrap, setBootstrap] = useState<string | null>(null);
  // One secret per mount of THIS screen, handed only to the main frame. A retry
  // (`key={attempt}` on the WebView below) deliberately reuses it: the injected
  // bootstrap is state, and minting a new nonce here would let the remounted
  // WebView load for a frame with the previous one still in `bootstrap`.
  // Switching hosts remounts the screen, and that does mint a fresh secret.
  const nonce = useMemo(newBridgeNonce, []);
  const [failed, setFailed] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // How much of the page made it in before it stopped — "loading" means the
  // same at 0% and at 99% without this.
  const [progress, setProgress] = useState(0);
  // The hardware back button is handled by the page UI first. It must never
  // use WebView history as app navigation: a hash change is not a screen, and
  // the old fallback deleted the saved host and returned to sign-in.
  const nativeBackRequest = useRef<string | null>(null);
  const nativeBackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [cameraRequest, setCameraRequest] = useState<{ requestId: string; purpose: "attachment" | "avatar" } | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const cameraRef = useRef<CameraView>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  // Domyślnie włączony: widok pełnoekranowy (WebView edge-to-edge, bez
  // natywnego paska) to domyślny ekran czatu. Przycisk „‹ Hosts" (collapse)
  // przywraca natywny pasek. Toggled, nie auto, bo WebView nie zgłasza scrolla.
  const [expanded, setExpanded] = useState(true);

  // Only `.onion` hosts touch Tor at all; everything else keeps the exact path
  // it had before, including the proxy override being taken back off.
  const onion = useMemo(() => isOnionHost(host.url), [host.url]);

  useEffect(() => {
    let cancelled = false;
    void getHostToken(host.id).then(async (token) => {
      if (cancelled) return;
      // Tor before the probe, and the WebView proxy before the first load:
      // without both, an onion address resolves to nothing. `setWebViewProxyFor`
      // also CLEARS the override for a normal host, so switching back from an
      // onion server cannot leave every LAN address routed into a dead proxy.
      try {
        await prepareTor(host.url);
        await setWebViewProxyFor(host.url);
      } catch (error) {
        if (!cancelled) {
          setFailed(error instanceof Error ? error.message : `Could not start Tor for ${host.url}.`);
        }
        return;
      }
      if (cancelled) return;
      // Brak zapisanego tokenu to poprawny host: serwer ma własne konta
      // (protokół 2), więc interfejs webowy pokaże swój ekran logowania
      // (login + hasło) i sam zapisze sesję w localStorage tego origin.
      const problem = await probeHost(host.url, onion ? ONION_PROBE_TIMEOUT_MS : PROBE_TIMEOUT_MS);
      if (cancelled) return;
      if (problem) {
        setFailed(problem);
        return;
      }
      // multibot: wersja aplikacji dla webui (odpowiednik bridge'a
      // updatera.currentVersion() na desktopie).
      const appVersion = Application.nativeApplicationVersion ?? Updates.runtimeVersion ?? "";
      setBootstrap(buildBootstrap({ token, botId, fragment, bridgeNonce: nonce, statusBarHeight: STATUS_BAR_HEIGHT, appVersion }));
    }, (e: unknown) => {
      if (!cancelled) setFailed(e instanceof Error ? e.message : "Could not read the saved token.");
    });
    return () => {
      cancelled = true;
    };
    // ponytail: the override is not cleared on unmount — every mount sets or
    // clears it before loading, and clearing here would race the next host's
    // set. Revisit if a second WebView is ever mounted alongside this one.
  }, [host, botId, fragment, nonce, onion]);

  // Spinner with a deadline: after LOAD_TIMEOUT_MS without onLoadEnd, say what
  // actually failed instead of spinning forever.
  useEffect(() => {
    if (loaded || failed) return;
    const budget = onion ? ONION_LOAD_TIMEOUT_MS : LOAD_TIMEOUT_MS;
    const timer = setTimeout(
      () =>
        setFailed(
          `${host.url} did not finish loading in ${budget / 1000}s ` +
            `(stopped at ${Math.round(progress * 100)}%).`,
        ),
      budget,
    );
    return () => clearTimeout(timer);
  }, [loaded, failed, host.url, attempt, progress, onion]);

  // Android hardware back: ask the WebUI to open the bot picker. If it reports
  // that the picker is already open, leave the app to the phone desktop. The
  // host remains in SecureStore, so reopening the app stays signed in.
  useEffect(() => {
    const onHardwareBack = () => {
      if (nativeBackRequest.current) return true;
      const requestId = `back-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      nativeBackRequest.current = requestId;
      nativeBackTimer.current = setTimeout(() => {
        if (nativeBackRequest.current !== requestId) return;
        nativeBackRequest.current = null;
        BackHandler.exitApp();
      }, 350);
      webRef.current?.injectJavaScript(
        `window.dispatchEvent(new CustomEvent("mb:native-back", { detail: { requestId: ${JSON.stringify(requestId)} } })); true;`,
      );
      return true;
    };
    const sub = BackHandler.addEventListener("hardwareBackPress", onHardwareBack);
    return () => {
      sub.remove();
      if (nativeBackTimer.current) clearTimeout(nativeBackTimer.current);
      nativeBackTimer.current = null;
      nativeBackRequest.current = null;
    };
  }, []);

  // Tapnięcie w powiadomienie przy JUŻ otwartej aplikacji: bootstrap poszedł
  // dawno temu, więc hash trzeba wstrzyknąć teraz.
  useEffect(() => {
    if (!botId || !loaded) return;
    webRef.current?.injectJavaScript(`location.hash = ${JSON.stringify(`#bot=${botId}`)}; true;`);
  }, [botId, loaded]);

  function handleBack() {
    onBack();
  }

  function retry() {
    setFailed(null);
    setLoaded(false);
    setProgress(0);
    setAttempt((n) => n + 1);
  }

  const sendNativePhoto = (photo: {
    requestId: string;
    purpose: "attachment" | "avatar";
    dataUrl: string;
    fileName: string;
  }) => {
    webRef.current?.injectJavaScript(
      `window.dispatchEvent(new CustomEvent("mb:native-photo", { detail: ${JSON.stringify(photo)} })); true;`,
    );
  };

  const sendNativeError = (requestId: string, purpose: "attachment" | "avatar", message: string) => {
    webRef.current?.injectJavaScript(
      `window.dispatchEvent(new CustomEvent("mb:native-photo-error", { detail: ${JSON.stringify({ requestId, purpose, message })} })); true;`,
    );
  };

  // Reply channel for `host.join` and `push.request`. The web UI listens for a
  // `message` event, the same shape a browser gets from `postMessage`, so one
  // page handles the Electron, browser and phone shells without a branch.
  const sendToPage = (payload: unknown) => {
    webRef.current?.injectJavaScript(
      `window.dispatchEvent(new MessageEvent("message", { data: ${JSON.stringify(JSON.stringify(payload))} })); true;`,
    );
  };

  // Only the OS can mint an Expo push token, and only the page holds a session
  // to register it with — so the shell fetches the token (asking for permission
  // if the user hasn't been asked yet) and the page POSTs it to
  // /api/devices/:id/push itself. `token: null` means declined or unavailable;
  // the page shows that instead of waiting for notifications that never come.
  async function handlePushRequest() {
    const token = await requestPushPermission();
    sendToPage({
      type: "push.token",
      token,
      platform: Platform.OS,
      // ponytail: no real model name without expo-device; add it when the
      // server's device list has to tell two of the same phone apart.
      deviceName: Platform.OS === "ios" ? "iPhone" : "Android phone",
    });
  }

  async function handleJoinHost(msg: { url?: unknown; serverName?: unknown; serverPassword?: unknown }) {
    if (typeof msg.url !== "string" || typeof msg.serverName !== "string" || typeof msg.serverPassword !== "string") {
      sendToPage({ type: "host.join.result", ok: false, error: "invalid_address" });
      return;
    }
    if (!onJoinHost) {
      sendToPage({ type: "host.join.result", ok: false, error: "failed" });
      return;
    }
    let result: { ok: boolean; error?: JoinErrorCode };
    try {
      result = await onJoinHost(msg.url, msg.serverName, msg.serverPassword);
    } catch {
      // A page left waiting on a reply that never comes looks like a hang. Any
      // throw becomes an answer.
      result = { ok: false, error: "failed" };
    }
    // On success the shell swaps hosts and remounts this screen, so there is no
    // page left to answer — only the failure needs a reply.
    if (!result.ok) {
      sendToPage({
        type: "host.join.result",
        ok: false,
        error: result.error ?? "failed",
        message: joinErrorMessage(result.error ?? "failed"),
      });
    }
  }

  // Dropping a pin is the one bridge call that weakens security, so it needs a
  // human: it only ever applies to the host on screen, and only after a native
  // confirmation the page cannot draw or dismiss.
  function confirmForget() {
    Alert.alert(
      "Trust a new certificate?",
      `${host.url} is presenting a different certificate than the one you trusted. Only continue if you know the server was reinstalled — otherwise something is impersonating it.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Trust new certificate",
          style: "destructive",
          onPress: () => {
            try {
              forgetServer(host.url);
              sendToPage({ type: "tls.forget.result", ok: true });
            } catch {
              sendToPage({ type: "tls.forget.result", ok: false });
            }
          },
        },
      ],
    );
  }

  const sendUpdateState = (state: AppUpdateState) => {
    webRef.current?.injectJavaScript(
      `window.dispatchEvent(new CustomEvent("mb:app-update-state", { detail: ${JSON.stringify(state)} })); true;`,
    );
  };

  async function handleAppUpdate(action: "check" | "download" | "install") {
    try {
      if (!Updates.isEnabled) throw new Error("Updates are not enabled in this build.");
      if (action === "check") {
        sendUpdateState({ status: "checking" });
        const result = await Updates.checkForUpdateAsync();
        sendUpdateState(result.isAvailable
          ? { status: "available", version: Updates.updateId?.slice(0, 8) || "OTA" }
          : { status: "idle" });
        return;
      }
      if (action === "download") {
        sendUpdateState({ status: "downloading", percent: 0 });
        await Updates.fetchUpdateAsync();
        sendUpdateState({ status: "downloaded", version: Updates.updateId?.slice(0, 8) || "OTA" });
        return;
      }
      await Updates.reloadAsync();
    } catch (error) {
      sendUpdateState({
        status: "error",
        message: error instanceof Error ? error.message : "Could not update the app.",
      });
    }
  }

  async function takeNativePhoto() {
    if (!cameraRequest || !cameraPermission?.granted || !cameraReady) return;
    const request = cameraRequest;
    try {
      const picture = await cameraRef.current?.takePictureAsync({ base64: true, quality: 0.86 });
      if (!picture?.base64) throw new Error("The camera did not return an image.");
      sendNativePhoto({
        requestId: request.requestId,
        purpose: request.purpose,
        dataUrl: `data:image/jpeg;base64,${picture.base64}`,
        fileName: `camera-${Date.now()}.jpg`,
      });
      setCameraRequest(null);
    } catch (error) {
      sendNativeError(request.requestId, request.purpose, error instanceof Error ? error.message : "Could not take a photo.");
    }
  }

  async function readClipboardImage(requestId: string) {
    try {
      const image = await Clipboard.getImageAsync({ format: "png" });
      if (!image?.data) return;
      sendNativePhoto({
        requestId,
        purpose: "attachment",
        dataUrl: image.data,
        fileName: `clipboard-${Date.now()}.png`,
      });
    } catch {
      // Some platform clipboard providers expose only text. The web input
      // remains available and keeps its normal text-paste behavior.
    }
  }

  useEffect(() => {
    if (!cameraRequest || cameraPermission?.granted !== false) return;
    void requestCameraPermission();
  }, [cameraRequest, cameraPermission?.granted, requestCameraPermission]);

  if (failed) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>Can&apos;t reach {host.name}</Text>
        <Text style={styles.errorBody}>{failed}</Text>
        <Text style={styles.errorBody}>{host.url}</Text>
        {/* Most common cause isn't an app bug: the phone and host are on
            different networks. A 100.x address only lives inside the tailnet,
            so without Tailscale on the connection just sits until the timeout. */}
        {isTailnetUrl(host.url) && (
          <Text style={styles.errorHint}>
            A 100.x address only works with Tailscale on. Check that this phone is connected to the same
            tailnet as the host.
          </Text>
        )}
        <Pressable style={styles.backButton} onPress={retry}>
          <Text style={styles.backButtonText}>Try again</Text>
        </Pressable>
        <Pressable style={styles.backButton} onPress={onBack}>
          <Text style={styles.backButtonText}>Change server</Text>
        </Pressable>
      </View>
    );
  }

  if (!bootstrap) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#fcfcfc" />
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
        // The bridge nonce must not leak into an embedded frame (the
        // bot-computer noVNC view is one), which is what makes the check worth
        // anything. This is the library default; pinned so an upgrade cannot
        // widen it silently.
        injectedJavaScriptBeforeContentLoadedForMainFrameOnly
        onMessage={({ nativeEvent }) => {
          try {
            const msg = JSON.parse(nativeEvent.data);
            // `bot.selected` is the one message that carries no authority — it
            // only mutes a notification — so it is the only one handled above
            // the gate. Everything else goes below it.
            if (msg?.type === "bot.selected") onBotVisible?.(typeof msg.botId === "string" ? msg.botId : null);
            if (PRIVILEGED.has(msg?.type) && msg?.nonce !== nonce) return;
            if (msg?.type === "native.back.result" && msg.requestId === nativeBackRequest.current) {
              if (nativeBackTimer.current) clearTimeout(nativeBackTimer.current);
              nativeBackTimer.current = null;
              nativeBackRequest.current = null;
              if (!msg.handled) BackHandler.exitApp();
              return;
            }
            if (msg?.type === "native.camera.request" && typeof msg.requestId === "string" && (msg.purpose === "attachment" || msg.purpose === "avatar")) {
              setCameraReady(false);
              setCameraRequest({ requestId: msg.requestId, purpose: msg.purpose });
            }
            if (msg?.type === "native.clipboard.image" && typeof msg.requestId === "string") void readClipboardImage(msg.requestId);
            if (msg?.type === "host.join") void handleJoinHost(msg);
            if (msg?.type === "push.request") void handlePushRequest();
            // "Trust new certificate" from inside the web UI. The URL is not
            // taken from the message: only the host on screen can be forgotten.
            if (msg?.type === "tls.forget") confirmForget();
            if (msg?.type === "app.update.check" || msg?.type === "app.update.download" || msg?.type === "app.update.install") {
              void handleAppUpdate(msg.type.slice("app.update.".length));
            }
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
        // The UI only ever talks to its own server; anything else navigating in
        // here would run with the same bridge and the same origin.
        originWhitelist={[`${host.url}/*`, host.url]}
        // startInLoadingState alone can leave the spinner forever when
        // onLoadEnd never arrives — so we hold the state ourselves.
        onLoadEnd={() => setLoaded(true)}
        onLoadProgress={({ nativeEvent }) => {
          setProgress(nativeEvent.progress);
          if (nativeEvent.progress >= 1) setLoaded(true);
        }}
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
      {cameraRequest && (
        <View style={styles.cameraOverlay}>
          {cameraPermission?.granted ? (
            <CameraView
              ref={cameraRef}
              style={styles.cameraPreview}
              facing="back"
              onCameraReady={() => setCameraReady(true)}
            />
          ) : (
            <View style={styles.cameraPermission}>
              <Text style={styles.cameraTitle}>Camera access is required</Text>
              <Text style={styles.cameraBody}>Allow camera access to take a photo for this message.</Text>
              <Pressable style={styles.cameraButton} onPress={() => void requestCameraPermission()}>
                <Text style={styles.cameraButtonText}>Allow camera</Text>
              </Pressable>
            </View>
          )}
          <View style={styles.cameraControls}>
            <Pressable style={styles.cameraCancel} onPress={() => setCameraRequest(null)}>
              <Text style={styles.cameraCancelText}>Cancel</Text>
            </Pressable>
            {cameraPermission?.granted && (
              <Pressable style={[styles.cameraButton, !cameraReady && styles.cameraButtonDisabled]} disabled={!cameraReady} onPress={() => void takeNativePhoto()}>
                <Text style={styles.cameraButtonText}>Take photo</Text>
              </Pressable>
            )}
          </View>
        </View>
      )}
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
  cameraOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 10, backgroundColor: "#070707", padding: 16 },
  cameraPreview: { flex: 1, borderRadius: 18, overflow: "hidden" },
  cameraPermission: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  cameraTitle: { color: "#fcfcfc", fontSize: 18, fontWeight: "700", textAlign: "center" },
  cameraBody: { color: "#fcfcfc99", fontSize: 14, textAlign: "center" },
  cameraControls: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12, paddingTop: 14, paddingBottom: 8 },
  cameraButton: { backgroundColor: "#fcfcfc", borderRadius: 10, paddingHorizontal: 20, paddingVertical: 12 },
  cameraButtonDisabled: { opacity: 0.45 },
  cameraButtonText: { color: "#070707", fontWeight: "700" },
  cameraCancel: { borderRadius: 10, paddingHorizontal: 18, paddingVertical: 12, backgroundColor: "#2f2f2f" },
  cameraCancelText: { color: "#fcfcfc", fontWeight: "600" },
});
