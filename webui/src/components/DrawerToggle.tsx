import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";

// Hamburger wkomponowany w pasek nagłówka czatu/grupy (nie jako fixed overlay).
// Dzięki temu pasek i przycisk są w jednym rzędzie, tej samej wysokości — nie
// ma wolnego miejsca pod osobnym, wyższym przyciskiem. Przełącza drawer
// (`mb-drawer-open` na <body>); pokazuje ✕, gdy drawer jest otwarty, i scrim
// do zamykania na tap.
export function DrawerToggle() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const sync = () => setOpen(document.body.classList.contains("mb-drawer-open"));
    sync();
    const id = window.setInterval(sync, 200);
    return () => window.clearInterval(id);
  }, []);
  return (
    <>
      <button
        onClick={() => document.body.classList.toggle("mb-drawer-open")}
        className="md:hidden flex h-11 w-10 shrink-0 items-center justify-center rounded-lg text-ink hover:bg-raised"
        aria-label={open ? "Close menu" : "Menu"}
      >
        {open ? <X size={24} /> : <Menu size={24} />}
      </button>
      {open && (
        <div
          onClick={() => document.body.classList.remove("mb-drawer-open")}
          className="fixed inset-0 z-[55] bg-black/50 md:hidden"
        />
      )}
    </>
  );
}
