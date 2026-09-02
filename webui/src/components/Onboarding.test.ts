import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const onboarding = readFileSync(new URL("./Onboarding.tsx", import.meta.url), "utf8");

describe("mobile onboarding parity", () => {
  it("uses the desktop onboarding steps with mobile notifications and completion state", () => {
    expect(onboarding).not.toContain("return <MobileOnboarding onDone={onDone} />");
    expect(onboarding).toContain('entry === "choice"');
    expect(onboarding).toContain("Command-line tools");
    expect(onboarding).toContain("Add a custom model");
    expect(onboarding).toContain("isMobileClient");
    expect(onboarding).toContain('multibot.mobile.onboarding.v2.done');
  });
});
