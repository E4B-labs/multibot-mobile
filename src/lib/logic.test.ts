// Self-check for the pure logic in host-logic.ts and pair.ts. Zero
// dependencies — runs under plain Node (`node clients/mobile/src/lib/logic.test.ts`),
// not wired into root vitest (clients/mobile isn't in the root workspace).
import assert from "node:assert/strict";
import { test } from "node:test";

import { buildBootstrap, isTailnetUrl, hostAuthHeaders, newHostId, normalizeHostUrl, removeHostById, renameHost, formatLastUsed, resolveStartupHost, tlsKey, touchHost, upsertHost, type Host } from "./host-logic.ts";

test("normalizeHostUrl strips trailing slashes and insists on https", () => {
  assert.equal(normalizeHostUrl("https://host.ts.net/"), "https://host.ts.net");
  assert.equal(normalizeHostUrl(" 127.0.0.1:8799// "), "https://127.0.0.1:8799");
  // MultiBot has been https-only since 0.4.0; http would put the server
  // password on the wire in the clear.
  assert.throws(() => normalizeHostUrl("http://127.0.0.1:8799"), /https/);
  assert.throws(() => normalizeHostUrl("not-a-url"));
  assert.throws(() => normalizeHostUrl(""));
  assert.throws(() => normalizeHostUrl("ftp.example://example.com"));
});

test("normalizeHostUrl takes a bare IPv6 address with a port", () => {
  assert.equal(normalizeHostUrl("[2a00:1:2::9]:8799"), "https://[2a00:1:2::9]:8799");
  assert.equal(normalizeHostUrl("https://[2a00:1:2::9]:8799/"), "https://[2a00:1:2::9]:8799");
});

test("tlsKey matches the host:port the native store is keyed by", () => {
  assert.equal(tlsKey("https://127.0.0.1:8799"), "127.0.0.1:8799");
  assert.equal(tlsKey("https://Host.TS.net"), "host.ts.net:443");
  assert.equal(tlsKey("https://[2A00:1:2::9]:8799"), "2a00:1:2::9:8799");
});

test("host bearer requests opt into protocol v2", () => {
  assert.deepEqual(hostAuthHeaders("secret"), {
    authorization: "Bearer secret",
    "x-multibot-protocol": "2",
  });
});

test("normalizeHostUrl accepts a bare host and rejects credentials", () => {
  assert.equal(normalizeHostUrl("host.ts.net/"), "https://host.ts.net");
  assert.throws(() => normalizeHostUrl("https://user:password@host.ts.net"));
  assert.throws(() => normalizeHostUrl("https://"));
});

test("upsertHost replaces by id and sorts most-recently-used first", () => {
  const a: Host = { id: "a", name: "A", url: "https://a", createdAt: 1, lastUsedAt: 1 };
  const b: Host = { id: "b", name: "B", url: "https://b", createdAt: 2, lastUsedAt: 2 };
  const list = upsertHost([a], b);
  assert.deepEqual(list, [b, a]);

  const a2: Host = { id: "a", name: "A2", url: "https://a2", createdAt: 1, lastUsedAt: 3 };
  const replaced = upsertHost(list, a2);
  assert.deepEqual(replaced, [a2, b]);
});

test("resolveStartupHost opens the most recently used host", () => {
  const hosts: Host[] = [
    { id: "old", name: "Old", url: "https://old.example", createdAt: 1, lastUsedAt: 10 },
    { id: "recent", name: "Recent", url: "https://recent.example", createdAt: 2, lastUsedAt: 20 },
  ];
  assert.equal(resolveStartupHost(hosts)?.id, "recent");
  assert.equal(resolveStartupHost([]), null);
});

