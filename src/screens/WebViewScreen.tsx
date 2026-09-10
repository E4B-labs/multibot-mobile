import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, BackHandler, Platform, Pressable, StatusBar, StyleSheet, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Clipboard from "expo-clipboard";
import { WebView } from "react-native-webview";
import * as Application from "expo-application";
import * as Updates from "expo-updates";

import { buildBootstrap, isOnionHost, isPrivateLanUrl, isTailnetUrl, probeServer, rememberedEntryOf, type AppInfo, type Host } from "../lib/host-logic";
import { forgetRemembered, getHostToken, readRemembered, rememberProfile } from "../lib/hosts";
import { joinErrorMessage, loginErrorMessage, type JoinErrorCode, type LoginErrorCode } from "../lib/join";
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
  onJoinHost?: (url: string, serverName: string, serverPassword: string, remember?: boolean) => Promise<{ ok: boolean; error?: JoinErrorCode }>;
  /** One-tap sign-in from inside the web UI, after a sign-out: the shell holds
   * the five remembered values, joins AND logs the profile in natively, then
   * remounts this screen with a ready session in the fragment. */
  onSignInRemembered?: () => Promise<{ ok: boolean; error?: JoinErrorCode | LoginErrorCode }>;
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
// Same budget as the load, because the probe now starts at the same moment: Tor
// no longer holds the screen until it has a circuit, so this one request has to
// cover the bootstrap as well as the trip through it. 45 s used to be enough
// only because nothing dialled anything until the circuit already existed.
const ONION_PROBE_TIMEOUT_MS = 90_000;

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
  // Zapamiętane logowanie: „daj wpis" i „zaloguj" sięgają do SecureStore,
  // „zapamiętaj profil" wkłada tam hasło. Wszystkie trzy za bramką nonce'a —
  // bez niej ramka noVNC mogłaby o nie poprosić.
  "remember.get",
  "remember.signin",
  "remember.profile",
  "remember.forget",
  "tls.forget",
  "push.request",
  "app.update.check",
  "app.update.download",
  "app.update.install",
  "update-log.request",
  "update-log.cancel",
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

type UpdateLogRequest = {
  type: "update-log.request";
  requestId: string;
  repository: string;
  page: number;
};

const UPDATE_LOG_REPOSITORY = "E4B-labs/multibot-mobile";

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

