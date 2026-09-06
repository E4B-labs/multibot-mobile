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
    expect(settings).toContain("<aside");
    expect(settings).toContain("border-l border-hairline/40");
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

describe("most do powłoki", () => {
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
