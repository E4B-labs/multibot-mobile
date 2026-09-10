import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LOGIN_EXPIRED_PREFIX, expiredLoginTool } from "./AuthExpiredBanner";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

// multibot: banerka i serwer rozmawiają JEDNYM polem (`needsAttention`) i jednym
// stałym prefiksem. Te testy pilnują, żeby żaden koniec tej rury nie odjechał
// osobno: serwer pisze, banerka czyta, ustawienia otwierają logowanie.
describe("banerka wygasłego logowania", () => {
  it("czyta narzędzie z treści, którą pisze serwer", () => {
    expect(expiredLoginTool("Login expired for claude. Sign in again to continue.")).toBe("claude");
    expect(expiredLoginTool("Login expired for opencode. Sign in again to continue.")).toBe("opencode");
  });

  it("prefiks jest ten sam, którym pisze serwer desktopu", () => {
    // Serwer żyje w repo `multibot-desktop` (server/auth-failure.ts) i pisze
    // tę treść dosłownie — aplikacja tylko ją czyta, więc literał musi stać.
    expect(LOGIN_EXPIRED_PREFIX).toBe("Login expired for ");
  });

  it("nie porywa innych powodów czekania", () => {
    expect(expiredLoginTool("Captcha przy logowaniu do Gmaila")).toBeNull();
    expect(expiredLoginTool(null)).toBeNull();
    expect(expiredLoginTool("")).toBeNull();
    expect(expiredLoginTool("Login expired for . brak nazwy")).toBeNull();
  });

  it("banerka stoi w czacie, prowadzi do ustawień i da się ją zamknąć per bot", () => {
    expect(read("./ChatView.tsx")).toContain("<AuthExpiredBanner bot={bot} />");
    const banner = read("./AuthExpiredBanner.tsx");
    // narzędzie jedzie akcją, tak jak konektor w Pluginach
    expect(banner).toContain('type: "toggleAppSettings", open: true, cliLogin: tool');
    // ChatView nie przemontowuje się przy zmianie bota — ukrycie musi być per bot
    expect(banner).toContain("`${bot.id}:${attention}`");
  });

  it("ustawienia otwierają zakładkę z listą CLI i same startują logowanie", () => {
    const panel = read("./AppSettingsPanel.tsx");
    expect(panel).toContain('if (cliLogin) setTab("other");');
    expect(panel).toContain("state.appSettingsCliLogin");
    expect(panel).toContain("if (tool.loginAvailable) void startLogin(tool);");
    // narzędzie bez interaktywnego logowania dostaje komendę do skopiowania
    expect(panel).toContain("setManualLogin(tool.id)");
    expect(panel).toContain("copyText(item.loginCommand");
  });

  it("prośba żyje w store, więc gaśnie razem z akcją — nie ma czego zostawić", () => {
    const store = read("../state/store.tsx");
    expect(store).toContain("appSettingsCliLogin?: string;");
    expect(store).toContain("appSettingsCliLogin: action.cliLogin,");
  });

  it("ramka z serwera ląduje w tym samym polu co reszta powodów czekania", () => {
    const store = read("../state/store.tsx");
    expect(store).toContain(`case "auth-expired":`);
    expect(store).toContain("needsAttention: frame.message");
  });
});