test("touchHost marks the selected host as recent without changing other records", () => {
  const hosts: Host[] = [
    { id: "old", name: "Old", url: "https://old.example", createdAt: 1, lastUsedAt: 10 },
    { id: "recent", name: "Recent", url: "https://recent.example", createdAt: 2, lastUsedAt: 20 },
  ];
  const touched = touchHost(hosts, "old", 30);
  assert.deepEqual(touched.map((host) => host.id), ["old", "recent"]);
  assert.equal(touched[0].lastUsedAt, 30);
  assert.equal(touched[1], hosts[1]);
  assert.deepEqual(touchHost(hosts, "missing", 30), hosts);
});

test("removeHostById drops only the matching id", () => {
  const hosts: Host[] = [
    { id: "a", name: "A", url: "https://a", createdAt: 1, lastUsedAt: 1 },
    { id: "b", name: "B", url: "https://b", createdAt: 2, lastUsedAt: 2 },
  ];
  assert.deepEqual(
    removeHostById(hosts, "a").map((h) => h.id),
    ["b"],
  );
});

test("newHostId returns distinct, non-empty ids", () => {
  const ids = new Set(Array.from({ length: 20 }, () => newHostId()));
  assert.equal(ids.size, 20);
  for (const id of ids) assert.ok(id.startsWith("h_"));
});

test("renameHost swaps only the matching id and keeps other fields", () => {
  const hosts: Host[] = [
    { id: "a", name: "A", url: "https://a", createdAt: 1, lastUsedAt: 1 },
    { id: "b", name: "B", url: "https://b", createdAt: 2, lastUsedAt: 2 },
  ];
  const renamed = renameHost(hosts, "a", "  New A  ");
  assert.equal(renamed[0].name, "New A");
  assert.equal(renamed[0].url, "https://a");
  assert.equal(renamed[1].name, "B");
  // unknown id and blank name are no-ops
  assert.deepEqual(renameHost(hosts, "z", "Z"), hosts);
  assert.deepEqual(renameHost(hosts, "a", "   "), hosts);
});

test("formatLastUsed buckets recent and old timestamps", () => {
  const now = Date.now();
  assert.equal(formatLastUsed(now - 30_000), "just now");
  assert.equal(formatLastUsed(now - 5 * 60_000), "5 min ago");
  assert.equal(formatLastUsed(now - 3 * 3_600_000), "3 hr ago");
  assert.equal(formatLastUsed(now - 1 * 86_400_000), "yesterday");
  assert.equal(formatLastUsed(now - 3 * 86_400_000), "3 days ago");
});

test("a host without a saved token opens the web sign-in instead of failing", () => {
  const anon = buildBootstrap({ token: null, statusBarHeight: 24, appVersion: "1.0.0" });
  assert.ok(!anon.includes("multibot.auth.token"));
  assert.ok(anon.includes("--android-status-bar"));

  // Legacy hosts keep the token bootstrap.
  const legacy = buildBootstrap({ token: "t0k", botId: "b1", statusBarHeight: 0, appVersion: "1.0.0" });
  assert.ok(legacy.includes('localStorage.setItem("multibot.auth.token", "t0k")'));
  assert.ok(legacy.includes("#bot=b1"));
});

test("the join grant reaches the web UI through the fragment", () => {
  const joining = buildBootstrap({ fragment: "#join=g-1", statusBarHeight: 0, appVersion: "1.0.0" });
  assert.ok(joining.includes('location.hash = "#join=g-1"'));

  // A notification tap wins: the user asked for that bot, not for a sign-in.
  const both = buildBootstrap({ botId: "b1", fragment: "#join=g-1", statusBarHeight: 0, appVersion: "1.0.0" });
  assert.ok(both.includes("#bot=b1"));
  assert.ok(!both.includes("#join="));
});

test("the Tailscale hint is only for tailnet addresses", () => {
  assert.equal(isTailnetUrl("http://100.78.241.9:8799"), true);
  assert.equal(isTailnetUrl("https://random-words.trycloudflare.com"), false);
  assert.equal(isTailnetUrl("https://100things.example.com"), false);
});
