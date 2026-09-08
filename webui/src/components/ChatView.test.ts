import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { setBotDraft } from "./ChatView";

// multibot: awatar w pasku nad rozmową ma stać nieruchomo, gdy bot nie
// pracuje. Wcześniej MausAvatar w nagłówku szedł własną ścieżką (stateForBot
// + jednorazowy beat z `state.mascotMotion`, bez `animated`), więc bezczynny
// bot mrugał i oddychał, choć ten sam bot w szufladzie już stał.
const chat = readFileSync(new URL("./ChatView.tsx", import.meta.url), "utf8");

describe("drafty composera per bot", () => {
  it("przywraca tekst po powrocie do bota i czyści tylko wysłany draft", () => {
    const withBotA = setBotDraft({}, "bot-a", "Wiadomość dla A");
    const withBothBots = setBotDraft(withBotA, "bot-b", "Wiadomość dla B");

    expect(withBothBots).toEqual({ "bot-a": "Wiadomość dla A", "bot-b": "Wiadomość dla B" });
    expect(setBotDraft(withBothBots, "bot-a", "")).toEqual({ "bot-a": "", "bot-b": "Wiadomość dla B" });
  });

  it("przekazuje draft aktualnego bota do composera bez zmiany propsów reply", () => {
    expect(chat).toContain('draft={drafts[bot.id] ?? ""}');
    expect(chat).toContain("onDraftChange={(text) => updateDraft(bot.id, text)}");
    expect(chat).toContain("replyToId={replyTo?.id}");
    expect(chat).toContain("onClearReply={() => setReplyTo(null)}");
  });
});

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

/** Linie opisujące sam dymek. Filtr łapie mobilny rozmiar (`py-2.5`), nie
 *  desktopowy (`py-[5px]`), i pomija zaokrąglone elementy, które dymkiem nie są
 *  (np. podgląd ekranu bota). */
function bubbleLines(): string[] {
  return chat
    .split(/\r?\n/)
    .filter((line) => line.includes("rounded-2xl") && line.includes("py-2.5"));
}

