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

test("nothing in the shell builds a plain http address for a host", () => {
  for (const file of ["src/lib/host-logic.ts", "src/lib/tls.ts", "src/screens/AddHostScreen.tsx"]) {
    assert.ok(!/["'`]http:\/\//.test(readFileSync(file, "utf8")), `${file} still builds an http:// address`);
  }
});
