// Self-check for the pure logic in host-logic.ts and pair.ts. Zero
// dependencies — runs under plain Node (`node clients/mobile/src/lib/logic.test.ts`),
// not wired into root vitest (clients/mobile isn't in the root workspace).
import assert from "node:assert/strict";
import { test } from "node:test";

import { newHostId, normalizeHostUrl, removeHostById, upsertHost, type Host } from "./host-logic.ts";
import { parseQrPayload } from "./pair.ts";

test("normalizeHostUrl strips trailing slashes and validates scheme", () => {
  assert.equal(normalizeHostUrl("https://host.ts.net/"), "https://host.ts.net");
  assert.equal(normalizeHostUrl(" http://127.0.0.1:8799// "), "http://127.0.0.1:8799");
  assert.throws(() => normalizeHostUrl("not-a-url"));
  assert.throws(() => normalizeHostUrl(""));
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
