// Pairing with a MultiBot host.
//
// The QR + one-time-code flow below (parseQrPayload + claimPairing) follows
// the contract documented in PLAN-CLIENTS.md C1: `POST /api/pair/start` on
// the host generates a QR with `{ url, code }`; the phone scans it and calls
// `POST /api/pair/claim { code, deviceName }` to get a token back. Both
// endpoints are live (server/pairing.ts): the code expires in 5 minutes, is
// single-use, and dies after 5 wrong guesses. AddHostScreen still degrades to
// manual token entry on any failure, so an older host without pairing works
// too: paste the token from GET /api/auth/token (server/auth.ts).
//
// No expo/RN imports here — kept plain so the pure parseQrPayload can run
// under plain `node` in the self-check (see logic.test.ts). claimPairing
// uses the global `fetch`, available in both React Native and Node 24+.

export interface QrPayload {
  url: string;
  code?: string;
}

/** Parses a scanned QR value: `{ "url": "...", "code": "123456" }` (the
 * PLAN-CLIENTS pairing format) or a bare host URL. Returns null for
 * anything else. */
export function parseQrPayload(raw: string): QrPayload | null {
  const text = raw.trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as { url?: unknown; code?: unknown };
    if (parsed && typeof parsed.url === "string" && parsed.url) {
      return { url: parsed.url, code: typeof parsed.code === "string" ? parsed.code : undefined };
    }
  } catch {
    /* not JSON — maybe a bare URL */
  }
  return /^https?:\/\//i.test(text) ? { url: text } : null;
}

export interface ClaimResult {
  token: string;
  deviceId?: string;
}

/** Trades a scanned code for this host's token. Throws with a message the UI
 * can show directly; callers should catch and fall back to manual entry. */
export async function claimPairing(hostUrl: string, code: string, deviceName: string): Promise<ClaimResult> {
  const res = await fetch(`${hostUrl}/api/pair/claim`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, deviceName }),
  });
  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? "This host doesn't support QR pairing yet — enter the access token manually."
        : `Pairing failed (HTTP ${res.status}).`,
    );
  }
  return (await res.json()) as ClaimResult;
}
