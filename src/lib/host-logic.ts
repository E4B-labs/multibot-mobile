// Pure host-list logic. No expo-secure-store import here on purpose: this
// file must run under plain `node` for the self-check (see logic.test.ts)
// without pulling in any native module.

export interface Host {
  id: string;
  name: string;
  /** Normalized: https://host, no trailing slash. */
  url: string;
  createdAt: number;
  lastUsedAt: number;
}

export type HostAuthMode = "v2" | "legacy";

export function hostAuthHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    "x-multibot-protocol": "2",
  };
}

/** Adds https for a bare host, strips trailing slashes, and rejects anything
 * that isn't https. MultiBot servers have listened on https only since 0.4.0
 * (self-signed, pinned on first use), so a plaintext address is always a
 * mistake — accepting one would put the server password on the wire in clear. */
// Parsed by hand rather than with `new URL`: React Native ships a WHATWG URL
// polyfill that mangles IPv6 literals (`[2a00::1]` comes back without its
// brackets, or with the port folded into the host), and this address is what
// the certificate pin is keyed by — getting it subtly wrong means the pin never
// matches and the phone can reach nothing.
const HOST_URL = /^https:\/\/(\[[0-9a-f:.]+\]|[a-z0-9._~-]+)(?::(\d{1,5}))?$/i;

export function normalizeHostUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Host address is required.");
  const hasScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed);
  if (hasScheme && !/^https:\/\//i.test(trimmed)) {
    throw new Error("Host address must use https://");
  }
  const normalized = (hasScheme ? trimmed : `https://${trimmed}`).replace(/\/+$/, "");
  if (/[@\\?#\s]/.test(normalized.slice("https://".length))) {
    throw new Error("Host address cannot contain credentials.");
  }
  const match = HOST_URL.exec(normalized);
  if (!match) throw new Error("Enter a valid host address.");
  const [, host, port] = match;
  if (port && Number(port) > 65535) throw new Error("Enter a valid host address.");
  if (host.startsWith("[") && !host.includes(":")) {
    // `[10.0.0.1]` is not an address — brackets mean IPv6, which always has a colon.
    throw new Error("Enter a valid host address.");
  }
  // A bare word is a typo, not a host. Bracketed IPv6 and dotted IPv4 stay.
  if (!hasScheme && !host.startsWith("[") && host !== "localhost" && !host.includes(".")) {
    throw new Error("Enter a valid host address.");
  }
  return normalized;
}

/** A v3 onion address: 56 characters of base32 (a-z and 2-7) plus `.onion`.
 * Nothing else is accepted — a shorter or longer label is either a v2 address
 * (dead since 2021) or a typo, and both would send the phone off to start Tor
 * for an address that can never resolve. Case-insensitive because
 * `normalizeHostUrl` keeps whatever the user typed. */
const ONION_HOST = /^[a-z2-7]{56}\.onion$/i;

/** True when this address can only be reached through Tor. Callers use it to
 * decide whether to start the embedded Tor client and to stretch their
 * timeouts; nothing else about a host changes. */
export function isOnionHost(url: string): boolean {
  const match = HOST_URL.exec(url.trim().replace(/\/+$/, ""));
  return match !== null && ONION_HOST.test(match[1]);
}

/** Key a server's certificate fingerprint is pinned under. Must stay
 * byte-identical to the key the native side builds (`MultibotTls.keyFor`, the
 * ObjC helper, and the WebView patch in plugins/with-tls-pinning.js): lowercase
 * host without IPv6 brackets, a colon, and the port with 443 as the default. */
export function tlsKey(url: string): string {
  const match = HOST_URL.exec(url.trim().replace(/\/+$/, ""));
  if (!match) throw new Error("Enter a valid host address.");
  const host = match[1].replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
  return `${host}:${match[2] || "443"}`;
}

/** Adds or replaces a host by id, most-recently-used first. */
export function upsertHost(hosts: Host[], host: Host): Host[] {
  const rest = hosts.filter((h) => h.id !== host.id);
  return [host, ...rest].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
}

/** Picks the host the user used most recently for app startup. */
export function resolveStartupHost(hosts: Host[]): Host | null {
  return hosts.reduce<Host | null>((latest, host) => {
    if (!latest || host.lastUsedAt > latest.lastUsedAt) return host;
    return latest;
  }, null);
}

/** Marks one known host as recently used and keeps the list sorted. */
export function touchHost(hosts: Host[], id: string, now = Date.now()): Host[] {
  const host = hosts.find((item) => item.id === id);
  return host ? upsertHost(hosts, { ...host, lastUsedAt: now }) : hosts;
}

export function removeHostById(hosts: Host[], id: string): Host[] {
  return hosts.filter((h) => h.id !== id);
}

