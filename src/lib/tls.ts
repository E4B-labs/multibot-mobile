// Native half of "Sign in to a server": TLS trust-on-first-use plus the join
// request itself. RN has no CORS, so the shell can talk to a server it is not
// hosted by — which is the whole reason the address is resolved out here and not
// inside the web UI.
//
// The native module (modules/multibot-tls) owns the trust store; the WebView and
// React Native's own fetch read it through the patches in
// plugins/with-tls-pinning.js. Nothing here reaches a server before its
// certificate has been pinned.
import { requireOptionalNativeModule } from "expo";

import { normalizeHostUrl, probeServer, tlsKey } from "./host-logic";
import { joinFragment, parseJoinResponse, type JoinErrorCode, type JoinResponse } from "./join";

interface NativeTls {
  /** "trusted" first time, "unchanged" on a match, "certificate_changed" otherwise. */
  trust(key: string, fingerprint: string): "trusted" | "unchanged" | "certificate_changed";
  forget(key: string): void;
  pinned(key: string): string | null;
  /** False when the prebuild patches are missing — the WebView trusts nothing. */
  markerPresent(): boolean;
  /** Leaf certificate SHA-256 read off a bare TLS handshake — no HTTP request. */
  probeFingerprint(url: string, timeoutMs: number): Promise<string>;
  /** SHA-256 of a file on disk, for checking a downloaded APK before installing. */
  sha256File(path: string): Promise<string>;
}

// Absent in Expo Go and in any build made before this module existed. Every
// caller degrades to a plain error instead of crashing the first screen.
const native = requireOptionalNativeModule<NativeTls>("MultibotTls");

const PROBE_TIMEOUT_MS = 8_000;
const JOIN_TIMEOUT_MS = 15_000;

export function tlsAvailable(): boolean {
  return native !== null;
}

/** SHA-256 of a downloaded file. Throws when the native module is absent, so a
 * caller can never mistake "not checked" for "checked and fine". */
export async function sha256File(path: string): Promise<string> {
  if (!native) throw new Error("This build cannot verify downloads. Install the current APK.");
  return native.sha256File(path);
}

export function pinnedFingerprint(url: string): string | null {
  return native ? native.pinned(tlsKey(url)) : null;
}

/** Drops the pin so the next sign-in trusts whatever the server presents now.
 * Only ever called from an explicit "Trust new certificate" tap. */
export function forgetServer(url: string): void {
  native?.forget(tlsKey(url));
}

export async function probeFingerprint(url: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<string> {
  if (!native) throw new Error("This build cannot verify server certificates. Install the current APK.");
  return native.probeFingerprint(url, timeoutMs);
}

export interface JoinOutcome {
  ok: boolean;
  url?: string;
  joinGrant?: string;
  fragment?: string;
  hasUsers?: boolean;
  error?: JoinErrorCode;
}

/**
 * Resolves an address, pins its certificate on first sight, and trades the
 * server name + password for a single-use join grant. The password is never
 * stored — it only ever exists in this one request.
 */
export async function joinHost(rawUrl: string, serverName: string, serverPassword: string): Promise<JoinOutcome> {
  let url: string;
  try {
    url = normalizeHostUrl(rawUrl);
  } catch {
    return { ok: false, error: "invalid_address" };
  }

  const trusted = await trustServer(url);
  if (trusted) return { ok: false, error: trusted, url };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), JOIN_TIMEOUT_MS);
  let response: JoinResponse;
  try {
    const res = await fetch(`${url}/api/auth/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ serverName: serverName.trim(), serverPassword }),
      signal: controller.signal,
    });
    const body = await res.json().catch(() => ({}));
    response = parseJoinResponse(res.status, body);
  } catch {
    return { ok: false, error: controller.signal.aborted ? "timeout" : "unreachable", url };
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) return { ok: false, error: response.error, url };
  return {
    ok: true,
    url,
    joinGrant: response.joinGrant,
    hasUsers: response.hasUsers,
    fragment: joinFragment(response.joinGrant),
  };
}

/** The native module rejects with a `code`. Matching on message text would
 * break the moment a platform reworded a socket error. */
const PROBE_CODES = new Set<JoinErrorCode>(["timeout", "unreachable", "not_multibot"]);

function probeErrorCode(error: unknown): JoinErrorCode {
  const code = (error as { code?: unknown })?.code;
  return typeof code === "string" && PROBE_CODES.has(code as JoinErrorCode) ? (code as JoinErrorCode) : "unreachable";
}

/** Pins the certificate if it is new. Returns an error code when it can't. */
async function trustServer(url: string): Promise<JoinErrorCode | null> {
  if (!native) return "unreachable";
  let fingerprint: string;
  try {
    fingerprint = await native.probeFingerprint(url, PROBE_TIMEOUT_MS);
  } catch (error) {
    return probeErrorCode(error);
  }
  return native.trust(tlsKey(url), fingerprint) === "certificate_changed" ? "certificate_changed" : null;
}

/** The server this phone hosts itself, through Termux. Its certificate is
 * regenerated whenever the harness is reinstalled, and a certificate presented
 * over loopback cannot come from anyone else, so a change is re-pinned in place
 * instead of stopping the flow. */
export const LOCAL_SERVER_URL = "https://127.0.0.1:8799";

export async function probeLocalServer(): Promise<boolean> {
  if (!native) return false;
  let fingerprint: string;
  try {
    fingerprint = await native.probeFingerprint(LOCAL_SERVER_URL, 2_500);
  } catch {
    return false;
  }
  // Re-pinning without asking is safe here and nowhere else: the key is scoped
  // to 127.0.0.1:8799, which no other machine can answer.
  const key = tlsKey(LOCAL_SERVER_URL);
  if (native.trust(key, fingerprint) === "certificate_changed") {
    native.forget(key);
    native.trust(key, fingerprint);
  }
  return (await probeServer(LOCAL_SERVER_URL, 4_000)) === "ok";
}
