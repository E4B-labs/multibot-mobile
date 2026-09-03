// Wiersz grupy w szufladzie, wzorem Grok Bota: awatary składu + nazwy członków
// jako tytuł. Czyste funkcje siedzą tu, a nie w `Sidebar.tsx`, żeby dało się je
// przetestować bez renderowania całej szuflady.

/** Tytuł wiersza = nazwy członków po przecinku (kolejność z `bot_ids`). */
export function groupRowTitle(memberNames: string[]): string {
  return memberNames.join(", ");
}

/**
 * Awatary: najwyżej `max` widocznych, reszta jako liczba na plakietce `+N`.
 * `total` liczymy z `bot_ids`, nie z dopasowanych botów — grupa może trzymać
 * bota, którego ta aplikacja nie zna, a wtedy `+N` gubiłoby go po cichu.
 */
export function groupAvatarSplit<T>(
  members: T[],
  max = 2,
  total = members.length,
): { shown: T[]; overflow: number } {
  const shown = members.slice(0, max);
  return { shown, overflow: Math.max(0, total - shown.length) };
}