describe("czat nie przewija się w bok", () => {
  // multibot (telefon): dymek bota sięga aż do krawędzi kolumny — desktopowe
  // `max-w-[90%] py-[5px]` zostawiało na ekranie telefonu pusty pas po prawej.
  // Zasada z desktopu zostaje w mocy: dymek ma się kurczyć i łamać długie
  // tokeny.
  it("oba dymki kurczą się i łamią długie tokeny", () => {
    const bubbles = bubbleLines();
    expect(bubbles.length).toBeGreaterThanOrEqual(2);
    for (const line of bubbles) {
      expect(line, `dymek bez min-w-0: ${line.trim()}`).toContain("min-w-0");
      expect(line, `dymek bez break-words: ${line.trim()}`).toContain("break-words");
    }
  });

  // multibot: pełna szerokość ma być SUFITEM, nie szerokością. `w-full`
  // rozciągało każdy dymek bota na całą kolumnę, więc jednoliniowa odpowiedź
  // („Sesja wygasła, loguję się ponownie.") wyglądała jak pas, a nie jak dymek
  // (Kacper 08.09, zrzut z telefonu; zmierzone w headless Chrome przy kolumnie
  // 400 px: `w-full` 400 px, `max-w-full` 267 px). Z samym sufitem dymek jako
  // element flexa kurczy się do treści, a długa wiadomość, tabela i blok kodu
  // nadal dostają całe 100%.
  it("dymki mają sufit szerokości, a nie sztywną pełną szerokość", () => {
    // Gałąź bota w `Bubble` — szerokość stoi w ternarnym, nie we wspólnej klasie.
    expect(chat, "dymek bota stracił sufit szerokości").toContain('"max-w-full bg-card text-ink"');
    // Wspólna klasa i dymek strumieniowany: żadnego przypięcia na sztywno.
    const bubbles = bubbleLines();
    expect(bubbles.length).toBeGreaterThanOrEqual(2);
    for (const line of bubbles) {
      // `\b` nie wystarcza: w `max-w-full` przed „w" też stoi granica słowa.
      expect(line, `dymek przypięty do pełnej szerokości: ${line.trim()}`).not.toMatch(/(?<![-\w])w-full\b/);
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

// multibot: prywatny czat pokazuje rozmowę bot↔bot jako pigułki zdarzeń
// („Atlas napisał(a) do Gatekeepera", „Gatekeeper odpisał(a)"), a nie surowe
// koperty. Wariant „odpisał(a)" dodany razem z ukryciem kopert po stronie
// serwera — bez niego każda odpowiedź kolegi czytała się jak nowy list.
describe("pigułka pokoju: napisał(a) / odpisał(a)", () => {
  it("ma oba warianty w obu językach i wybiera je po room.event", () => {
    expect(chat).toContain('room.event === "replied"');
    for (const label of ["odpisał(a)", "replied", "napisał(a) do", "texted"]) {
      expect(chat, `brak wariantu ${label}`).toContain(label);
    }
  });
});

// multibot: karta rozmowy bot↔bot to DRZWI do pokoju, nie szuflada. Wersja
// z 07.09 (kierunkowa aktywność) zamieniła kliknięcie na rozwijanie w dół
// listy członków, przez co do pokoju nie dało się wejść w ogóle. Kierunkowy
// opis i awatary zostają, klikniecie ma znowu otwierać transkrypt.
describe("karta bot↔bot otwiera pokój", () => {
  const card = chat.slice(chat.indexOf("function PeerActivity"), chat.indexOf("function RoomChip"));
  const legacyRoomChip = chat.slice(chat.indexOf("function RoomChip"), chat.indexOf("function userEventChip"));

  it("kliknięcie otwiera pokój, a nie rozwija karty", () => {
    expect(card).toContain("openRoom(room.id, dispatch)");
    for (const drawer of ["setExpanded", "aria-expanded", "ChevronDown"]) {
      expect(card, `karta znowu rozwija się w dół: ${drawer}`).not.toContain(drawer);
    }
  });

  it("karta jest klikalna w obie strony, nie tylko dla nadawcy", () => {
    expect(card, "wariant „od kogoś\" znowu jest martwym <div>").not.toMatch(/sent \?\s*\(?\s*<button/);
    expect((card.match(/<button/g) ?? []).length, "karta ma być jednym przyciskiem").toBe(1);
  });

  it("zostaje kierunkowy opis i awatary", () => {
    for (const label of ["Napisano do", "Messaged", "Wiadomość od", "Message from"]) {
      expect(card, `brak kierunkowego opisu ${label}`).toContain(label);
    }
    expect(card).toContain("const avatars = sent ? [actor, ...peers] : [actor];");
  });

  it("PeerActivity is a text-only row without a status pill", () => {
    expect(card).toContain('className="flex w-full min-w-0 cursor-pointer');
    for (const status of ["status", "Completed", "Uko\u0144czone", "Failed", "B\u0142\u0105d", "Working", "W toku"]) {
      expect(card, `PeerActivity still contains status: ${status}`).not.toContain(status);
    }
    for (const pillClass of ["border", "bg-", "rounded-"]) {
      expect(card, `PeerActivity still has pill class: ${pillClass}`).not.toContain(pillClass);
    }
  });

  it("legacy room links use the same borderless treatment", () => {
    expect(legacyRoomChip).toContain('const pill = "flex max-w-full items-center gap-1.5 py-1');
    expect(legacyRoomChip).not.toContain("border-hairline");
    expect(legacyRoomChip).not.toContain("bg-panel");
  });

  it("obie karty wchodzą do pokoju tym samym helperem", () => {
    expect(chat).toContain('dispatch({ type: "toggleRoom", room: full })');
    expect((chat.match(/openRoom\(room\.id, dispatch\)/g) ?? []).length).toBe(2);
  });
});
