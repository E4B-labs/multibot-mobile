// Self-check for the pure logic in host-logic.ts and pair.ts. Zero
// dependencies — runs under plain Node (`node clients/mobile/src/lib/logic.test.ts`),
// not wired into root vitest (clients/mobile isn't in the root workspace).
import assert from "node:assert/strict";
import { test } from "node:test";

import { buildBootstrap, cacheFileName, fileOpenRequestOf, isOnionHost, isPrivateLanUrl, isTailnetUrl, hostAuthHeaders, newHostId, normalizeHostUrl, removeHostById, renameHost, formatLastUsed, resolveStartupHost, shouldReloadOnResume, tlsKey, touchHost, upsertHost, type Host } from "./host-logic.ts";

// A real v3 address is a 56-character base32 label plus `.onion`; the shape is
// what matters here, not that this particular service exists.
const LABEL = "p3xnc3flkjhsdfg7uyt6rewqazxswedcvfrtgbnhyujmkiolp2q4567".padEnd(56, "a");
const ONION = `${LABEL}.onion`;

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
  assert.equal(normalizeHostUrl("[::1]:8799"), "https://[::1]:8799");
  // Brackets mean IPv6, and IPv6 always has a colon.
  assert.throws(() => normalizeHostUrl("[10.0.0.1]:8799"));
  assert.throws(() => normalizeHostUrl("https://[2a00:1:2::9]:99999"));
});

test("an onion address survives normalizing and keys a pin like any other host", () => {
  assert.equal(normalizeHostUrl(`${ONION}:8799`), `https://${ONION}:8799`);
  assert.equal(normalizeHostUrl(` https://${ONION}:8799/ `), `https://${ONION}:8799`);
  // The pin key is what the WebView patch rebuilds from the failing URL, so an
  // onion host must land in the same shape as every other host or the
  // certificate can never match.
  assert.equal(tlsKey(`https://${ONION}:8799`), `${ONION}:8799`);
  assert.equal(tlsKey(`https://${ONION.toUpperCase()}:8799`), `${ONION}:8799`);
  // Still https-only: the whole point of the onion is reaching a TLS server.
  assert.throws(() => normalizeHostUrl(`http://${ONION}:8799`), /https/);
});

test("isOnionHost is true only for a full v3 address", () => {
  assert.equal(isOnionHost(`https://${ONION}:8799`), true);
  assert.equal(isOnionHost(`https://${ONION}`), true);
  assert.equal(isOnionHost(`https://${ONION.toUpperCase()}:8799`), true);
  // Anything else must NOT start Tor: a v2 address (16 chars, dead since 2021),
  // a truncated one, a name that merely ends in the word, and every ordinary
  // host the app already handles.
  assert.equal(isOnionHost("https://expyuzz4wqqyqhjn.onion:8799"), false);
  assert.equal(isOnionHost(`https://${LABEL.slice(0, 55)}.onion`), false);
  assert.equal(isOnionHost(`https://${LABEL}1.onion:8799`), false);
  assert.equal(isOnionHost("https://notreallyanonion:8799"), false);
  assert.equal(isOnionHost("https://sub.example.onion.com"), false);
  assert.equal(isOnionHost("https://127.0.0.1:8799"), false);
  assert.equal(isOnionHost("https://[2a00:1:2::9]:8799"), false);
  assert.equal(isOnionHost("not-a-url"), false);
});

