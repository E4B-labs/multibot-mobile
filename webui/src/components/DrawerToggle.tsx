import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";

// Hamburger wkomponowany w pasek nagłówka czatu/grupy (nie jako fixed overlay).
// Dzięki temu pasek i przycisk są w jednym rzędzie, tej samej wysokości — nie
// ma wolnego miejsca pod osobnym, wyższym przyciskiem. Przełącza drawer
// (`mb-drawer-open` na <body>). Na mobile drawer to pełny panel zamykany
// wyborem bota z listy (brak scrimu do tapnięcia na zewnątrz).
export function DrawerToggle() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const sync = () => setOpen(document.body.classList.contains("mb-drawer-open"));
    sync();
    const id = window.setInterval(sync, 200);
    return () => window.clearInterval(id);
  }, []);
  return (
    <button
      onClick={() => document.body.classList.toggle("mb-drawer-open")}
      className="md:hidden flex h-11 w-10 shrink-0 items-center justify-center rounded-lg text-ink hover:bg-raised"
      aria-label={open ? "Close menu" : "Menu"}
    >
      {open ? <X size={24} /> : <Menu size={24} />}
    </button>
  );
}
