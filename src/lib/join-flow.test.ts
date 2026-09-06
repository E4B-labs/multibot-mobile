// Pure self-check for the sign-in flow: which field an error belongs to, how a
// join response is read, and the trust-on-first-use decision. Nothing here
// touches the network or a native module.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  joinErrorField,
  joinErrorMessage,
  joinFragment,
  parseJoinResponse,
  sameFingerprint,
  tofuDecision,
  type JoinErrorCode,
} from "./join.ts";

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

test("a fingerprint comparison ignores case and padding", () => {
  assert.equal(sameFingerprint("AB:cd", " ab:CD "), true);
  assert.equal(sameFingerprint("abcd", "abce"), false);
  assert.equal(sameFingerprint(null, "abcd"), false);
  assert.equal(sameFingerprint("abcd", undefined), false);
  assert.equal(sameFingerprint(null, null), false);
});

test("trust on first use pins once and refuses a swapped certificate", () => {
  assert.equal(tofuDecision(null, "aa11"), "trust");
  assert.equal(tofuDecision("", "aa11"), "trust");
  assert.equal(tofuDecision("AA11", "aa11"), "match");
  assert.equal(tofuDecision("aa11", "bb22"), "certificate_changed");
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
