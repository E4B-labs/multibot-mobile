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
      const tags = source.match(/<BotAvatar[^>]*>/gs) ?? [];
      expect(tags.length).toBeGreaterThan(0);
      for (const tag of tags) expect(tag).toContain("animated={false}");
    }
  });

  it("używa jednej spokojnej twarzy referencyjnej we wszystkich avatarach grupy", () => {
    for (const source of [panel, members]) {
      expect(source).toContain("GROUP_AVATAR_STATE");
      expect(source).toContain('shape="blob"');
      expect(source).not.toContain("avatarUrl=");
      expect(source).not.toContain("stateForBot(");
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
  it("mieści cały skład w kafelku wielkości awatara bota", () => {
    const start = sidebar.indexOf("groupAvatarLayout(members");
    const end = sidebar.indexOf("function GroupCreateSheet", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const row = sidebar.slice(start, end);
    // Kafelek ma stały rozmiar awatara bota (56 px), więc wiersz grupy jest
    // dokładnie tak wysoki jak wiersz bota — po to była cała ta przeróbka.
    expect(row).toContain('className="relative size-14 shrink-0"');
    expect(row).toContain("GROUP_AVATAR_SLOTS[layout][index]");
    expect(row).toContain("size={layout === \"solo\" ? 56 : 28}");
    // Skład liczony z `bot_ids`, nie z lokalnie znanych botów.
    expect(row).toContain("groupAvatarLayout(members, group.bot_ids.length)");
    expect(row).not.toContain("groupAvatarLayout(members, members.length)");
    expect(row).toContain("+{hiddenCount}");
    expect(row).toContain('layout === "stack" && hiddenCount > 0');
    expect(row).toContain("aria-label={polish ? `${hiddenCount} dodatkowych botów`");
    // Poprzedni układ: poziomy stos trzech awatarów rozpychający wiersz.
    expect(row).not.toContain("-space-x-1.5");
    expect(row).not.toContain("min-h-14 min-w-14");
    // Awatary członków są bez obwódek (31d72f7) — plakietka +N ma jedyny ring.
    expect(row).not.toContain("ring-2 ring-app");
    expect(row).not.toContain("rounded-full ring");
    expect(row).toContain("avatarUrl={member.avatarUrl}");
    expect(row).toContain("shape={member.mascotShape}");
    expect(row).toContain("{...groupMemberAvatarProps(member)}");
    // Mobilne zachowania wiersza zostają nietknięte.
    expect(row).toContain('selected ? "bg-white/[0.07]" : "hover:bg-white/[0.04]"');
    expect(row).toContain("onContextMenu={(e) => {");
    expect(row).toContain('style={{ WebkitTouchCallout: "none" }}');
  });

  it("cztery ułożenia siedzą w jednym miejscu i nie zachodzą na siebie", () => {
    const slotsStart = sidebar.indexOf("const GROUP_AVATAR_SLOTS");
    const slots = sidebar.slice(slotsStart, sidebar.indexOf("function GroupRow", slotsStart));
    expect(slots).toContain('solo: ["inset-0"]');
    expect(slots).toContain('pair: ["left-0 top-3.5", "right-0 top-3.5"]');
    expect(slots).toContain('trio: ["left-0 top-0", "right-0 top-0", "bottom-0 left-3.5"]');
    expect(slots).toContain('stack: ["left-0 top-0", "bottom-0 left-0"]');
  });
});

describe("szuflada tworzenia grupy", () => {
  it("pilnuje sufitu dwunastu botów", () => {
    const sheetStart = sidebar.indexOf("function GroupCreateSheet");
    const sheet = sidebar.slice(sheetStart, sidebar.indexOf("export function Sidebar()", sheetStart));
    expect(sheet).toContain("else if (next.size < MAX_GROUP_MEMBERS) next.add(id);");
    expect(sheet).toContain("const full = !on && picked.size >= MAX_GROUP_MEMBERS;");
    expect(sheet).toContain("disabled={full}");
    expect(sheet).toContain("{picked.size}/{MAX_GROUP_MEMBERS}");
  });
});
