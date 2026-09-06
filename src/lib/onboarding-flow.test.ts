// Source-string checks: the shell has no DOM test runner, so the first-run
// screen and the WebView bridge are asserted by reading the files. Cheap, and
// it catches exactly the regressions that hurt — a pairing leftover coming
// back, or the join bridge disappearing in a web UI port.
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const screen = readFileSync("src/screens/AddHostScreen.tsx", "utf8");
const webview = readFileSync("src/screens/WebViewScreen.tsx", "utf8");

test("QR pairing is gone from the first-run screen", () => {
  for (const dead of ["parseQrPayload", "claimPairing", "CameraView", "pairingCredential", "/api/pair"]) {
    assert.ok(!screen.includes(dead), `AddHostScreen still mentions ${dead}`);
  }
});

test("first run offers both cards, with setup Android-only", () => {
  assert.ok(screen.includes("Set up a server"));
  assert.ok(screen.includes("Sign in to a server"));
  assert.ok(screen.includes("iPhone can&apos;t host a server"));
  assert.match(screen, /Platform\.OS === "android"/);
});

test("sign-in asks for the three values and never stores the password", () => {
  assert.ok(screen.includes("Address"));
  assert.ok(screen.includes("Server name"));
  assert.ok(screen.includes("Server password"));
  assert.match(screen, /secureTextEntry=\{!showPassword\}/);
  // saveHost is called with the host only — a second argument would be a token.
  assert.match(screen, /saveHost\(host\)/);
});

test("setup automates the Termux steps instead of only describing them", () => {
  assert.ok(screen.includes("installTermux"));
  assert.ok(screen.includes("Clipboard.setStringAsync"));
  assert.ok(screen.includes("com.termux"));
  assert.ok(screen.includes("android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS"));
  assert.ok(screen.includes("install-termux.sh"));
  assert.match(screen, /LOCAL_PROBE_INTERVAL_MS = 3_000/);
});

test("the WebView bridge carries host.join both ways", () => {
  assert.ok(webview.includes('msg?.type === "host.join"'));
  assert.ok(webview.includes('"host.join.result"'));
  assert.ok(webview.includes('msg?.type === "tls.forget"'));
});

test("the shell hands the page a push token instead of registering itself", () => {
  assert.ok(webview.includes('msg?.type === "push.request"'));
  assert.ok(webview.includes('type: "push.token"'));
  assert.ok(webview.includes("requestPushPermission"));
  // Without a host token, host-authenticated registration would silently never
  // run — the worst possible failure for notifications.
  const push = readFileSync("src/lib/push.ts", "utf8");
  assert.ok(!push.includes("ensurePushRegistered"), "dead host-token registration is back in push.ts");
  assert.ok(!push.includes("hostAuthHeaders"), "push.ts authenticates to the host again");
  assert.ok(!push.includes("fetch("), "push.ts calls the host again");
});

test("privileged bridge messages need the per-mount nonce", () => {
  assert.match(webview, /const PRIVILEGED = new Set\(\[[^\]]*"host\.join"[^\]]*"tls\.forget"[^\]]*"push\.request"/s);
  assert.ok(webview.includes("PRIVILEGED.has(msg?.type) && msg?.nonce !== nonce"));
  // The noVNC frame gets a ReactNativeWebView of its own, so opening the camera
  // and reading the clipboard are gated like the rest — and the gate has to run
  // BEFORE their handlers, which is what tripped them up the first time.
  assert.match(webview, /const PRIVILEGED = new Set\(\[[^\]]*"native\.camera\.request"[^\]]*"native\.clipboard\.image"/s);
  assert.ok(
    webview.indexOf("PRIVILEGED.has(msg?.type)") < webview.indexOf('msg?.type === "native.camera.request"'),
    "the nonce gate must come before the camera and clipboard handlers",
  );
  assert.ok(webview.includes("injectedJavaScriptBeforeContentLoadedForMainFrameOnly"));
  // A page that could navigate anywhere would carry the bridge with it.
  assert.ok(!webview.includes('originWhitelist={["*"]}'));
  assert.ok(webview.includes("originWhitelist={[`${host.url}/*`, host.url]}"));
});

test("dropping a certificate pin needs a native confirmation and the current host", () => {
  assert.ok(webview.includes("Alert.alert("));
  assert.ok(webview.includes("forgetServer(host.url)"));
  // Never the URL the page asked for: that would let any frame unpin anything.
  assert.ok(!webview.includes("forgetServer(msg.url)"));
});

