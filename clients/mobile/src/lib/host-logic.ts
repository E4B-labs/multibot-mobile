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
