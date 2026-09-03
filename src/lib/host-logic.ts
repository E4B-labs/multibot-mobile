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

/** Adds https for a bare host, strips trailing slashes, and validates http(s). */
export function normalizeHostUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Host address is required.");
  const explicitScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed);
  if (explicitScheme && !/^https?:\/\//i.test(trimmed)) {
    throw new Error("Host address must use http:// or https://");
  }
  const hasScheme = /^https?:\/\//i.test(trimmed);
  const candidate = hasScheme ? trimmed : `https://${trimmed}`;
  const normalized = candidate.replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("Enter a valid host address.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Host address must use http:// or https://");
  }
  if (parsed.hostname && !hasScheme && parsed.hostname !== "localhost" && !parsed.hostname.includes(".") && !/^[\da-f:]+$/i.test(parsed.hostname)) {
    throw new Error("Enter a valid host address.");
  }
  if (!parsed.hostname || parsed.username || parsed.password) {
    throw new Error("Host address cannot contain credentials.");
  }
  return normalized;
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

/** Where to probe a host for reachability. With a saved token the authenticated
 * bot list answers; without one only the public auth status does — a tokenless
 * host is valid, the web UI signs in with username + password itself. */
export function hostProbePath(token: string | null): string {
  return token ? "/api/bots" : "/api/auth/status";
}

/** A 100.x address only resolves inside the tailnet, so the Tailscale hint is
 * only true for those — a trycloudflare URL fails for other reasons. */
export function isTailnetUrl(url: string): boolean {
  return /^https?:\/\/100\.\d/.test(url.trim());
}

/** Script injected before the web UI boots. A token (legacy hosts) is seeded
 * into localStorage under the key webui/src/lib/auth.ts reads; without one
 * nothing auth-related is seeded and the web UI shows its own login screen. */
export function buildBootstrap(opts: {
  token?: string | null;
  botId?: string;
  statusBarHeight: number;
  appVersion: string;
}): string {
  const deep = opts.botId ? `location.hash = ${JSON.stringify(`#bot=${opts.botId}`)};` : "";
  const auth = opts.token
    ? `localStorage.setItem("multibot.auth.token", ${JSON.stringify(opts.token)});`
    : "";
  return `try { document.documentElement.style.setProperty('--android-status-bar', '${opts.statusBarHeight}px'); } catch (e) {}
         try { ${auth} ${deep} } catch (e) {}
         try { window.__APP_VERSION__ = ${JSON.stringify(opts.appVersion)}; } catch (e) {}
         true;`;
}
