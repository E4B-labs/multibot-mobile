// multibot (H5): who may type on the computer.
//
// There is one computer for the whole installation, so there is one input
// owner. Agents own input by default; the user can take it and hand it back.
// Seeing the screen is never gated — the point of the shared desktop is that
// everyone watches the same thing, so only input is leased.
//
// The lease is short and renewed while the user is active, so a closed laptop
// lid cannot hold the computer hostage. State is in memory on purpose: after a
// harness restart the correct owner is the agent, which is what "no lease"
// already means.
//
// ponytail: this arbitrates user-vs-agent only. Two bots taking a turn at the
// same time both drive the same desktop and can fight over it; that needs a
// turn queue over the shared machine, not a second lease, and nobody has asked
// for one yet.

/** Long enough to survive a slow render or a brief network hiccup, short enough
 *  that an abandoned tab frees the computer quickly. */
export const LEASE_MS = 30_000;

export type ControlOwner = "agent" | "user";

export interface Control {
  owner: ControlOwner;
  /** epoch ms; only meaningful while `owner === "user"` */
  expiresAt?: number;
}

let leaseExpiresAt: number | null = null;

export function control(now = Date.now()): Control {
  if (leaseExpiresAt === null || leaseExpiresAt <= now) {
    leaseExpiresAt = null;
    return { owner: "agent" };
  }
  return { owner: "user", expiresAt: leaseExpiresAt };
}

/** Take or extend the user's lease. Idempotent — re-acquiring a live lease is a
 *  renewal, not a conflict. */
export function acquire(now = Date.now()): Control {
  leaseExpiresAt = now + LEASE_MS;
  return { owner: "user", expiresAt: leaseExpiresAt };
}

export const renew = acquire;

export function release(): Control {
  leaseExpiresAt = null;
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
export function agentMayAct(kind: "read" | "input", now = Date.now()): true | "user_has_control" {
  if (kind === "read") return true;
  return control(now).owner === "agent" ? true : "user_has_control";
}