export function newHostId(): string {
  return `h_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Renames one host by id, leaving every other field untouched. Returns the
 * list unchanged when the id is unknown so callers can stay oblivious. */
export function renameHost(hosts: Host[], id: string, name: string): Host[] {
  const trimmed = name.trim();
  if (!trimmed) return hosts;
  return hosts.map((h) => (h.id === id ? { ...h, name: trimmed } : h));
}

/** Human-readable "last used" label the host list can show directly. Anchored
 * to the local clock on purpose — the phone is the only time source the shell
 * has, and a precise timestamp would lie across timezones anyway. */
export function formatLastUsed(ts: number): string {
  const diffMs = Date.now() - ts;
  if (diffMs < 0) return "just now";
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "yesterday";
  if (day < 7) return `${day} days ago`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk} wk ago`;
  return new Date(ts).toLocaleDateString();
}

/** Is a MultiBot server answering at this address? `GET /api/health` is public
 * on every 0.4.0 server and says `{ app: "multibot" }`; anything else is some
 * other web server. The certificate must already be pinned — this goes through
 * the normal (pinned) client, not a trust-all probe. */
export async function probeServer(url: string, timeoutMs = 8_000): Promise<"ok" | "not_multibot" | "timeout" | "unreachable"> {
  // `AbortSignal.timeout` is missing from the React Native polyfill.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${url}/api/health`, { signal: controller.signal });
    if (!response.ok) return "not_multibot";
    const body = (await response.json()) as { app?: unknown };
    return body?.app === "multibot" ? "ok" : "not_multibot";
  } catch {
    return controller.signal.aborted ? "timeout" : "unreachable";
  } finally {
    clearTimeout(timer);
  }
}

/** A 100.x address only resolves inside the tailnet, so the Tailscale hint is
 * only true for those — a trycloudflare URL fails for other reasons. */
export function isTailnetUrl(url: string): boolean {
  return /^https?:\/\/100\.\d/.test(url.trim());
}

/** A private (RFC1918) or link-local address, which exists only on the network
 * it was saved from. Worth its own hint because of HOW it fails: on mobile data
 * the phone holds no address on that network, so the connection is not refused
 * — it leaves by the cellular default route and sits there until the timeout,
 * which from the outside looks like the app being slow to start rather than
 * like the wrong address. Kept apart from `isTailnetUrl` because a 100.x
 * address CAN work off its own network, with Tailscale up; this one never can. */
export function isPrivateLanUrl(url: string): boolean {
  return /^https?:[/][/](10[.]|192[.]168[.]|169[.]254[.]|172[.](1[6-9]|2[0-9]|3[01])[.])/.test(url.trim());
}

/** What this INSTALL is, as opposed to what the server is. The web UI is the
 * same bundle on every host, so without this it has nothing to show but the
 * server's version — which is a different program on a different machine.
 * `version`/`build` come from `expo-application` (the APK), the rest from
 * `expo-updates` (the OTA bundle actually running). */
export type AppInfo = {
  version: string;
  build: string;
  runtimeVersion?: string;
  /** Absent on an embedded launch: the app is running the bundle shipped in
   * the APK, with no OTA update on top. */
  updateId?: string;
  updateCreatedAt?: string;
  channel?: string;
};

/** Script injected before the web UI boots. A token (legacy hosts) is seeded
 * into localStorage under the key webui/src/lib/auth.ts reads; without one
 * nothing auth-related is seeded and the web UI shows its own login screen. */
export function buildBootstrap(opts: {
  token?: string | null;
  botId?: string;
  /** Fragment the web UI reads on boot, e.g. `#join=<grant>` after a native
   * sign-in. Ignored when a notification tap already picked a bot. */
  fragment?: string;
  /** Secret the page must echo back on privileged bridge messages. Injected into
   * the main frame only, so an embedded frame never learns it. */
  bridgeNonce?: string;
  statusBarHeight: number;
  app: AppInfo;
}): string {
  const hash = opts.botId ? `#bot=${opts.botId}` : opts.fragment || "";
  const deep = hash ? `location.hash = ${JSON.stringify(hash)};` : "";
  const auth = opts.token
    ? `localStorage.setItem("multibot.auth.token", ${JSON.stringify(opts.token)});`
    : "";
  const nonce = opts.bridgeNonce
    ? `window.__MB_BRIDGE_NONCE__ = ${JSON.stringify(opts.bridgeNonce)};`
    : "";
  return `try { document.documentElement.style.setProperty('--android-status-bar', '${opts.statusBarHeight}px'); } catch (e) {}
         try { ${auth} ${deep} } catch (e) {}
         try { ${nonce} } catch (e) {}
         try { window.__MULTIBOT_APP__ = ${JSON.stringify(opts.app)}; } catch (e) {}
         true;`;
}

