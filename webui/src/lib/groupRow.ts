// Wiersz grupy w szufladzie, wzorem komunikatora: skos z dwóch awatarów składu
// + nazwy członków jako tytuł. Czyste funkcje siedzą tu, a nie w `Sidebar.tsx`,
// żeby dało się je przetestować bez renderowania całej szuflady.

/** Tytuł wiersza = nazwy członków po przecinku (kolejność z `bot_ids`). */
export function groupRowTitle(memberNames: string[]): string {
  return memberNames.join(", ");
}

/**
 * Kafelek grupy w stylu komunikatora: skos z dwóch awatarów, a przy większym
 * składzie przedni awatar zastępuje kółko „+N" (N = wszyscy oprócz tylnego).
 * Jeden członek — jeden awatar, bez skosu.
 *
 * `total` liczymy z `bot_ids`, nie z dopasowanych botów — grupa może trzymać
 * bota, którego ta aplikacja nie zna, a wtedy `+N` gubiłoby go po cichu.
 */
export function groupAvatarStack<T>(
  members: T[],
  total = members.length,
): { shown: T[]; plus: number } {
  if (total > 2) return { shown: members.slice(0, 1), plus: total - 1 };
  return { shown: members.slice(0, 2), plus: 0 };
}
