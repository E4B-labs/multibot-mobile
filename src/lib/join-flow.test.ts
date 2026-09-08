// Pure self-check for the sign-in flow: which field an error belongs to, how a
// join response is read, and the trust-on-first-use decision. Nothing here
// touches the network or a native module.
import assert from "node:assert/strict";
import { test } from "node:test";

import { joinErrorField, joinErrorMessage, joinFragment, parseJoinResponse, parseLoginResponse, sessionFragment, type JoinErrorCode } from "./join.ts";
import { rememberedEntryOf } from "./host-logic.ts";
import { expectedSha256, pickTermuxApk } from "./release-assets.ts";

test("every join error lands on the field the user can fix", () => {
  assert.equal(joinErrorField("unreachable"), "address");
  assert.equal(joinErrorField("timeout"), "address");
  assert.equal(joinErrorField("not_multibot"), "address");
  assert.equal(joinErrorField("server_not_set_up"), "address");
  assert.equal(joinErrorField("certificate_changed"), "address");
  assert.equal(joinErrorField("invalid_address"), "address");
  assert.equal(joinErrorField("wrong_server_name"), "serverName");
  assert.equal(joinErrorField("wrong_server_password"), "serverPassword");
  assert.equal(joinErrorField("rate_limited"), "form");
  assert.equal(joinErrorField("failed"), "form");
});

test("every join error has its own message", () => {
  const codes: JoinErrorCode[] = [
    "invalid_address",
    "unreachable",
    "timeout",
    "not_multibot",
    "server_not_set_up",
    "certificate_changed",
    "wrong_server_name",
    "wrong_server_password",
    "rate_limited",
    "failed",
  ];
  const messages = codes.map(joinErrorMessage);
  assert.equal(new Set(messages).size, codes.length);
  for (const message of messages) assert.ok(message.length > 0);
});

test("a successful join yields the grant the web UI needs", () => {
  const ok = parseJoinResponse(200, { joinGrant: "g-1", expiresAt: 1, hasUsers: true });
  assert.deepEqual(ok, { ok: true, joinGrant: "g-1", hasUsers: true });
  assert.equal(joinFragment("g-1"), "#join=g-1");
  assert.equal(joinFragment("a b/c"), "#join=a%20b%2Fc");
});

test("a 200 without a grant is not a MultiBot server", () => {
  assert.deepEqual(parseJoinResponse(200, {}), { ok: false, error: "not_multibot" });
  assert.deepEqual(parseJoinResponse(200, { joinGrant: "" }), { ok: false, error: "not_multibot" });
});

test("the server's own error codes are passed through, others are not", () => {
  assert.deepEqual(parseJoinResponse(401, { error: "wrong_server_name" }), { ok: false, error: "wrong_server_name" });
  assert.deepEqual(parseJoinResponse(401, { error: "wrong_server_password" }), { ok: false, error: "wrong_server_password" });
  assert.deepEqual(parseJoinResponse(404, { error: "server_not_set_up" }), { ok: false, error: "server_not_set_up" });
  assert.deepEqual(parseJoinResponse(429, {}), { ok: false, error: "rate_limited" });
  // A bare 404 is some other web server, not a MultiBot server missing setup.
  assert.deepEqual(parseJoinResponse(404, {}), { ok: false, error: "not_multibot" });
  assert.deepEqual(parseJoinResponse(500, { error: "boom" }), { ok: false, error: "failed" });
  assert.deepEqual(parseJoinResponse(401, null), { ok: false, error: "failed" });
});

