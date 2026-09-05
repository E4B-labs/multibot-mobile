import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// multibot: awatar w pasku nad rozmową ma stać nieruchomo, gdy bot nie
// pracuje. Wcześniej MausAvatar w nagłówku szedł własną ścieżką (stateForBot
// + jednorazowy beat z `state.mascotMotion`, bez `animated`), więc bezczynny
// bot mrugał i oddychał, choć ten sam bot w szufladzie już stał.
const chat = readFileSync(new URL("./ChatView.tsx", import.meta.url), "utf8");

describe("awatar w nagłówku czatu", () => {
  it("liczy propsy tym samym helperem co szuflada", () => {
    expect(chat).toContain("sidebarAvatarProps(bot)");
    expect(chat).toContain("animated={headerAvatar.animated}");
  });

  it("nie odtwarza jednorazowego beatu ze store'u", () => {
    expect(chat, "nagłówek znowu animuje bezczynnego bota").not.toContain("state.mascotMotion");
  });
});

// multibot: poziomy pasek przewijania w czacie i biały kwadracik w jego prawym
// końcu. Dymek jest elementem flexa, więc `min-width:auto` nie pozwalał mu
// zejść poniżej szerokości min-content — jeden długi token bez spacji rozpychał
// wiersz poza listę. Narożnik paska Chrome domyślnie maluje na BIAŁO, gdy
// jakikolwiek `::-webkit-scrollbar` jest ostylowany.
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

describe("czat nie przewija się w bok", () => {
  // multibot (telefon): dymek bota idzie na CAŁĄ szerokość kolumny — desktopowe
  // `max-w-[90%] py-[5px]` zostawiało na ekranie telefonu pusty pas po prawej.
  // Zasada z desktopu zostaje w mocy: dymek ma się kurczyć i łamać długie
  // tokeny. Filtr łapie więc mobilny rozmiar (`py-2.5`), nie desktopowy.
  it("oba dymki kurczą się i łamią długie tokeny", () => {
    const bubbles = chat
      .split(/\r?\n/)
      .filter((line) => line.includes("rounded-2xl") && line.includes("py-2.5"));
    expect(bubbles.length).toBeGreaterThanOrEqual(2);
    for (const line of bubbles) {
      expect(line, `dymek bez min-w-0: ${line.trim()}`).toContain("min-w-0");
      expect(line, `dymek bez break-words: ${line.trim()}`).toContain("break-words");
    }
  });

  it("lista wiadomości ma oddech pod ostatnim dymkiem", () => {
    expect(chat).toContain('className="flex w-full min-w-0 flex-col gap-1 pb-16"');
  });

  /** Ciało JEDNEJ reguły CSS: od selektora do najbliższej klamry zamykającej.
   *  Bez tego `slice` leciał do końca pliku i asercja przechodziła na
   *  deklaracji z zupełnie innej reguły niżej — skasowanie tej właściwej
   *  nie wywaliłoby testu. */
  const ruleBody = (selector: string) => {
    const at = css.indexOf(selector);
    expect(at, `nie ma reguły ${selector}`).toBeGreaterThanOrEqual(0);
    return css.slice(at, css.indexOf("}", at));
  };

  it("narożnik paska jest przezroczysty, a pasek poziomy tak samo cienki", () => {
    expect(ruleBody("::-webkit-scrollbar-corner")).toMatch(/background:\s*transparent/);
    expect(ruleBody("::-webkit-scrollbar {")).toMatch(/height:\s*8px/);
  });
});

// multibot: czip pokoju w prywatnym watku czlonka grupy pokazywal "X napisal(a)
// do Y, Z" — bez sensu, bo tura grupowa to JEDEN pokoj wspolny. Ma nazywac
// grupe i prowadzic do czatu grupy, w obu jezykach.
describe("czip pokoju grupowego", () => {
  const chip = chat.slice(chat.indexOf("function RoomChip"), chat.indexOf("function userEventChip"));

  it("dla pokoju grupy pisze o grupie zamiast \"napisal(a) do\"", () => {
    expect(chip).toContain("const groupId = room.groupId;");
    expect(chip).toContain('"Rozmowa w grupie"');
    expect(chip).toContain('"Group chat:"');
    expect(chip).toContain("{room.name}");
  });

  it("klikniecie otwiera grupe, nie pokoj", () => {
    const branch = chip.slice(chip.indexOf("if (groupId) {"), chip.indexOf("const owner ="));
    expect(branch).toContain("/api/groups/${encodeURIComponent(groupId)}");
    expect(branch).toContain('type: "toggleGroup"');
    expect(branch).not.toContain("toggleRoom");
  });
});
