import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// multibot: grupa ma być zwykłym czatem — jedna wiadomość do wszystkich,
// serwer wybiera, kto odpowiada. Panel z polami „zadanie na bota" i
// przyciskiem uruchamiania to była poprzednia, odrzucona wersja; test pilnuje,
// żeby nie wróciła. Vitest chodzi tu w środowisku node (repo nie ma jsdom),
// więc sprawdzamy źródło, wzorem `WindowControls.test.ts`.
const panel = readFileSync(new URL("./GroupPanel.tsx", import.meta.url), "utf8");
const members = readFileSync(new URL("./GroupMembersPanel.tsx", import.meta.url), "utf8");
const sidebar = readFileSync(new URL("./Sidebar.tsx", import.meta.url), "utf8");

describe("GroupPanel", () => {
  it("nie ma już panelu zadań ani przycisku uruchamiania", () => {
    for (const gone of ["Bot tasks", "Zadania botów", "Run tasks", "Uruchom zadania", "buildGroupTasks", "<textarea"]) {
      expect(panel).not.toContain(gone);
    }
  });

  it("jest czatem: lista wiadomości plus Composer", () => {
    expect(panel).toContain('import { Composer } from "./Composer"');
    expect(panel).toContain("<Composer bot={answering} onSend={send} />");
    expect(panel).toContain("This group has no bots left.");
    expect(panel).toContain("/chat");
  });

  it("awatary w grupie są statyczne", () => {
    for (const source of [panel, members]) {
      const tags = source.match(/<MausAvatar[^>]*>/gs) ?? [];
      expect(tags.length).toBeGreaterThan(0);
      for (const tag of tags) expect(tag).toContain("animated={false}");
    }
  });
});

describe("GroupMembersPanel", () => {
  it("ma nagłówek Członkowie, podpowiedź i przycisk rutyny", () => {
    expect(members).toContain("Członkowie");
    expect(members).toContain("Members");
    expect(members).toContain("Utwórz więcej Botów, aby dodać je tutaj.");
    expect(members).toContain("Create more Bots to add them here.");
    expect(members).toContain("Rutyny to powtarzalne zadania, które ten Bot uruchamia zgodnie z harmonogramem.");
    expect(members).toContain("Utwórz rutynę");
  });
});

describe("wiersz grupy w Sidebarze", () => {
  // multibot (telefon): ten sam wiersz co na desktopie, ale w rozmiarach
  // szuflady. Desktop rysuje awatary 20 px, telefon 40 px — cała szuflada stoi
  // na 40 px, bo w to trzeba trafić palcem. Tworzenie grupy to dolna szuflada
  // `GroupCreateSheet`, nie desktopowy formularz `GroupCreateForm`, więc koniec
  // wiersza wypada na innej nazwie funkcji. Zasada, której test pilnuje, jest
  // ta sama: awatary są STATYCZNE (`sidebarAvatarProps` daje `animated:false`),
  // widocznych jest najwyżej dwóch członków, reszta idzie na plakietkę `+N`.
  it("ma statyczne awatary w rozmiarze szuflady i znaczek +N", () => {
    const start = sidebar.indexOf("groupAvatarSplit(members");
    const end = sidebar.indexOf("function GroupCreateSheet", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const row = sidebar.slice(start, end);
    expect(row).toContain("size={40}");
    expect(row).toContain("overflow > 0");
    expect(row).toContain("+{overflow}");
    expect(row).toContain("{...sidebarAvatarProps(b)}");
  });
});
