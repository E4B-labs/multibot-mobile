// multibot (H5): who may type on the bot's computer.
//
// Exactly one input owner at a time. The agent owns input by default; the user
// can take it and hand it back. Seeing the screen is never gated — the point of
// the shared desktop is that both sides watch the same thing, so only input is
// leased.
//
// The lease is short and renewed while the user is active, so a closed laptop
// lid cannot hold a bot's computer hostage. State is in memory on purpose:
// after a harness restart the correct owner is the agent, which is exactly what
// an empty map means.

/** Long enough to survive a slow render or a brief network hiccup, short enough
 *  that an abandoned tab frees the computer quickly. */
export const LEASE_MS = 30_000;

export type ControlOwner = "agent" | "user";

export interface Control {
  owner: ControlOwner;
  /** epoch ms; only meaningful while `owner === "user"` */
  expiresAt?: number;
}

const leases = new Map<string, number>(); // botId -> expiresAt

export function control(botId: string, now = Date.now()): Control {
  const expiresAt = leases.get(botId);
  if (expiresAt === undefined || expiresAt <= now) {
    leases.delete(botId);
    return { owner: "agent" };
  }
  return { owner: "user", expiresAt };
}

/** Take or extend the user's lease. Idempotent — the user re-acquiring their
 *  own live lease is a renewal, not a conflict. */
export function acquire(botId: string, now = Date.now()): Control {
  const expiresAt = now + LEASE_MS;
  leases.set(botId, expiresAt);
  return { owner: "user", expiresAt };
}

export const renew = acquire;

export function release(botId: string): Control {
  leases.delete(botId);
  return { owner: "agent" };
}

/**
 * Whether an agent tool call may act right now.
 *
 * Screenshots stay allowed while the user drives — the agent has to keep
 * watching to continue sensibly afterwards. Input is refused with a named
 * state, never a random tool error, so the model can say "waiting for you"
 * instead of inventing a failure.
 */
export function agentMayAct(botId: string, kind: "read" | "input", now = Date.now()): true | "user_has_control" {
  if (kind === "read") return true;
  return control(botId, now).owner === "agent" ? true : "user_has_control";
}

/** Bot deleted — drop any lease so a recycled id never inherits one. */
export function forget(botId: string): void {
  leases.delete(botId);
}
