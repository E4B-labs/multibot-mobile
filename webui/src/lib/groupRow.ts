// Wiersz grupy w szufladzie: kafelek awatarów o rozmiarze awatara bota
// (`size-14`, czyli 56 px) + nazwy członków jako tytuł. Czyste funkcje siedzą tu,
// a nie w `Sidebar.tsx`, żeby dało się je przetestować bez renderowania całej
// szuflady.

/** Tytuł wiersza = nazwy członków po przecinku (kolejność z `bot_ids`). */
export function groupRowTitle(memberNames: string[]): string {
  return memberNames.join(", ");
}

/** Twardy sufit składu grupy — ten sam po stronie serwera. */
export const MAX_GROUP_MEMBERS = 12;

export type GroupAvatarLayout = "solo" | "pair" | "trio";

/** Układ klastra awatarów w wierszu grupy.
 *
 *  `members` to boty, które szuflada potrafi narysować, `totalCount` to pełny
 *  skład z `bot_ids`. Te dwie liczby się rozjeżdżają, bo lista grup
 *  (`useEngineGroups`) i lista botów przychodzą osobno: dopóki ta druga nie
 *  dogoni, grupa niesie identyfikator bez bota.
 *
 *  Klaster ma zawsze najwyżej TRZY elementy i układ idzie za ich liczbą, nie za
 *  składem grupy: do trzech członków każdy dostaje własny awatar, od czterech
 *  rysujemy dwa awatary plus plakietkę „+N". Członek, którego nie da się
 *  narysować, wpada do plakietki. Wcześniej układ dla składów do trzech
 *  wybierało `known`, więc trójka z jednym nieznanym botem rysowała się jak
 *  zwykła para i trzeci członek znikał bez śladu. */
export function groupAvatarLayout<T>(
  members: T[],
  totalCount = members.length,
): { layout: GroupAvatarLayout; shown: T[]; hiddenCount: number } {
  const total = Math.max(0, totalCount);
  const shown = members.slice(0, Math.min(total, total <= 3 ? 3 : 2));
  const hiddenCount = total - shown.length;
  const slots = shown.length + (hiddenCount > 0 ? 1 : 0);
  const layout: GroupAvatarLayout = slots <= 1 ? "solo" : slots === 2 ? "pair" : "trio";
  return { layout, shown, hiddenCount };
}
