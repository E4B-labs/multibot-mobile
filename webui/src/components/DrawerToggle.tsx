import { Menu } from "lucide-react";

// Hamburger wkomponowany w pasek nagłówka czatu/grupy (nie jako fixed overlay).
// Dzięki temu pasek i przycisk są w jednym rzędzie, tej samej wysokości — nie
// ma wolnego miejsca pod osobnym, wyższym przyciskiem. Przełącza drawer
// (`mb-drawer-open` na <body>). Na mobile drawer to pełny panel zamykany
// wyborem bota z listy (brak scrimu do tapnięcia na zewnątrz).
//
// Przycisk pokazuje wyłącznie hamburger. Wcześniej przy otwartym drawerze
// zmieniał się w „X", ale ten stan był nie do zobaczenia: otwarty drawer to
// `fixed inset-0 z-[60]`, więc zakrywa cały nagłówek czatu razem z tym
// przyciskiem. Ikona „X" w lewym górnym rogu tylko myliła, a jej utrzymanie
// kosztowało odpytywanie klasy <body> pięć razy na sekundę (setInterval 200 ms)
// przez cały czas życia aplikacji — po nic, bo wynik nigdy nie był widoczny.
export function DrawerToggle() {
  return (
    <button
      onClick={() => document.body.classList.toggle("mb-drawer-open")}
      className="md:hidden flex h-11 w-10 shrink-0 items-center justify-center rounded-lg text-ink hover:bg-raised"
      aria-label="Menu"
    >
      <Menu size={24} />
    </button>
  );
}