export default function WebViewScreen({ host, botId, fragment, onBack, onBotVisible, onJoinHost, onSignInRemembered }: Props) {
  const webRef = useRef<WebView>(null);
  const updateLogControllers = useRef(new Map<string, AbortController>());
  useEffect(() => () => {
    for (const controller of updateLogControllers.current.values()) controller.abort();
    updateLogControllers.current.clear();
  }, []);
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
  // Ta sama wartość dla sondy, która leci obok ładowania: jej `.then` domyka
  // stan z chwili startu efektu, a ref widzi ten z chwili odpowiedzi.
  const [status, setStatus] = useState("");
  const loadedRef = useRef(false);
  loadedRef.current = loaded;
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
  const [capturing, setCapturing] = useState(false);
  const [installing, setInstalling] = useState(false);
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
        // Pierwszy start Tora to 10–30 s budowania obwodu. Bez tej linijki
        // ekran jest przez ten czas pustym kółkiem i wygląda na zawieszony.
        if (onion) setStatus("Łączę przez Tor — pierwszy obwód to zwykle 10–30 s…");
        await prepareTor(host.url);
        await setWebViewProxyFor(host.url);
        setStatus("");
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
      //
      // Sonda NIE blokuje ładowania. Przez Tora to pełna dodatkowa podróż
      // (rendezvous + TLS + HTTP) po świeżo zbudowanym obwodzie — sekundy
      // czekania z pustym ekranem po to, żeby dowiedzieć się tego, co samo
      // ładowanie powie chwilę później. Leci równolegle i służy już tylko za
      // lepszy komunikat, gdy strona nie wstanie.
      //
      // `loaded` means the BUNDLED html finished parsing, and that html is
      // local — over Tor it now happens while the circuit is still building, so
      // it proves nothing about the network. For an onion host the probe is the
      // only thing that can tell a circuit that is coming from one that never
      // will, so there it reports regardless of `loaded`.
      void probeHost(host.url, onion ? ONION_PROBE_TIMEOUT_MS : PROBE_TIMEOUT_MS).then((problem) => {
        if (!cancelled && problem && (onion || !loadedRef.current)) setFailed(problem);
      });
      // multibot: co to za INSTALACJA — odpowiednik bridge'a
      // updatera.currentVersion() na desktopie. Wersja serwera to zupełnie
      // inna liczba (inny program, inna maszyna) i webui pokazuje ją osobno;
      // tutaj idzie wyłącznie APK + paczka OTA, która na nim stoi.
      const app: AppInfo = {
        version: Application.nativeApplicationVersion ?? "",
        build: Application.nativeBuildVersion ?? "",
        ...(Updates.runtimeVersion ? { runtimeVersion: Updates.runtimeVersion } : {}),
        ...(Updates.updateId ? { updateId: Updates.updateId } : {}),
        // `toISOString()` rzuca RangeError na Invalid Date, a rzut z tego
        // miejsca leci w `catch` efektu i podmienia CAŁY ekran na „nie mogę
        // odczytać tokenu". Data z popsutego manifestu ma kosztować jedną
        // linijkę w panelu, nie aplikację.
        ...(Number.isFinite(Updates.createdAt?.getTime())
          ? { updateCreatedAt: Updates.createdAt!.toISOString() }
          : {}),
        ...(Updates.channel ? { channel: Updates.channel } : {}),
      };
      setBootstrap(buildBootstrap({ token, botId, fragment, bridgeNonce: nonce, statusBarHeight: STATUS_BAR_HEIGHT, app }));
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

  // Zapamiętane logowanie. Strona dostaje z niego WYŁĄCZNIE adres, nazwę
  // serwera i nazwę profilu — dokładnie tyle, ile trzeba na przycisk. Żadne
  // hasło nie przechodzi przez most w tę stronę.
  async function handleRememberGet() {
    const record = await readRemembered().catch(() => null);
    sendToPage({ type: "remember.entry", entry: rememberedEntryOf(record) });
  }

  async function handleRememberSignIn() {
    let result: { ok: boolean; error?: JoinErrorCode | LoginErrorCode };
    try {
      result = onSignInRemembered ? await onSignInRemembered() : { ok: false, error: "failed" };
    } catch {
      result = { ok: false, error: "failed" };
    }
    // Sukces przeładowuje WebView z nową sesją, więc nie ma już komu odpowiadać.
    if (result.ok) return;
    const code = result.error ?? "failed";
    const login = code === "no_such_profile" || code === "wrong_profile_password" || code === "join_grant_invalid";
    sendToPage({
      type: "remember.signin.result",
      ok: false,
      error: code,
      message: login ? loginErrorMessage(code as LoginErrorCode) : joinErrorMessage(code as JoinErrorCode),
    });
  }

  async function handleJoinHost(msg: { url?: unknown; serverName?: unknown; serverPassword?: unknown; remember?: unknown }) {
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
      result = await onJoinHost(msg.url, msg.serverName, msg.serverPassword, msg.remember === true);
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

  const sendUpdateLogResult = (result: Record<string, unknown>) => {
    webRef.current?.injectJavaScript(
      `window.dispatchEvent(new CustomEvent("mb:update-log", { detail: ${JSON.stringify(result)} })); true;`,
    );
  };

  async function handleUpdateLogRequest(request: UpdateLogRequest) {
    if (request.repository !== UPDATE_LOG_REPOSITORY) {
      sendUpdateLogResult({ requestId: request.requestId, ok: false, status: 400 });
      return;
    }
    const page = Number.isInteger(request.page) && request.page > 0 ? request.page : 1;
    const url = `https://api.github.com/repos/${request.repository}/commits?sha=main&per_page=10&page=${page}`;
    const controller = new AbortController();
    updateLogControllers.current.set(request.requestId, controller);
    try {
      const response = await fetch(url, { headers: { Accept: "application/vnd.github+json" }, signal: controller.signal });
      const body = await response.json().catch(() => null);
      sendUpdateLogResult({
        requestId: request.requestId,
        ok: response.ok,
        status: response.status,
        body,
        link: response.headers.get("link"),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      sendUpdateLogResult({ requestId: request.requestId, ok: false, status: 0 });
    } finally {
      updateLogControllers.current.delete(request.requestId);
    }
  }

  function handleUpdateLogCancel(requestId: string) {
    updateLogControllers.current.get(requestId)?.abort();
    updateLogControllers.current.delete(requestId);
  }

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
      setInstalling(true);
      await Updates.reloadAsync();
    } catch (error) {
      setInstalling(false);
      sendUpdateState({
        status: "error",
        message: error instanceof Error ? error.message : "Could not update the app.",
      });
    }
  }

  async function takeNativePhoto() {
    if (!cameraRequest || !cameraPermission?.granted || !cameraReady) return;
    const request = cameraRequest;
    setCapturing(true);
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
    } finally {
      setCapturing(false);
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
        {isPrivateLanUrl(host.url) && (
          <Text style={styles.errorHint}>
            This is a local-network address — it only exists on that Wi-Fi. On mobile data the phone
            holds no address on that network, so the connection isn&apos;t refused, it just waits out
            the timeout. Sign in to this server&apos;s .onion address to reach it from any network.
          </Text>
        )}
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
        {status ? <Text style={styles.errorBody}>{status}</Text> : null}
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
        setBuiltInZoomControls={false}
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
            if (msg?.type === "remember.get") void handleRememberGet();
            if (msg?.type === "remember.signin") void handleRememberSignIn();
            // Druga połowa wpisu, po udanym logowaniu profilu. Bez czekającej
            // połowy serwerowej to nic nie robi — haczyk był odznaczony.
            if (msg?.type === "remember.profile" && typeof msg.username === "string" && typeof msg.password === "string") {
              void rememberProfile(msg.username, msg.password).catch(() => undefined);
            }
            if (msg?.type === "remember.forget") void forgetRemembered().catch(() => undefined);
            if (msg?.type === "push.request") void handlePushRequest();
            if (
              msg?.type === "update-log.request" &&
              typeof msg.requestId === "string" &&
              typeof msg.repository === "string" &&
              Number.isInteger(msg.page)
            ) {
              void handleUpdateLogRequest(msg as UpdateLogRequest);
            }
            if (msg?.type === "update-log.cancel" && typeof msg.requestId === "string") {
              handleUpdateLogCancel(msg.requestId);
            }
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
          ) : null}
          {capturing && (
            <View style={styles.captureOverlay}>
              <ActivityIndicator color="#fcfcfc" />
              <Text style={styles.errorBody}>Saving photo…</Text>
            </View>
          )}
          {cameraPermission?.granted ? null : (
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
              <Pressable style={[styles.cameraButton, (!cameraReady || capturing) && styles.cameraButtonDisabled]} disabled={!cameraReady || capturing} onPress={() => void takeNativePhoto()}>
                <Text style={styles.cameraButtonText}>{capturing ? "Saving…" : "Take photo"}</Text>
              </Pressable>
            )}
          </View>
        </View>
      )}
      {installing && (
        <View style={styles.captureOverlay}>
          <ActivityIndicator color="#fcfcfc" />
          <Text style={styles.errorBody}>Installing update…</Text>
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
  captureOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 20, alignItems: "center", justifyContent: "center", backgroundColor: "#070707cc", gap: 10 },
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
