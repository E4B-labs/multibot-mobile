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
import { describe, expect, it, vi } from "vitest";

import { openFileViaShell } from "./lib/nativeBridge";

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

describe("zdjęcie profilowe użytkownika", () => {
  // Sidebar jest PHONE_OWNED, ale strażnik żyje tutaj — `Sidebar.test.ts`
  // istnieje po stronie desktopu, więc sync może go nadpisać.
  const sidebar = read("./components/Sidebar.tsx");

  it("dymek profilu pokazuje zdjęcie zamiast inicjałów, gdy jest ustawione", () => {
    expect(sidebar).toContain("state.config?.profile?.avatar");
    expect(sidebar).toContain('className="size-full rounded-full object-cover"');
  });

  it("upload i usuwanie idą na wspólny endpoint /api/profile/avatar", () => {
    expect(sidebar).toContain('"/api/profile/avatar"');
    expect(sidebar).toContain("<AvatarCropper");
    // Odpowiedź serwera to {user:{…}} — parser jest czystym helperem z testem
    // jednostkowym (lib/profileAvatar.test.ts), a Sidebar go używa.
    expect(sidebar).toContain("profileFromAvatarResponse");
  });

  it("typ profilu w store zna pole avatar", () => {
    expect(read("./state/store.tsx")).toContain("avatar?: string | null");
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

  // K5. W Android WebView `<a download>` i `window.open` nie robią NIC: nie ma
  // DownloadListenera, a blob i tak nie wychodzi poza dokument. Plik musi
  // pobrać powłoka.
  it("pobranie pliku z czatu idzie przez most, a poza WebView zostaje zwykły link", () => {
    expect(nativeBridge).toContain('type: "file.open"');
    // Token dostępu żyje na STRONIE, nie w powłoce, więc nagłówki jadą stąd.
    expect(nativeBridge).toContain("authorization: `Bearer ${token}`");
    const card = read("./components/AttachmentCard.tsx");
    const preview = read("./components/AttachmentPreview.tsx");
    const chat = read("./components/ChatView.tsx");
    for (const source of [card, preview]) {
      // `shellPost` zwraca false poza WebView, więc `preventDefault` nie padnie
      // i przeglądarka z Electronem pobierają dokładnie jak dotąd.
      expect(source).toContain('openFileViaShell(path, name, mime ?? "")) e.preventDefault()');
    }
    // Ścieżka na serwerze, nie blob: powłoka dokleja ją do hosta, którego
    // pilnuje, i odrzuca wszystko spoza niego.
    expect(chat).toContain("const path = `/api/bots/${botId}/attachments/${file.id}`");
    expect(chat).toContain("path={path} mime={file.mime}");
    // „Otwórz" przy HTML-u wołało `window.open` na blobie — też martwe.
    expect(chat).toContain("if (openFileViaShell(path, file.name, file.mime)) return;");
  });

  it("powłoka rozumie file.open i nie bierze adresu ze strony na słowo", () => {
    const screen = read("../../src/screens/WebViewScreen.tsx");
    expect(screen).toContain('msg?.type === "file.open"');
    expect(screen).toContain("openHostFile(msg, host.url, {");
  });

  it("file.open jedzie z nonce'em, ścieżką i nagłówkami, a bez mostu nie jedzie wcale", async () => {
    const sent: string[] = [];
    const host = {
      ReactNativeWebView: { postMessage: (message: string) => sent.push(message) },
      __MB_BRIDGE_NONCE__: "n-1",
    };
    expect(openFileViaShell("/api/bots/b1/attachments/f1", "raport.pdf", "application/pdf", host)).toBe(true);
    // Wiadomość idzie PO odświeżeniu tokenu: powłoka nie umie odnowić go sama
    // przy 401, więc nie może dostać przedawnionego zdjęcia.
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(JSON.parse(sent[0])).toEqual({
      type: "file.open",
      url: "/api/bots/b1/attachments/f1",
      name: "raport.pdf",
      mime: "application/pdf",
      // Bez tokenu w localStorage zostają same nagłówki protokołu — powłoka
      // dostaje wtedy 401 i powie o tym, zamiast milczeć.
      headers: { "x-multibot-protocol": "2" },
      // Bez nonce'a powłoka odrzuca `file.open`: pobranie sięga do serwera
      // uwierzytelnieniem użytkownika, więc ramka noVNC nie może o nie prosić.
      nonce: "n-1",
    });
    // Przeglądarka i Electron: brak mostu, więc wołający zostaje przy
    // `<a download>` — i nic nie leci, nawet odświeżenie tokenu.
    expect(openFileViaShell("/api/bots/b1/attachments/f1", "raport.pdf", "application/pdf", {})).toBe(false);
  });

  it("token jest odświeżany PRZED posłaniem file.open, nie po", () => {
    const bridge = read("./lib/nativeBridge.ts");
    // Kolejność jest tu całą poprawką: `getAuthToken()` musi czytać token
    // z WNĘTRZA `.then`, już po odnowieniu.
    expect(bridge).toMatch(/refreshAccessToken\(\)\.then\(\(\) => \{\s*const token = getAuthToken\(\);/);
    expect(bridge).toContain("if (!isReactNativeShell(host)) return false;");
  });
});
