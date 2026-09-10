import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { visibleSettingsTabs } from "./AppSettingsPanel";

const panel = readFileSync(new URL("./AppSettingsPanel.tsx", import.meta.url), "utf8");
const card = readFileSync(new URL("./BotSettingsCard.tsx", import.meta.url), "utf8");
const settings = readFileSync(new URL("./SettingsPanel.tsx", import.meta.url), "utf8");

describe("mobile app settings parity", () => {
  it("exposes host-backed bot policy settings below the profile", () => {
    const profile = panel.indexOf('polish ? "Profil" : "Profile"');
    const bot = panel.indexOf("<BotSettingsCard");
    expect(profile).toBeGreaterThan(-1);
    expect(bot).toBeGreaterThan(profile);
    expect(card).toContain("Strefa czasowa");
    expect(card).toContain("Autoweryfikacja");
    // Karta wozi DWIE nastawy hosta: wybór strefy i przełącznik
    // autoweryfikacji. Sekcja ręcznych reguł („Gdy MultiBot chce:…") wyleciała
    // świadomie (0afc17f), więc guard pilnuje tego, co zostało — same napisy
    // przeszłyby też na martwej karcie bez sterowania.
    expect(card, "karta bota straciła wybór strefy czasowej").toContain("<TimeZonePicker");
    expect(card, "karta bota straciła przełącznik autoweryfikacji").toContain("onClick={toggleAutoVerify}");
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

  it("keeps notification switches at the same mobile-safe geometry", () => {
    expect(panel).toContain('function NotificationsRow({ polish }: { polish: boolean })');
    expect(panel).toContain('role="switch"');
    expect(panel).toContain("minWidth: 44");
    expect(panel).toContain("minHeight: 26");
    expect(panel).toContain("padding: 0");
    expect(panel).toContain('borderRadius: 13');
    expect(panel).toContain('appearance: "none"');

    const settings = readFileSync(new URL("./SettingsPanel.tsx", import.meta.url), "utf8");
    expect(settings).toContain('aria-label={polish ? "Powiadomienia" : "Notifications"}');
    expect(settings).toContain("minWidth: 44");
    expect(settings).toContain("minHeight: 26");
    expect(settings).toContain('appearance: "none"');
  });

  it("shows numbered update-log pages without next/previous shortcuts", () => {
    expect(panel).toContain('<UpdateLog repository="E4B-labs/multibot-mobile"');
    expect(panel).toContain("pageNumbers");
    expect(panel).toContain("aria-label={polish ? \"Strony historii zmian\" : \"Update history pages\"}");
    expect(panel).not.toContain("Nowsze");
    expect(panel).not.toContain("Starsze");
  });
  it("wyrĂłĹĽnia aktywnÄ… sekcjÄ™ bez obwĂłdki i ma spĂłjny focus", () => {
    expect(panel).toContain('aria-current={active ? "page" : undefined}');
    expect(panel).toContain('active\n                    ? "bg-white/[0.07] text-accent before:bg-accent"');
    expect(panel).toContain("focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/70");
    expect(panel).not.toContain("ring-2 ring-accent-border");
  });

  it("ma aktywne stany wszystkich wyborĂłw wyglÄ…du awatara", () => {
    expect(settings).toContain("const settingsChoiceClass = (selected: boolean)");
    expect(settings.match(/aria-pressed=\{appearanceSelected\("bot"\)\}/g)).toHaveLength(2);
    expect(settings.match(/aria-pressed=\{appearanceSelected\("photo"\)\}/g)).toHaveLength(2);
    expect(settings).toContain("aria-pressed={(bot.mascotShape ?? \"blob\") === shape}");
    expect(settings).toContain("aria-pressed={selected}");
    expect(settings).toContain("before:bg-accent");
    expect(settings).not.toContain("ring-2 ring-accent-border");
  });
});

// Zakładka admina pokazuje cudze konta i rotuje hasło serwera. Widzi ją
// WYŁĄCZNIE właściciel — a „jeszcze nie wiem, kim jesteś" i „nie jesteś
// właścicielem" to dwie różne rzeczy, więc obie chowają zakładkę, ale panel
// mówi o tej pierwszej wprost.
describe("zakładka Admin zależy od roli", () => {
  const ids = (role: Parameters<typeof visibleSettingsTabs>[0]) => visibleSettingsTabs(role).map((tab) => tab.id);

  it("widzi ją tylko właściciel", () => {
    expect(ids("owner")).toContain("admin");
    expect(ids("member")).not.toContain("admin");
    expect(ids("loading")).not.toContain("admin");
    expect(ids("unknown")).not.toContain("admin");
  });

  it("reszta szyny zostaje nietknięta dla każdego", () => {
    expect(ids("member")).toEqual(["general", "other", "update"]);
    expect(ids("owner")).toEqual(["general", "other", "admin", "update"]);
  });

  it("nie rezerwuje pustego miejsca na admina podczas sprawdzania roli", () => {
    expect(panel).toContain("visibleSettingsTabs(role).map");
    expect(panel).not.toContain('return role === "loading" ? <Skeleton key={id} className="size-10" /> : null;');
  });

  it("wraca z obu paneli do menu botów przez drawer", () => {
    expect(panel).toContain("openBotPicker();");
    expect(settings).toContain("const closeToBotPicker = ()");
    expect(settings.match(/onClick=\{closeToBotPicker\}/g)).toHaveLength(2);
    expect(settings).toContain("openBotPicker();\n    dispatch({ type: \"toggleSettings\", open: false });");
  });
});
