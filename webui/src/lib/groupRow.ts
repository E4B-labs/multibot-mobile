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

export type GroupAvatarLayout = "solo" | "pair" | "trio" | "stack";

/** Układ klastra awatarów w wierszu grupy.
 *
 *  `members` to boty, które szuflada potrafi narysować, `totalCount` to pełny
 *  skład z `bot_ids`. Te dwie liczby się rozjeżdżają: skasowanie bota nie
 *  wyjmuje go z grupy, więc `bot_ids` niesie identyfikatory bez bota. Dlatego
 *  układ dla składów do trzech wybieramy po tym, ile awatarów DA SIĘ narysować
 *  — inaczej para z jednym żywym botem rysowałaby jeden mały awatar przy lewej
 *  krawędzi i pustą połowę pudełka. Plakietka „+N" zostaje dokładką do stosu i
 *  zawsze domyka licznik do pełnego składu. */
export function groupAvatarLayout<T>(
  members: T[],
  totalCount = members.length,
): { layout: GroupAvatarLayout; shown: T[]; hiddenCount: number } {
  const total = Math.max(0, totalCount);
  if (total >= 4) {
    const shown = members.slice(0, 2);
    return { layout: "stack", shown, hiddenCount: total - shown.length };
  }
  const known = Math.min(members.length, total);
  const layout: GroupAvatarLayout = known <= 1 ? "solo" : known === 2 ? "pair" : "trio";
  return { layout, shown: members.slice(0, known), hiddenCount: 0 };
}