test("tlsKey matches the host:port the native store is keyed by", () => {
  assert.equal(tlsKey("https://127.0.0.1:8799"), "127.0.0.1:8799");
  assert.equal(tlsKey("https://Host.TS.net"), "host.ts.net:443");
  assert.equal(tlsKey("https://localhost:8799"), "localhost:8799");
  // IPv6 is where React Native's URL polyfill goes wrong, so this is the case
  // that decides whether a pin can ever match on device.
  assert.equal(tlsKey("https://[2A00:1:2::9]:8799"), "2a00:1:2::9:8799");
  assert.equal(tlsKey("https://[2a00:1:2::9]"), "2a00:1:2::9:443");
  assert.equal(tlsKey("https://[::1]:8799"), "::1:8799");
  // Same address, same key, whichever spelling the caller used.
  assert.equal(tlsKey(normalizeHostUrl("[2A00:1:2::9]:8799/")), tlsKey("https://[2a00:1:2::9]:8799"));
  assert.throws(() => tlsKey("not-a-url"));
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

const APP = {
  version: "0.5.2",
  build: "26",
  runtimeVersion: "1.6.0",
  updateId: "0192abcd-1111-2222-3333-444455556666",
  updateCreatedAt: "2026-09-07T08:40:00.000Z",
  channel: "production",
};

test("the bootstrap says what this INSTALL is, not what the server is", () => {
  const script = buildBootstrap({ token: null, statusBarHeight: 0, app: APP });
  assert.deepEqual(JSON.parse(/window\.__MULTIBOT_APP__ = (\{.*?\});/.exec(script)![1]), APP);
  // The old single string is gone: it could not tell the APK apart from the
  // OTA bundle running on top of it, which is the whole question here.
  assert.ok(!script.includes("__APP_VERSION__"));

  // An embedded launch carries no OTA fields, so the panel can say "shipped in
  // the APK" instead of printing "undefined".
  const embedded = buildBootstrap({ token: null, statusBarHeight: 0, app: { version: "0.5.2", build: "26" } });
  assert.ok(!embedded.includes("updateId"));
});

test("a host without a saved token opens the web sign-in instead of failing", () => {
  const anon = buildBootstrap({ token: null, statusBarHeight: 24, app: APP });
  assert.ok(!anon.includes("multibot.auth.token"));
  assert.ok(anon.includes("--android-status-bar"));

  // Legacy hosts keep the token bootstrap.
  const legacy = buildBootstrap({ token: "t0k", botId: "b1", statusBarHeight: 0, app: APP });
  assert.ok(legacy.includes('localStorage.setItem("multibot.auth.token", "t0k")'));
  assert.ok(legacy.includes("#bot=b1"));
});

test("the join grant reaches the web UI through the fragment", () => {
  const joining = buildBootstrap({ fragment: "#join=g-1", statusBarHeight: 0, app: APP });
  assert.ok(joining.includes('location.hash = "#join=g-1"'));

  // A notification tap wins: the user asked for that bot, not for a sign-in.
  const both = buildBootstrap({ botId: "b1", fragment: "#join=g-1", statusBarHeight: 0, app: APP });
  assert.ok(both.includes("#bot=b1"));
  assert.ok(!both.includes("#join="));
});

test("the Tailscale hint is only for tailnet addresses", () => {
  assert.equal(isTailnetUrl("http://100.78.241.9:8799"), true);
  assert.equal(isTailnetUrl("https://random-words.trycloudflare.com"), false);
  assert.equal(isTailnetUrl("https://100things.example.com"), false);
});

test("the local-network hint covers RFC1918 and link-local, and nothing else", () => {
  // The address this actually bit on: the phone talking to a server on the
  // phone itself, by way of the Wi-Fi the phone is no longer on.
  assert.equal(isPrivateLanUrl("https://192.168.1.223:8799"), true);
  assert.equal(isPrivateLanUrl("https://10.0.0.5"), true);
  assert.equal(isPrivateLanUrl("https://169.254.1.1"), true);
  assert.equal(isPrivateLanUrl("https://172.16.0.1"), true);
  // 172.32 is public: the private block stops at 172.31.
  assert.equal(isPrivateLanUrl("https://172.32.0.1"), false);
  // A tailnet address gets its OWN hint, because with Tailscale up it works
  // off-network — the one thing a 192.168 address can never do.
  assert.equal(isPrivateLanUrl("https://100.78.241.9:8799"), false);
  assert.equal(isPrivateLanUrl(`https://${ONION}`), false);
});

// ── K1: czarny ekran po powrocie z tła ─────────────────────────────────────

test("powrót z tła przeładowuje WebView tylko wtedy, gdy jest pusty", () => {
  const zdrowy = { next: "active", rendererGone: false, loaded: true, alive: true, failed: false };
  // Żywa strona zostaje jak stała — przeładowanie zabrałoby pozycję w rozmowie.
  assert.equal(shouldReloadOnResume(zdrowy), false);
  // Renderer ubity przez Androida: widok żyje, ale jest pusty. To jest ten
  // czarny ekran i jedyne wyjście to zmontować WebView od nowa.
  assert.equal(shouldReloadOnResume({ ...zdrowy, rendererGone: true }), true);
  // Sonda życia bez odpowiedzi — ten sam skutek, inna przyczyna.
  assert.equal(shouldReloadOnResume({ ...zdrowy, alive: false }), true);
});

test("powrót z tła nie przerywa trwającego ładowania", () => {
  // Onion ma 90 s budżetu. Bez tego wyjścia każde zerknięcie w inną aplikację
  // startowało ładowanie od zera i strona nigdy by nie wstała.
  const laduje = { next: "active", rendererGone: false, loaded: false, alive: false, failed: false };
  assert.equal(shouldReloadOnResume(laduje), false);
  // Chyba że renderer po drodze zginął — wtedy nie ma już czego doczekać.
  assert.equal(shouldReloadOnResume({ ...laduje, rendererGone: true }), true);
});

test("powrót z tła nie rusza ekranu błędu ani stanów innych niż active", () => {
  // Ekran błędu ma własne „Try again" i własny komunikat; podmiana go na
  // spinner ukryłaby przed użytkownikiem, czego nie da się połączyć.
  assert.equal(shouldReloadOnResume({ next: "active", rendererGone: true, loaded: true, alive: false, failed: true }), false);
  for (const next of ["background", "inactive", "unknown"]) {
    assert.equal(shouldReloadOnResume({ next, rendererGone: true, loaded: true, alive: false, failed: false }), false);
  }
});

// ── K5: podgląd i pobranie pliku ───────────────────────────────────────────

test("nazwa z serwera nie wychodzi poza katalog cache", () => {
  assert.equal(cacheFileName("raport.pdf"), "raport.pdf");
  assert.equal(cacheFileName("../../etc/passwd"), "passwd");
  assert.equal(cacheFileName(String.raw`..\..\windows\system32\cmd.exe`), "cmd.exe");
  assert.equal(cacheFileName(".bashrc"), "bashrc");
  assert.equal(cacheFileName(""), "plik");
  assert.equal(cacheFileName(undefined), "plik");
  assert.equal(cacheFileName("a".repeat(300)).length, 100);
});

test("file.open przyjmuje wyłącznie ścieżki na swoim serwerze", () => {
  const HOST = "https://sharp-salmon.example:8799";
  const ok = fileOpenRequestOf({ url: "/api/bots/b1/attachments/f1", name: "raport.pdf", mime: "application/pdf" }, HOST);
  assert.deepEqual(ok, {
    url: `${HOST}/api/bots/b1/attachments/f1`,
    fileName: "raport.pdf",
    mime: "application/pdf",
  });
  // Adres bezwzględny musi BYĆ tym hostem — pobranie leci z tokenem
  // użytkownika, więc obcy adres byłby dziurą, nie wygodą.
  assert.deepEqual(fileOpenRequestOf({ url: `${HOST}/api/bots/b1/attachments/f1` }, HOST)?.url, `${HOST}/api/bots/b1/attachments/f1`);
  assert.equal(fileOpenRequestOf({ url: "https://zly.example/x" }, HOST), null);
  // Prefiks nazwy hosta to nie ten sam host.
  assert.equal(fileOpenRequestOf({ url: `${HOST}.zly.example/x` }, HOST), null);
  assert.equal(fileOpenRequestOf({ url: "blob:https://sharp-salmon.example/abc" }, HOST), null);
  assert.equal(fileOpenRequestOf({ url: "" }, HOST), null);
  assert.equal(fileOpenRequestOf({}, HOST), null);
});

test("file.open bez typu dostaje octet-stream, żeby system pokazał wybór aplikacji", () => {
  const HOST = "https://sharp-salmon.example:8799";
  assert.equal(fileOpenRequestOf({ url: "/f", mime: "nonsens" }, HOST)?.mime, "application/octet-stream");
  assert.equal(fileOpenRequestOf({ url: "/f" }, HOST)?.mime, "application/octet-stream");
  // Ukośnik na końcu hosta nie robi z adresu podwójnego ukośnika.
  assert.equal(fileOpenRequestOf({ url: "/f" }, `${HOST}/`)?.url, `${HOST}/f`);
});
