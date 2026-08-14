// multibot (H5): the takeover lease. Time is injected so the expiry path is
// tested for real rather than slept through.
import { describe, expect, it } from "vitest";

import { LEASE_MS, acquire, agentMayAct, control, forget, release } from "./computer-control.ts";

describe("control lease", () => {
  it("gives the agent input by default", () => {
    expect(control("fresh-bot")).toEqual({ owner: "agent" });
  });

  it("hands input to the user on acquire and back on release", () => {
    const now = 1_000_000;
    expect(acquire("b1", now).owner).toBe("user");
    expect(control("b1", now).owner).toBe("user");
    expect(release("b1")).toEqual({ owner: "agent" });
    expect(control("b1", now)).toEqual({ owner: "agent" });
  });

  it("expires on its own so an abandoned tab cannot hold the computer", () => {
    const now = 2_000_000;
    acquire("b2", now);
    expect(control("b2", now + LEASE_MS - 1).owner).toBe("user");
    expect(control("b2", now + LEASE_MS).owner).toBe("agent");
  });

  it("renewing while active keeps the user in control", () => {
    const now = 3_000_000;
    acquire("b3", now);
    acquire("b3", now + LEASE_MS - 1); // renewal
    expect(control("b3", now + LEASE_MS + 1).owner).toBe("user");
  });

  it("leases are per bot", () => {
    const now = 4_000_000;
    acquire("b4", now);
    expect(control("b5", now).owner).toBe("agent");
  });
});

describe("agentMayAct", () => {
  it("always lets the agent look, even mid-takeover", () => {
    const now = 5_000_000;
    acquire("b6", now);
    expect(agentMayAct("b6", "read", now)).toBe(true);
  });

  it("blocks agent input during takeover with a named state, not an error", () => {
    const now = 6_000_000;
    acquire("b7", now);
    expect(agentMayAct("b7", "input", now)).toBe("user_has_control");
  });

  it("lets the agent type again after hand back", () => {
    const now = 7_000_000;
    acquire("b8", now);
    release("b8");
    expect(agentMayAct("b8", "input", now)).toBe(true);
  });
});

describe("forget", () => {
  it("drops the lease so a recycled bot id never inherits one", () => {
    const now = 8_000_000;
    acquire("b9", now);
    forget("b9");
    expect(control("b9", now)).toEqual({ owner: "agent" });
  });
});
