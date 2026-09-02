// Host + credential storage. Metadata (id, name, url) lives in one small
// SecureStore key; each host's bearer token lives under its own key so one
// host's secret never sits next to another's, and no single SecureStore
// value risks the ~2KB ceiling some iOS Keychain releases enforce.
import * as SecureStore from "expo-secure-store";

import { type Host, type HostAuthMode, removeHostById, renameHost as renameHostInList, touchHost, upsertHost } from "./host-logic";

export type { Host } from "./host-logic";

const INDEX_KEY = "mb_hosts_index";
const tokenKey = (id: string) => `mb_host_token_${id}`;
const authModeKey = (id: string) => `mb_host_auth_mode_${id}`;

export async function listHosts(): Promise<Host[]> {
  const raw = await SecureStore.getItemAsync(INDEX_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Host[];
  } catch {
    return [];
  }
}

async function saveIndex(hosts: Host[]): Promise<void> {
  await SecureStore.setItemAsync(INDEX_KEY, JSON.stringify(hosts));
}

/** Persists the host record and its token (SecureStore = Keychain/Keystore,
 * encrypted at rest — the working credential path today, see pair.ts). */
export async function saveHost(host: Host, token?: string | null, mode?: HostAuthMode | null): Promise<void> {
  const hosts = upsertHost(await listHosts(), host);
  await saveIndex(hosts);
  if (token?.trim()) {
    await SecureStore.setItemAsync(tokenKey(host.id), token.trim());
    await SecureStore.setItemAsync(authModeKey(host.id), mode === "v2" ? "v2" : "legacy");
  } else {
    await SecureStore.deleteItemAsync(tokenKey(host.id));
    await SecureStore.deleteItemAsync(authModeKey(host.id));
  }
}

export async function getHostToken(id: string): Promise<string | null> {
  return SecureStore.getItemAsync(tokenKey(id));
}

export async function getHostAuthMode(id: string): Promise<HostAuthMode> {
  return (await SecureStore.getItemAsync(authModeKey(id))) === "v2" ? "v2" : "legacy";
}

export async function deleteHost(id: string): Promise<void> {
  const hosts = removeHostById(await listHosts(), id);
  await saveIndex(hosts);
  await SecureStore.deleteItemAsync(tokenKey(id));
  await SecureStore.deleteItemAsync(authModeKey(id));
}

/** Renames a stored host. Reads the index, swaps the name, writes it back —
 * the token lives under its own key and is never touched. */
export async function renameHost(id: string, name: string): Promise<void> {
  const hosts = renameHostInList(await listHosts(), id, name);
  await saveIndex(hosts);
}

export async function markHostUsed(id: string, now = Date.now()): Promise<void> {
  const hosts = touchHost(await listHosts(), id, now);
  await saveIndex(hosts);
}
