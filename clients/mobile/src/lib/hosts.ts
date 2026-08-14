// Host + credential storage. Metadata (id, name, url) lives in one small
// SecureStore key; each host's bearer token lives under its own key so one
// host's secret never sits next to another's, and no single SecureStore
// value risks the ~2KB ceiling some iOS Keychain releases enforce.
import * as SecureStore from "expo-secure-store";

import { type Host, removeHostById, upsertHost } from "./host-logic";

export type { Host } from "./host-logic";

const INDEX_KEY = "mb_hosts_index";
const tokenKey = (id: string) => `mb_host_token_${id}`;

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
export async function saveHost(host: Host, token: string): Promise<void> {
  const hosts = upsertHost(await listHosts(), host);
  await saveIndex(hosts);
  await SecureStore.setItemAsync(tokenKey(host.id), token);
}

export async function getHostToken(id: string): Promise<string | null> {
  return SecureStore.getItemAsync(tokenKey(id));
}

export async function deleteHost(id: string): Promise<void> {
  const hosts = removeHostById(await listHosts(), id);
  await saveIndex(hosts);
  await SecureStore.deleteItemAsync(tokenKey(id));
}
