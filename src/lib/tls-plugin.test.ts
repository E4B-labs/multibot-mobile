// The TLS patches are the difference between "the phone reaches a 0.4.0 server"
// and "the phone reaches nothing", and they are applied to files this repo does
// not own. So run them against the real react-native-webview and React Native
// sources that are installed right now: an upstream bump that moves an anchor
// fails here instead of at prebuild — or, worse, silently at runtime.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const plugin = require("../../plugins/with-tls-pinning.js");

const SOURCES = [
  ["RNCWebViewClient.java", "node_modules/react-native-webview/android/src/main/java/com/reactnativecommunity/webview/RNCWebViewClient.java", plugin.patchWebViewClientJava, 1],
  ["RNCWebViewImpl.m", "node_modules/react-native-webview/apple/RNCWebViewImpl.m", plugin.patchWebViewImplObjC, 2],
  ["RCTHTTPRequestHandler.mm", "node_modules/react-native/Libraries/Network/RCTHTTPRequestHandler.mm", plugin.patchRequestHandlerObjC, 2],
] as const;

for (const [name, path, patch, blocks] of SOURCES) {
  test(`${name} takes the pinning patch exactly once and stays idempotent`, () => {
    const source = readFileSync(path, "utf8");
    assert.ok(!source.includes(plugin.MARKER), `${name} already carries the marker — node_modules is patched on disk`);

    const once = patch(source);
    const begins = once.split(`BEGIN ${plugin.MARKER}`).length - 1;
    const ends = once.split(`END ${plugin.MARKER}`).length - 1;
    assert.equal(begins, blocks, `${name} should gain ${blocks} marked block(s)`);
    assert.equal(ends, blocks);

    assert.equal(patch(once), once, `${name} patch is not idempotent`);
  });
}

test("the Android patch proceeds only on a fingerprint match", () => {
  const source = readFileSync(SOURCES[0][1], "utf8");
  const patched = plugin.patchWebViewClientJava(source);
  assert.ok(patched.includes('getSharedPreferences("multibot_tls"'));
  assert.ok(patched.includes("equalsIgnoreCase(mbHex.toString())"));
  // proceed() must sit inside the pinned branch, before the untouched cancel().
  assert.ok(patched.indexOf("handler.proceed();") < patched.indexOf("handler.cancel();"));
  assert.equal(patched.split("handler.cancel();").length - 1, 1);
});

test("the iOS patches read the same store and fall back to default handling", () => {
  for (const [, path, patch] of SOURCES.slice(1)) {
    const patched = patch(readFileSync(path, "utf8"));
    assert.ok(patched.includes('initWithSuiteName:@"multibot_tls"'));
    assert.ok(patched.includes("CC_SHA256"));
    assert.ok(patched.includes("NSURLSessionAuthChallengePerformDefaultHandling"));
  }
});

test("the ObjC helper lands at file scope, not inside an @implementation", () => {
  for (const [name, path, patch] of SOURCES.slice(1)) {
    const patched = patch(readFileSync(path, "utf8"));
    const helper = patched.indexOf("static BOOL MultibotTlsTrusted");
    assert.ok(helper > -1, `${name} lost the helper`);
    // The last @implementation opened before the helper must already have been
    // closed — a C function defined between @implementation and @end is not
    // portable, and the method that calls it has to see the declaration first.
    // (`@end` also closes `@interface`, so counting the two is not the test.)
    const lastOpen = patched.lastIndexOf("\n@implementation ", helper);
    const lastClose = patched.lastIndexOf("\n@end", helper);
    assert.ok(lastOpen < lastClose, `${name} defines the helper inside an @implementation block`);
    assert.ok(patched.indexOf("MultibotTlsTrusted(", helper + 1) > helper, `${name} never calls the helper`);
  }
});

test("a moved anchor fails loudly instead of shipping an unpatched build", () => {
  assert.throws(() => plugin.patchWebViewClientJava("class Nothing {}\n"), /anchor not found/);
  assert.throws(() => plugin.patchWebViewImplObjC("@interface Nothing\n@end\n"), /anchor not found/);
  assert.throws(() => plugin.patchRequestHandlerObjC("@implementation Nothing\n@end\n"), /anchor not found/);
});
