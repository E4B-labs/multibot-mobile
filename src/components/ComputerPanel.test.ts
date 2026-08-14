// H4/H5: the pure bits of the computer panel — state→label mapping and the
// noVNC iframe URL builder — extracted so they're testable without rendering.
import { describe, expect, it } from "vitest";

import { computerStateLabel, computerVncSrc, type ComputerState } from "./ComputerPanel";

describe("computerStateLabel", () => {
  const states: ComputerState[] = ["provisioning", "ready", "recovering", "error"];

  it("gives every state a distinct English label", () => {
    const labels = states.map((s) => computerStateLabel(s, false));
    expect(new Set(labels).size).toBe(states.length);
  });

  it("gives every state a distinct Polish label", () => {
    const labels = states.map((s) => computerStateLabel(s, true));
    expect(new Set(labels).size).toBe(states.length);
  });

  it("matches the exact vocabulary from PLAN-COMPUTER.md", () => {
    expect(computerStateLabel("provisioning", false)).toBe("Starting computer…");
    expect(computerStateLabel("provisioning", true)).toBe("Uruchamianie komputera…");
    expect(computerStateLabel("ready", false)).toBe("Computer ready");
    expect(computerStateLabel("ready", true)).toBe("Komputer gotowy");
    expect(computerStateLabel("recovering", false)).toBe("Recovering…");
    expect(computerStateLabel("error", false)).toBe("Computer error");
  });
});

describe("computerVncSrc", () => {
  it("points at the bot's proxied noVNC path", () => {
    const src = computerVncSrc("bot-1", "user");
    expect(src).toBe(
      "/api/bots/bot-1/computer/vnc/vnc.html?autoconnect=1&resize=scale&path=api/bots/bot-1/computer/vnc/websockify",
    );
  });

  it("adds view_only=1 exactly when the agent holds control", () => {
    expect(computerVncSrc("bot-1", "agent")).toMatch(/[?&]view_only=1(&|$)/);
    expect(computerVncSrc("bot-1", "user")).not.toMatch(/view_only/);
  });
});
