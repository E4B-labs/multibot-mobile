// Embedded Tor client, Android only. A MultiBot server that has no public
// address publishes an onion one instead (see the desktop's `server/tor.ts`),
// and this is the phone's half: start tor, learn its SOCKS port, and hand the
// WebView an HTTP proxy that speaks to it.
//
// Nothing here changes how a normal host works. `isOnionHost` is the only gate:
// a `.onion` address starts tor, everything else never touches this file's
// native module at all.
import { requireOptionalNativeModule } from "expo";

import { isOnionHost } from "./host-logic";

export interface TorPorts {
  /** Tor's own SOCKS5 listener on 127.0.0.1. Used by `fetch` and the TLS probe. */
  socksPort: number;
  /** Our HTTP-CONNECT bridge on 127.0.0.1, for the WebView's `ProxyController`. */
  bridgePort: number;
}

interface NativeTor {
  start(timeoutMs: number): Promise<TorPorts>;
  status(): { running: boolean; bootstrapped: boolean; socksPort: number; bridgePort: number };
  stop(): void;
  /** Routes every WebView request through the bridge. Resolves once applied. */
  setWebViewProxy(bridgePort: number): Promise<void>;
  clearWebViewProxy(): Promise<void>;
}

// Absent on iOS and in any build made before this module existed, exactly like
// MultibotTls. An onion address then fails with a plain message instead of
// crashing the screen.
const native = requireOptionalNativeModule<NativeTor>("MultibotTor");

/** First bootstrap builds a circuit from scratch: 10–30 s is normal, and the
 * sign-in button says so. 90 s is the point where something is actually wrong
 * (no network, or a censored one). */
export const TOR_START_TIMEOUT_MS = 90_000;

/** Onion traffic is three relays away, so every network budget on the onion
 * path is stretched to this instead of the 8–15 s a LAN host gets. */
export const ONION_TIMEOUT_MS = 90_000;

// The bootstrap in flight, so two screens asking at once wait on one tor. A
// failure clears it so the next attempt really retries instead of replaying the
// error, and a tor that has since died clears it too — otherwise a crashed
// process would leave every onion address broken until the app restarts.
let starting: Promise<TorPorts> | null = null;

/** Starts the embedded Tor client (or joins the start already in flight) and
 * resolves once it has bootstrapped and both ports are open. */
export async function ensureTor(): Promise<TorPorts> {
  if (!native) throw new Error("This build cannot reach .onion addresses. Tor is Android-only.");
  if (starting && !native.status().running) starting = null;
  if (!starting) {
    starting = native.start(TOR_START_TIMEOUT_MS).catch((error: unknown) => {
      starting = null;
      throw error;
    });
  }
  return starting;
}

/** Points the WebView at the bridge for an onion host and takes the override
 * back off for anything else. Clearing is not conditional on tor being up: a
 * process-wide proxy left behind after switching hosts would silently break
 * every LAN address. */
export async function setWebViewProxyFor(url: string): Promise<void> {
  if (!native) return;
  if (!isOnionHost(url)) {
    await native.clearWebViewProxy();
    return;
  }
  const { bridgePort } = await ensureTor();
  await native.setWebViewProxy(bridgePort);
}
