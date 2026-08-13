import { describe, expect, it } from "vitest";

import { deviceInfo } from "./device.ts";

describe("deviceInfo", () => {
  it("reports onboarding-safe device capabilities", async () => {
    const info = await deviceInfo();
    expect(info.hostname).toBeTruthy();
    expect(info.platform).toBe(process.platform);
    expect(info.arch).toBe(process.arch);
    expect(info.ramBytes).toBeGreaterThan(0);
    expect(info.memoryGb).toBeGreaterThan(0);
    expect(typeof info.python).toBe("boolean");
    expect(typeof info.docker).toBe("boolean");
    expect(typeof info.engineInstalled).toBe("boolean");
    expect(typeof info.android).toBe("boolean");
    expect(typeof info.termux).toBe("boolean");
    if (info.pythonVersion) expect(info.pythonVersion).toMatch(/python/i);
  });
});
