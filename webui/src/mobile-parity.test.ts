// Strażnik przeróbek mobilnych w portowanym interfejsie.
//
// `scripts/sync-webui.mjs` ostrzega, opłacone całym dniem: przepisanie plików
// z repo desktopowego skasowało kiedyś całą robotę pod telefon (commit
// `13f960b`). Ten plik NIE istnieje po tamtej stronie, więc żadne scalanie go
// nie ruszy — a każda przeróbka, która ma przeżyć następny port, ma tu jedną
// linijkę. Zniknie przeróbka, padnie test.
//
// Środowisko vitest to `node`, bez jsdom — sprawdzamy więc źródło, tak jak
// robią to pozostałe testy w tym repo.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const app = read("./App.tsx");
const onboarding = read("./components/Onboarding.tsx");
const settings = read("./components/AppSettingsPanel.tsx");
const shell = read("./lib/shell.ts");
const nativeBridge = read("./lib/nativeBridge.ts");

describe("układ pod telefon", () => {
  it("szuflada otwiera się przy wejściu w apkę i po powrocie z tła", () => {
    expect(app).toContain("mb-drawer-open");
    expect(app).toContain("visibilitychange");
  });

  it("baner aktualizacji stoi nad układem", () => {
    expect(app).toContain("<UpdateBanner />");
  });

  it("skład grupy dzieli slot z ustawieniami bota, a nie stoi obok czatu", () => {
    expect(app).toContain("state.settingsOpen && state.groupOpen");
  });

  it("onboarding odsuwa się od pasków systemowych", () => {
    expect(onboarding).toContain("var(--safe-top)");
    expect(onboarding).toContain("var(--safe-bottom)");
  });

  it("ustawienia to panel z prawej, nie pełny ekran z desktopu", () => {
    // Od 10.09 rama panelu to `SidePanel` (`<aside>` + uchwyt szerokości) —
    // ważne zostaje to samo: kolumna z lewym obrysem, nie cały ekran.
    expect(settings).toContain("<SidePanel");
    expect(settings).toContain("border-l border-hairline/40");
    expect(settings).not.toContain("fixed inset-0 z-[90]");
  });

  it("karta System ma sam przełącznik powiadomień", () => {
    expect(settings).toContain("NotificationsRow");
    expect(settings).not.toContain("MicrophoneRow");
    expect(settings).not.toContain("HardwareAccelerationRow");
  });

  it("historia zmian ciągnie się z repo mobilnego", () => {
    expect(settings).toContain('UpdateLog repository="E4B-labs/multibot-mobile"');
  });
});

describe("panele boczne o zmiennej szerokości", () => {
  // Te trzy warunki NIE mogą mieszkać w `components/ResizablePanel.test.ts`:
  // ten plik istnieje po stronie desktopu, więc `sync-webui.mjs` nadpisze go
  // wersją stamtąd i strażnik zniknie. Tutaj jest bezpiecznie.
  const panels = [
    "SettingsPanel",
    "InspectorPanel",
    "ComputerPanel",
    "RoutinesPanel",
    "SkillsPanel",
    "GroupMembersPanel",
    "AppSettingsPanel",
  ];
  const panelSource = (name: string) => read(`./components/${name}.tsx`);

  it("uchwyt chowa się, dopóki panel zakrywa ekran", () => {
    for (const name of panels) {
      // Ustawienia bota i komputer są pełnoekranowe aż do `md:` (768) — reszta
      // wraca do kolumny już powyżej 700, bo tam kończy się reguła z arkusza.
      const cutoff = name === "SettingsPanel" || name === "ComputerPanel" ? "md" : "min-[701px]";
      expect(panelSource(name), name).toContain(`handleClassName="hidden ${cutoff}:flex"`);
    }
  });

  it("szerokość idzie zmienną `--panel-width`, nie stylem `width`", () => {
    // `styles.css` (max-width: 700px) wymusza na panelu `width: auto`. Styl
    // inline wygrałby z tą regułą i panel zostałby wąską kolumną zamiast
    // zakryć ekran — dlatego szerokość jedzie zmienną i klasą.
    const shared = read("./components/ResizablePanel.tsx");
    expect(shared).toContain('"--panel-width"');
    expect(shared).not.toContain("style={{ width:");
    expect(read("./styles.css")).toContain("width: auto;");
  });

  it("szyna botów zostaje szufladą — na telefonie nie ma czego ciągnąć", () => {
    expect(read("./components/Sidebar.tsx")).not.toContain("useResizableWidth");
  });
});

describe("most do powłoki", () => {
  it("pobiera historię zmian przez natywny most WebView", () => {
    expect(read("./lib/updateLog.ts")).toContain('shellPost({ type: "update-log.request"');
    expect(read("./lib/updateLog.ts")).toContain('shellPost({ type: "update-log.cancel"');
    expect(read("../../src/screens/WebViewScreen.tsx")).toContain('"update-log.request"');
    expect(read("../../src/screens/WebViewScreen.tsx")).toContain('"update-log.cancel"');
    expect(read("../../src/screens/WebViewScreen.tsx")).toContain('request.repository !== UPDATE_LOG_REPOSITORY');
  });

  it("wszystko leci jednym `shellPost`, więc wiezie nonce", () => {
    // Drugi `postMessage` po cichu gubił `app.update.*` — powłoka odrzuca
    // wiadomości uprzywilejowane bez `window.__MB_BRIDGE_NONCE__`.
    expect(nativeBridge).not.toContain(".postMessage(");
    expect(nativeBridge).toContain("shellPost(");
    expect(read("./lib/updater.ts")).toContain("shellPost({ type: \"app.update.check\" })");
  });

  it("nonce dokleja się w jednym miejscu", () => {
    expect(shell).toContain("__MB_BRIDGE_NONCE__");
    expect(shell).toContain("nonce ? { ...message, nonce } : message");
  });

  it("telefon ma czym zaufać nowemu certyfikatowi — `ogb` tu nie istnieje", () => {
    expect(shell).toContain("forgetCertificateViaShell");
    expect(shell).toContain('shellPost({ type: "tls.forget" }, host)');
    expect(onboarding).toContain("isReactNativeShell()");
  });

  it("rejestracja push idzie przez powłokę, nie przez krok onboardingu", () => {
    expect(app).toContain("registerPushViaShell()");
    expect(shell).toContain("/api/devices/");
  });
});
