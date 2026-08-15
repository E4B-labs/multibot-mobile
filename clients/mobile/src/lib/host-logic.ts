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

/** Strips trailing slashes and rejects anything that isn't http(s). */
export function normalizeHostUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!/^https?:\/\/.+/i.test(trimmed)) {
    throw new Error("Host address must start with http:// or https://");
  }
  return trimmed;
}

/** Adds or replaces a host by id, most-recently-used first. */
export function upsertHost(hosts: Host[], host: Host): Host[] {
  const rest = hosts.filter((h) => h.id !== host.id);
  return [host, ...rest].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
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
