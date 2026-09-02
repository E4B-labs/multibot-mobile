import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const panel = readFileSync(new URL("./AppSettingsPanel.tsx", import.meta.url), "utf8");
const card = readFileSync(new URL("./BotSettingsCard.tsx", import.meta.url), "utf8");

describe("mobile app settings parity", () => {
  it("exposes host-backed bot policy settings below the profile", () => {
    const profile = panel.indexOf('polish ? "Profil" : "Profile"');
    const bot = panel.indexOf("<BotSettingsCard");
    expect(profile).toBeGreaterThan(-1);
    expect(bot).toBeGreaterThan(profile);
    expect(card).toContain("Strefa czasowa");
    expect(card).toContain("Autoweryfikacja");
    expect(card).toContain("Gdy MultiBot chce:");
  });

  it("does not expose the desktop-only Electron GPU switch", () => {
    expect(panel).not.toContain("hardwareAcceleration");
    expect(panel).not.toContain("Akceleracja sprzętowa");
  });

  it("uses the same mobile-safe switch geometry for auto-verification", () => {
    expect(card).toContain('role="switch"');
    expect(card).toContain("tabIndex={0}");
    expect(card).toContain('style={{ width: 44, height: 26, borderRadius: 13, display: "inline-block" }}');
  });

  it("shows numbered update-log pages without next/previous shortcuts", () => {
    expect(panel).toContain('<UpdateLog repository="E4B-labs/multibot-mobile"');
    expect(panel).toContain("pageNumbers");
    expect(panel).toContain("aria-label={polish ? \"Strony historii zmian\" : \"Update history pages\"}");
    expect(panel).not.toContain("Nowsze");
    expect(panel).not.toContain("Starsze");
  });
});
