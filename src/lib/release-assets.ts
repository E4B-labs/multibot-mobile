// Pure parsing for release manifests and GitHub release assets. No react-native
// or expo import on purpose: this runs under plain `node` in join-flow.test.ts,
// and a checksum check nobody can test is a checksum check nobody trusts.

export const APK_HOSTS = new Set([
  "expo.dev",
  "github.com",
  "objects.githubusercontent.com",
  "github-releases.githubusercontent.com",
]);

export function isHttpsUrl(value: unknown, hosts?: Set<string>): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (!hosts || hosts.has(url.hostname));
  } catch {
    return false;
  }
}


export interface GithubAsset {
  name?: unknown;
  browser_download_url?: unknown;
}

function assetUrl(assets: GithubAsset[] | undefined, pattern: RegExp): { name: string; url: string } | null {
  const match = (assets ?? []).find(
    (asset) =>
      typeof asset?.name === "string" && pattern.test(asset.name) && isHttpsUrl(asset.browser_download_url, APK_HOSTS),
  );
  return match ? { name: String(match.name), url: String(match.browser_download_url) } : null;
}

/** The universal APK plus the release's checksum file. Termux publishes one
 * build per ABI plus a universal one; only the universal one is safe to pick
 * without knowing this phone's architecture. */
export function pickTermuxApk(assets: GithubAsset[] | undefined): { name: string; url: string; sumsUrl: string | null } | null {
  const apk = assetUrl(assets, /^termux-app_.*universal\.apk$/i);
  if (!apk) return null;
  return { ...apk, sumsUrl: assetUrl(assets, /^termux-app_.*sha256sums$/i)?.url ?? null };
}

/** Pulls one file's digest out of a `sha256sum` listing (`<hex>  <name>`). */
export function expectedSha256(listing: string, fileName: string): string | null {
  for (const line of listing.split(/\r?\n/)) {
    const match = /^([0-9a-f]{64})\s+\*?(.+?)\s*$/i.exec(line);
    if (match && match[2] === fileName) return match[1].toLowerCase();
  }
  return null;
}