test("a Termux checksum listing yields the digest for one exact file", () => {
  const listing = [
    "7600078440c3c34ef050bc009b00fc3215cb87ec4a449e01a696f74cf4249db2  termux-app_v0.118.3+github-debug_universal.apk",
    "72fdb596045116bf5ba1b5bdf5b26fddb9acc0bd074ad9f2da9eb0ae85e83a4e  termux-app_v0.118.3+github-debug_arm64-v8a.apk",
    "",
  ].join("\n");
  assert.equal(
    expectedSha256(listing, "termux-app_v0.118.3+github-debug_universal.apk"),
    "7600078440c3c34ef050bc009b00fc3215cb87ec4a449e01a696f74cf4249db2",
  );
  // A near-miss on the name must not borrow another file's digest.
  assert.equal(expectedSha256(listing, "termux-app_v0.118.3+github-debug_universal.ap"), null);
  assert.equal(expectedSha256(listing, "missing.apk"), null);
  assert.equal(expectedSha256("", "anything.apk"), null);
});

test("only the universal APK is picked, with its checksum file", () => {
  const assets = [
    { name: "termux-app_v1_arm64-v8a.apk", browser_download_url: "https://github.com/a.apk" },
    { name: "termux-app_v1_universal.apk", browser_download_url: "https://github.com/u.apk" },
    { name: "termux-app_v1_sha256sums", browser_download_url: "https://github.com/s" },
  ];
  assert.deepEqual(pickTermuxApk(assets), {
    name: "termux-app_v1_universal.apk",
    url: "https://github.com/u.apk",
    sumsUrl: "https://github.com/s",
  });
  // An asset hosted somewhere other than the release CDN is not an asset.
  assert.equal(pickTermuxApk([{ name: "termux-app_v1_universal.apk", browser_download_url: "https://evil.example/u.apk" }]), null);
  assert.equal(pickTermuxApk([]), null);
  assert.equal(pickTermuxApk(undefined), null);
});

test("a remembered login is only offerable once both halves are in", () => {
  const full = { url: "https://10.0.0.5:8799", serverName: "brave-otter", serverPassword: "7f3k", username: "kacper", password: "correct horse battery" };
  // Nazwa serwera i profilu wychodzą na przycisk. Hasła NIE wychodzą nigdzie.
  assert.deepEqual(rememberedEntryOf(full), { url: full.url, serverName: "brave-otter", username: "kacper" });
  // Sama połowa serwerowa: przycisk prowadziłby prosto z powrotem do formularza.
  assert.equal(rememberedEntryOf({ url: full.url, serverName: "brave-otter", serverPassword: "7f3k" }), null);
  assert.equal(rememberedEntryOf({ ...full, password: "" }), null);
  assert.equal(rememberedEntryOf(null), null);
});

test("a native login answer is read down to one code the screen can show", () => {
  assert.deepEqual(parseLoginResponse(200, { accessToken: "a1", sessionToken: "s1" }), { ok: true, accessToken: "a1", sessionToken: "s1" });
  // Serwer bez tokenu sesji nie unieważnia logowania — WebView po prostu
  // straci je przy pierwszym odnowieniu, a to jest widać w interfejsie.
  assert.deepEqual(parseLoginResponse(200, { accessToken: "a1" }), { ok: true, accessToken: "a1", sessionToken: "" });
  assert.deepEqual(parseLoginResponse(401, { error: "wrong_profile_password" }), { ok: false, error: "wrong_profile_password" });
  assert.deepEqual(parseLoginResponse(404, { error: "no_such_profile" }), { ok: false, error: "no_such_profile" });
  assert.deepEqual(parseLoginResponse(429, {}), { ok: false, error: "rate_limited" });
  // Tekstu z sieci nie wpuszczamy do formularza.
  assert.deepEqual(parseLoginResponse(401, { error: "Zadzwon pod 0700-oszust" }), { ok: false, error: "failed" });
  assert.deepEqual(parseLoginResponse(200, { accessToken: "" }), { ok: false, error: "failed" });
});

test("the shell hands a signed-in page both tokens, and escapes them", () => {
  assert.equal(sessionFragment("a 1", "s&1"), "#access_token=a%201&session=s%261");
  assert.equal(sessionFragment("a1", ""), "#access_token=a1");
});
