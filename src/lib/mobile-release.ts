import { Platform } from "react-native";
import * as Application from "expo-application";
import * as FileSystem from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";

export type MobileRelease = {
  version: string;
  versionCode: number;
  apkUrl: string;
  notes?: string;
};

const MANIFEST_URL = "https://raw.githubusercontent.com/E4B-labs/multibot/main/mobile-release.json";
const APK_HOSTS = new Set([
  "expo.dev",
  "github.com",
  "objects.githubusercontent.com",
  "github-releases.githubusercontent.com",
]);

function isHttpsUrl(value: unknown, hosts?: Set<string>): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (!hosts || hosts.has(url.hostname));
  } catch {
    return false;
  }
}

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

export async function installAndroidRelease(release: MobileRelease): Promise<void> {
  if (Platform.OS !== "android") throw new Error("APK installation is available on Android only.");
  const cacheDirectory = FileSystem.cacheDirectory;
  if (!cacheDirectory) throw new Error("Android cache directory unavailable.");

  const apkUri = `${cacheDirectory}MultiBot-${release.versionCode}.apk`;
  await FileSystem.deleteAsync(apkUri, { idempotent: true });
  const downloaded = await FileSystem.downloadAsync(release.apkUrl, apkUri, {
    headers: { Accept: "application/vnd.android.package-archive" },
  });
  const contentUri = await FileSystem.getContentUriAsync(downloaded.uri);
  await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
    data: contentUri,
    type: "application/vnd.android.package-archive",
    flags: 1,
  });
}
