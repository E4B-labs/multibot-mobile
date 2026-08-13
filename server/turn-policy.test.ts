import { afterEach, describe, expect, it } from "vitest";

import {
  autoApproveAllowed,
  canUseIntegration,
  clearTurnPolicy,
  setTurnPolicy,
  toolAllowed,
  toolsetFor,
} from "./turn-policy.ts";

describe("turn policy", () => {
  afterEach(() => clearTurnPolicy("thread"));

  it("maps provider tool names to durable toolsets", () => {
    expect(toolsetFor("Bash")).toBe("terminal");
    expect(toolsetFor("apply_patch")).toBe("file");
    expect(toolsetFor("mcp__agents__ask_bot")).toBe("delegation");
    expect(toolsetFor("computer.navigate")).toBe("browser");
  });

  it("hard-denies disabled tools and integrations in every autonomy mode", () => {
    setTurnPolicy("thread", {
      autonomy: "autonomous",
      permissions: { terminal: false, browser: false, delegation: false, integrations: false },
    });
    expect(toolAllowed("thread", "shell")).toBe(false);
    expect(autoApproveAllowed("thread", "shell")).toBe(false);
    expect(canUseIntegration("thread", "browser")).toBe(false);
    expect(canUseIntegration("thread", "delegation")).toBe(false);
    expect(canUseIntegration("thread", "integrations")).toBe(false);
  });

  it("auto-approves allowed tools only in autonomous mode", () => {
    setTurnPolicy("thread", { autonomy: "approval", permissions: { terminal: true } });
    expect(autoApproveAllowed("thread", "shell")).toBe(false);
    setTurnPolicy("thread", { autonomy: "autonomous", permissions: { terminal: true } });
    expect(autoApproveAllowed("thread", "shell")).toBe(true);
  });
});