test("nothing in the shell builds a plain http address for a host", () => {
  for (const file of ["src/lib/host-logic.ts", "src/lib/tls.ts", "src/screens/AddHostScreen.tsx"]) {
    assert.ok(!/["'`]http:\/\//.test(readFileSync(file, "utf8")), `${file} still builds an http:// address`);
  }
});

test("only an onion host is routed through Tor, and the WebView proxy is set both ways", () => {
  // The gate is the address, nothing else: a LAN or tailnet host must never
  // start Tor, and must have the process-wide proxy override taken back off.
  assert.ok(webview.includes("isOnionHost(host.url)"));
  assert.ok(webview.includes("setWebViewProxyFor(host.url)"));
  assert.ok(webview.includes("prepareTor(host.url)"));
  // Tor and the proxy come before the first probe/load, otherwise an onion
  // address is dialled while nothing can reach it.
  assert.ok(
    webview.indexOf("setWebViewProxyFor(host.url)") < webview.indexOf("await probeHost(host.url"),
    "the WebView proxy must be applied before the host is probed",
  );

  const tor = readFileSync("src/lib/tor.ts", "utf8");
  // clearWebViewProxy is NOT conditional on Tor running: a leftover override
  // would silently break every ordinary host after visiting an onion one.
  assert.match(tor, /if \(!isOnionHost\(url\)\) \{\s*await native\.clearWebViewProxy\(\);/);
  // ProxyController lives in the native module; the shell never touches it.
  assert.ok(!webview.includes("ProxyController"));
  const native = readFileSync(
    "modules/multibot-tor/android/src/main/java/expo/modules/multibottor/MultibotTor.kt",
    "utf8",
  );
  assert.ok(native.includes("ProxyController.getInstance().setProxyOverride"));
  assert.ok(native.includes("ProxyController.getInstance().clearProxyOverride"));
});

test("the CONNECT bridge is loopback-only, onion-only, and never resolves a name", () => {
  const native = readFileSync(
    "modules/multibot-tor/android/src/main/java/expo/modules/multibottor/MultibotTor.kt",
    "utf8",
  );
  // An open proxy on the phone would be a hole, so the listener binds loopback
  // and the accept loop drops anything that somehow arrives from elsewhere.
  assert.ok(native.includes("ServerSocket(0, 64, InetAddress.getLoopbackAddress())"));
  assert.ok(native.includes("!client.inetAddress.isLoopbackAddress"));
  // CONNECT to a clearnet host must be refused: the bridge is for onions only.
  assert.match(native, /ONION = Regex\("""\^\[a-z2-7\]\{56\}\\.onion\$"""\)/);
  assert.ok(native.includes('!parts[0].equals("CONNECT", ignoreCase = true)'));
  assert.ok(native.includes("!ONION.matches(host)"));
  // The DNS leak this whole module exists to prevent: the target handed to the
  // SOCKS route has to be UNRESOLVED, on both the bridge and the TLS probe.
  assert.ok(native.includes("InetSocketAddress.createUnresolved(target.first, target.second)"));
  const tls = readFileSync(
    "modules/multibot-tls/android/src/main/java/expo/modules/multibottls/MultibotTls.kt",
    "utf8",
  );
  assert.ok(tls.includes("InetSocketAddress.createUnresolved(host, port)"));
  // And fetch fails closed rather than asking the system resolver for a .onion.
  assert.ok(tls.includes("throw UnknownHostException"));
});

test("signing in over Tor says so instead of spinning silently", () => {
  assert.ok(screen.includes("Connecting through Tor (up to 30 s)…"));
  assert.ok(screen.includes("isOnionHost(normalizeHostUrl(url))"));
});

test("the tor binary is packaged so it can actually be executed", () => {
  const app = JSON.parse(readFileSync("app.json", "utf8"));
  const build = app.expo.plugins.find((p: unknown) => Array.isArray(p) && p[0] === "expo-build-properties");
  // MultibotTor execs `nativeLibraryDir/libtor.so`. With the modern packaging
  // Expo defaults to, native libraries stay compressed inside the APK and are
  // mapped straight out of it — nativeLibraryDir is then empty and the exec
  // fails at runtime, with nothing at build time to warn you. Legacy packaging
  // (extractNativeLibs=true) is what puts a real file on disk.
  assert.equal(build[1].android.useLegacyPackaging, true);
  assert.equal(app.expo.runtimeVersion, "1.6.0", "a new native module needs a new runtime, not an OTA");

  const gradle = readFileSync("modules/multibot-tor/android/build.gradle", "utf8");
  // 0.4.9.6.2 and later require compileSdk 37, which Expo SDK 54 does not use —
  // AGP fails the build on the AAR metadata check, so the version is pinned.
  assert.ok(gradle.includes("implementation 'info.guardianproject:tor-android:0.4.9.6'"));
  const native = readFileSync(
    "modules/multibot-tor/android/src/main/java/expo/modules/multibottor/MultibotTor.kt",
    "utf8",
  );
  // Our own torrc and our own subprocess: TorService pins DataDirectory and the
  // control socket on its command line and could never be given this config.
  assert.ok(!native.includes("import org.torproject"), "MultibotTor pulled in the AAR's own service");
  assert.ok(native.includes("ClientOnly 1"));
  assert.ok(native.includes("SocksPort auto"));
});
