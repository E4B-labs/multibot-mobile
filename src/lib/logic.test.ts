// Self-check for the pure logic in host-logic.ts and pair.ts. Zero
// dependencies — runs under plain Node (`node clients/mobile/src/lib/logic.test.ts`),
// not wired into root vitest (clients/mobile isn't in the root workspace).
import assert from "node:assert/strict";
import { test } from "node:test";

import { newHostId, normalizeHostUrl, removeHostById, renameHost, formatLastUsed, resolveStartupHost, touchHost, upsertHost, type Host } from "./host-logic.ts";
import { parseQrPayload } from "./pair.ts";

test("normalizeHostUrl strips trailing slashes and validates scheme", () => {
  assert.equal(normalizeHostUrl("https://host.ts.net/"), "https://host.ts.net");
  assert.equal(normalizeHostUrl(" http://127.0.0.1:8799// "), "http://127.0.0.1:8799");
  assert.throws(() => normalizeHostUrl("not-a-url"));
  assert.throws(() => normalizeHostUrl(""));
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

test("parseQrPayload accepts the PLAN-CLIENTS {url, code} shape", () => {
  const result = parseQrPayload('{"url":"https://host.ts.net","code":"123456"}');
  assert.deepEqual(result, { url: "https://host.ts.net", code: "123456" });
});

test("parseQrPayload accepts a bare URL and rejects garbage", () => {
  assert.deepEqual(parseQrPayload("https://host.ts.net"), { url: "https://host.ts.net" });
  assert.equal(parseQrPayload("not a url or json"), null);
  assert.equal(parseQrPayload(""), null);
  assert.equal(parseQrPayload("{}"), null);
});
