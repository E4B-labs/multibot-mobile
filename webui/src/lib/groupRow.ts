// Wiersz grupy w szufladzie: kafelek awatarów o rozmiarze awatara bota
// (`min-h-14 min-w-14`) + nazwy członków jako tytuł. Czyste funkcje siedzą tu,
// a nie w `Sidebar.tsx`, żeby dało się je przetestować bez renderowania całej
// szuflady.

/** Tytuł wiersza = nazwy członków po przecinku (kolejność z `bot_ids`). */
export function groupRowTitle(memberNames: string[]): string {
  return memberNames.join(", ");
}

/** Twardy sufit składu grupy — ten sam po stronie serwera. */
export const MAX_GROUP_MEMBERS = 12;

/**
 * Układ awatarów w kafelku wielkości jednego awatara bota. Liczy się PEŁNY
 * skład (`totalCount` z `bot_ids`), bo lokalna lista botów może nie znać
 * każdego członka — inaczej grupa czterech ze znanym jednym udawałaby solo.
 */
export function groupAvatarLayout<T>(
  members: T[],
  totalCount = members.length,
): { layout: "solo" | "pair" | "trio" | "stack"; shown: T[]; hiddenCount: number } {
  const count = Math.max(0, totalCount);
  if (count <= 1) return { layout: "solo", shown: members.slice(0, 1), hiddenCount: 0 };
  if (count === 2) return { layout: "pair", shown: members.slice(0, 2), hiddenCount: 0 };
  if (count === 3) return { layout: "trio", shown: members.slice(0, 3), hiddenCount: 0 };
  return { layout: "stack", shown: members.slice(0, 2), hiddenCount: count - 2 };
}
