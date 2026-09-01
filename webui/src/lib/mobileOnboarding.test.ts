import { describe, expect, it } from "vitest";

import { MOBILE_ONBOARDING_STEPS, nextMobileOnboardingStep } from "./mobileOnboarding";

describe("mobile onboarding", () => {
  it("contains only client-side setup steps", () => {
    expect(MOBILE_ONBOARDING_STEPS).toEqual(["profile", "notifications", "ready"]);
  });

  it("advances through profile, notifications, and ready", () => {
    expect(nextMobileOnboardingStep("profile")).toBe("notifications");
    expect(nextMobileOnboardingStep("notifications")).toBe("ready");
    expect(nextMobileOnboardingStep("ready")).toBe("ready");
  });
});
