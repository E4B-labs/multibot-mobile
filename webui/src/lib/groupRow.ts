// Wiersz grupy w szufladzie, wzorem komunikatora: poziomy stos awatarów składu
// + nazwy członków jako tytuł. Czyste funkcje siedzą tu, a nie w `Sidebar.tsx`,
// żeby dało się je przetestować bez renderowania całej szuflady.

/** Tytuł wiersza = nazwy członków po przecinku (kolejność z `bot_ids`). */
export function groupRowTitle(memberNames: string[]): string {
  return memberNames.join(", ");
}

/** Wszystkie znane avatary grupy, w kolejności z `bot_ids`. */
export function groupAvatarStack<T>(members: T[]): T[] {
  return members.slice();
}