// ── K1: powrót z tła ───────────────────────────────────────────────────────
// Android ubija proces renderera WebView, gdy aplikacja siedzi w tle, a
// systemowi robi się ciasno w pamięci (`WebViewClient.onRenderProcessGone`,
// API 26+). Widok zostaje przy życiu, ale jest PUSTY — i to jest ten czarny
// ekran po powrocie do aplikacji. Sam WebView nie ma czego przeładować:
// dokument przyszedł z `loadDataWithBaseURL`, więc nie ma URL-a, do którego
// dałoby się wrócić. Jedyne wyjście to zmontować widok od nowa z tym samym
// bootstrapem (token + fragment sesji + nonce mostu).

/** Czy po powrocie aplikacji na wierzch przeładować WebView. Trzymane tu, a
 * nie w ekranie, bo decyzja ma się dać sprawdzić bez Reacta i bez urządzenia. */
export function shouldReloadOnResume(state: {
  /** Stan z `AppState`, na który właśnie przeszliśmy. */
  next: string;
  /** Renderer zginął, odkąd strona ostatnio wstała. */
  rendererGone: boolean;
  /** Strona zdążyła się wczytać choć raz. */
  loaded: boolean;
  /** Strona odpowiedziała na sondę życia (`native.alive`). */
  alive: boolean;
  /** Ekran błędu już wisi — ma własne „Try again", nie odbieramy mu go. */
  failed: boolean;
}): boolean {
  if (state.next !== "active") return false;
  if (state.failed) return false;
  if (state.rendererGone) return true;
  // Strona jeszcze się ładuje (onion potrafi 90 s) — sonda i tak by milczała,
  // a przeładowanie startowałoby ładowanie od zera w kółko. Ten przypadek ma
  // już swojego pilnowacza: budżet czasu ładowania.
  if (!state.loaded) return false;
  return !state.alive;
}

// ── K5: podgląd i pobranie pliku ───────────────────────────────────────────
// W Android WebView `<a download>` i `window.open` na blobie nie robią NIC —
// nie ma DownloadListenera, a blob i tak nie wychodzi poza dokument. Interfejs
// prosi więc powłokę, a ta pobiera bajty i oddaje je systemowemu podglądowi.

/** Nazwa pliku bezpieczna dla katalogu cache: bez separatorów ścieżki, bez
 * wiodących kropek, przycięta. Nazwa przychodzi z serwera (nazwa załącznika),
 * więc nie może adresować niczego poza katalogiem, który sami wskazujemy. */
export function cacheFileName(name: unknown): string {
  const base = (typeof name === "string" ? name : "").split(/[\\/]/).pop() ?? "";
  const safe = base.replace(/[^\w.\- ]+/g, "_").replace(/^\.+/, "").trim();
  return safe.slice(0, 100) || "plik";
}

export type FileOpenRequest = { url: string; fileName: string; mime: string };

/** Waliduje `{type:"file.open"}` z interfejsu. Adres MUSI być ścieżką na
 * serwerze, którego pilnuje ta powłoka: pobranie leci z tokenem użytkownika,
 * więc dowolny adres podany przez stronę byłby dziurą, a nie wygodą. */
export function fileOpenRequestOf(
  msg: { url?: unknown; name?: unknown; mime?: unknown },
  hostUrl: string,
): FileOpenRequest | null {
  if (typeof msg.url !== "string" || !msg.url) return null;
  const base = hostUrl.replace(/\/+$/, "");
  const url = msg.url.startsWith("/")
    ? `${base}${msg.url}`
    : msg.url === base || msg.url.startsWith(`${base}/`)
      ? msg.url
      : "";
  if (!url) return null;
  return {
    url,
    fileName: cacheFileName(msg.name),
    // Bez typu systemowy wybierak nie wie, komu plik oddać; `octet-stream`
    // pokazuje wtedy listę „otwórz za pomocą" zamiast nie zrobić nic.
    mime: typeof msg.mime === "string" && msg.mime.includes("/") ? msg.mime : "application/octet-stream",
  };
}

/** The three values of a remembered login the web UI is allowed to learn.
 * `null` until the profile half landed: offering a one-tap that cannot log in
 * is worse than not offering one. Pure, so the rule is testable without
 * SecureStore — the store itself lives in hosts.ts. */
export function rememberedEntryOf(
  record: { url?: string; serverName?: string; serverPassword?: string; username?: string; password?: string } | null,
): { url: string; serverName: string; username: string } | null {
  if (!record?.url || !record.username || !record.password) return null;
  return { url: record.url, serverName: record.serverName ?? "", username: record.username };
}
