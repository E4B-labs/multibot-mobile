// Czysta logika grup botów, wyjęta z `Sidebar.tsx` wyłącznie po to, żeby dało
// się ją przetestować. Testy jadą w środowisku `node` i po wzorcu `*.test.ts`
// (patrz `include` w `vite.config.ts`), więc import samego `Sidebar.tsx`
// wciągnąłby React, lucide i `@/lib/analytics` (posthog inicjuje się przy
// wczytaniu modułu) — czyli pół aplikacji po to, żeby sprawdzić dwa warunki.

/**
 * Identyfikator bota po stronie silnika. Ten sam wzorzec co w
 * driverze silnika i w `GroupPanel` — odwracalny, więc z samego id
 * da się wrócić do bota aplikacji.
 */
export function engineBotId(threadId: string): string {
  return `mb-${threadId}`;
}

/**
 * Grupę da się utworzyć dopiero, gdy ma nazwę i co najmniej jednego bota.
 * Silnik odrzuciłby jedno i drugie, ale przycisk ma być wyszarzony ZANIM
 * użytkownik wyśle żądanie — na telefonie odpowiedź serwera przychodzi po
 * sekundach i pusty formularz wyglądałby na zawieszony.
 */
export function canCreateGroup(name: string, pickedCount: number): boolean {
  return name.trim().length > 0 && pickedCount > 0;
}
