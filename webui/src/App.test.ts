import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

// Panel „Server & devices" został usunięty z UI razem ze stanem otwierania.
describe("usunięty panel Server & devices", () => {
  it("nie renderuje panelu ani nie importuje jego komponentu", () => {
    expect(app).not.toContain("ServerAccessPanel");
    expect(app).not.toContain("serverAccessOpen");
  });
});

// 0.4.0: logowanie NIE jest już osobnym ekranem obok onboardingu. Były dwa
// wejścia w to samo (`LoginScreen` z pięcioma trybami i kreator z bramką
// e-mail), więc świeża instalacja potrafiła zobaczyć oba naraz. Zostaje jedno:
// `Onboarding` jest pierwszym ekranem i to on loguje.
describe("jedno wejście: Onboarding zamiast LoginScreen", () => {
  it("nie ma już drugiego ekranu logowania", () => {
    expect(app).not.toContain("LoginScreen");
    expect(app).not.toContain("loginTitle");
    expect(app).not.toContain("loginSwitch");
  });

  it("nie ma bramki e-mail ani starego tokenu jako dowodu konfiguracji", () => {
    expect(app).not.toContain("emailGateDone");
    expect(app).not.toContain("gated");
    expect(app).not.toContain("auth.token");
    expect(app).not.toContain("legacy");
  });

  it("render to dokładnie: powłoka po zalogowaniu, onboarding przed", () => {
    expect(app).toContain("if (!authenticated) return <Onboarding onDone={() => setAuthenticated(true)} />;");
  });
});

describe("Android Back korzysta z aktualnego stanu WebUI", () => {
  it("odświeża ref przy renderze i nie zamyka handlera nad pierwszym state", () => {
    expect(app).toContain("useEffect, useRef, useState");
    expect(app).toContain("const nativeBackState = useRef(state);");
    expect(app).toContain("nativeBackState.current = state;");
    expect(app).toContain("const currentState = nativeBackState.current;");
    expect(app).not.toMatch(/const closePanel = state\.appSettingsOpen/);
    for (const panel of [
      "appSettingsOpen",
      "pluginsOpen",
      "computerOpen",
      "inspectorOpen",
      "skillsOpen",
      "routinesOpen",
      "teamMapOpen",
      "roomsOpen",
      "roomOpen",
      "groupOpen",
      "settingsOpen",
    ]) {
      expect(app).toContain(`currentState.${panel}`);
    }
  });

  it("po Back z grupy zamyka grupę i otwiera menu botów", () => {
    const groupBack = app.slice(app.indexOf("currentState.groupOpen"), app.indexOf("currentState.settingsOpen"));
    expect(groupBack).toContain('dispatch({ type: "toggleGroup", group: null })');
    expect(groupBack).toContain("openBotPicker()");
    expect(groupBack.indexOf("openBotPicker()")).toBeLessThan(groupBack.indexOf('dispatch({ type: "toggleGroup", group: null })'));
  });

  it("z Back z ustawień wraca do menu botów przed zamknięciem panelu", () => {
    for (const panel of ["appSettingsOpen", "settingsOpen"]) {
      expect(app).toMatch(new RegExp(`currentState\\.${panel}\\s*\\?\\s*\\(\\) => \\{\\s*openBotPicker\\(\\);\\s*dispatch`));
    }
  });
});
