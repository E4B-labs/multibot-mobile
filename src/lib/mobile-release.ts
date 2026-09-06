import { Platform } from "react-native";
import * as Application from "expo-application";
import * as FileSystem from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";

import { APK_HOSTS, expectedSha256, isHttpsUrl, pickTermuxApk, type GithubAsset } from "./release-assets";
import { sha256File } from "./tls";

export type MobileRelease = {
  version: string;
  versionCode: number;
  apkUrl: string;
  notes?: string;
};

const MANIFEST_URL = "https://raw.githubusercontent.com/E4B-labs/multibot/main/mobile-release.json";
function parseRelease(value: unknown): MobileRelease | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.version !== "string" ||
    !Number.isInteger(candidate.versionCode) ||
    Number(candidate.versionCode) <= 0 ||
    !isHttpsUrl(candidate.apkUrl, APK_HOSTS)
  ) {
    return null;
  }
  return {
    version: candidate.version,
    versionCode: Number(candidate.versionCode),
    apkUrl: candidate.apkUrl,
    ...(typeof candidate.notes === "string" ? { notes: candidate.notes } : {}),
  };
}

export async function fetchMobileRelease(): Promise<MobileRelease | null> {
  if (Platform.OS !== "android") return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(MANIFEST_URL, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return parseRelease(await response.json());
  } finally {
    clearTimeout(timeout);
  }
}

export function currentBuildVersion(): number {
  const value = Number(Application.nativeBuildVersion ?? 0);
  return Number.isInteger(value) && value > 0 ? value : 0;
}

export function isNewerMobileRelease(release: MobileRelease | null): release is MobileRelease {
  return Boolean(release && release.versionCode > currentBuildVersion());
}

/**
 * Pobiera manifest i instaluje APK, jeśli w nim stoi nowszy build. Jedno
 * wejście dla „chcę nową wersję" — woła je stuknięcie w powiadomienie o braku
 * pushu (`App.tsx`). Cicho nic nie robi, gdy nowszego APK nie ma.
 */
// Zimny start po stuknięciu w powiadomienie dostarcza tę samą odpowiedź DWA
// razy (listener i `getLastNotificationResponseAsync`). Dwa równoległe
// pobrania piszą do tej samej ścieżki `MultiBot-<code>.apk`, a `deleteAsync`
// jednego trafia w środek pobierania drugiego — instalator dostaje ucięty plik.
let installing: Promise<void> | null = null;

export function installLatestRelease(): Promise<void> {
  installing ??= runInstall().finally(() => {
    installing = null;
  });
  return installing;
}

async function runInstall(): Promise<void> {
  const release = await fetchMobileRelease();
  if (isNewerMobileRelease(release)) await installAndroidRelease(release);
}

export async function installAndroidRelease(release: MobileRelease): Promise<void> {
  await downloadAndInstallApk(release.apkUrl, `MultiBot-${release.versionCode}.apk`);
}

/** Downloads an APK into the cache and hands it to the system installer.
 * Shared by the self-update path and by "Set up a server", which installs
 * Termux exactly the same way. REQUEST_INSTALL_PACKAGES is already granted. */
export async function downloadAndInstallApk(url: string, fileName: string, expectedDigest?: string): Promise<void> {
  if (Platform.OS !== "android") throw new Error("APK installation is available on Android only.");
  const cacheDirectory = FileSystem.cacheDirectory;
  if (!cacheDirectory) throw new Error("Android cache directory unavailable.");

  const apkUri = `${cacheDirectory}${fileName}`;
  await FileSystem.deleteAsync(apkUri, { idempotent: true });
  const downloaded = await FileSystem.downloadAsync(url, apkUri, {
    headers: { Accept: "application/vnd.android.package-archive" },
  });
  // The publisher's own checksum, when there is one. Handing an unverified
  // binary to the package installer is the one step in this app the user cannot
  // undo, so a mismatch deletes the file rather than asking.
  if (expectedDigest) {
    const actual = await sha256File(downloaded.uri).catch(async (e: unknown) => {
      await FileSystem.deleteAsync(apkUri, { idempotent: true });
      throw e;
    });
    if (actual.toLowerCase() !== expectedDigest.toLowerCase()) {
      await FileSystem.deleteAsync(apkUri, { idempotent: true });
      throw new Error("The downloaded APK does not match the checksum the publisher signed. Nothing was installed.");
    }
  }
  const contentUri = await FileSystem.getContentUriAsync(downloaded.uri);
  await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
    data: contentUri,
    type: "application/vnd.android.package-archive",
    flags: 1,
  });
}

const TERMUX_RELEASE_API = "https://api.github.com/repos/termux/termux-app/releases/latest";

/** Termux is not on Play, so the only way in is the APK from its own releases. */
export async function installTermux(): Promise<void> {
  const response = await fetch(TERMUX_RELEASE_API, {
    cache: "no-store",
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) throw new Error(`GitHub answered HTTP ${response.status}.`);
  const body = (await response.json()) as { assets?: GithubAsset[] };
  const apk = pickTermuxApk(body?.assets);
  if (!apk) throw new Error("The latest Termux release has no universal APK.");
  if (!apk.sumsUrl) throw new Error("The latest Termux release publishes no checksums — refusing to install it.");

  const sums = await fetch(apk.sumsUrl, { cache: "no-store" });
  if (!sums.ok) throw new Error(`Could not read the Termux checksums (HTTP ${sums.status}).`);
  const digest = expectedSha256(await sums.text(), apk.name);
  if (!digest) throw new Error("The Termux checksums do not cover the universal APK.");

  await downloadAndInstallApk(apk.url, "Termux.apk", digest);
}
