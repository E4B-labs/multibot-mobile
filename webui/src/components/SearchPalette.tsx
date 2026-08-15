import { Search } from "lucide-react";
import { cn } from "@/lib/cn";

export const SEARCH_TABS = [
  "All",
  "Messages",
  "Agents",
  "Groups",
  "Files",
  "Links",
  "Routines",
  "Actions",
] as const;

export type SearchTab = (typeof SEARCH_TABS)[number];

export interface SearchPaletteProps {
  query: string;
  onQueryChange: (value: string) => void;
  activeTab: SearchTab;
  onTabChange: (tab: SearchTab) => void;
}

/**
 * Paleta wyszukiwania — wspólny język (inspiracje.png / U26): pełnoszerokości
 * pole z ikoną lupy i rząd zakładek filtrujących. Aktywna zakładka to jasna
 * pigułka, reszta szara.
 */
export function SearchPalette({
  query,
  onQueryChange,
  activeTab,
  onTabChange,
}: SearchPaletteProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 rounded-card border border-hairline bg-card px-3 py-2.5">
        <Search size={16} className="shrink-0 text-ink-secondary" />
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search"
          className="w-full bg-transparent text-[15px] text-ink placeholder:text-ink-secondary focus:outline-none"
        />
      </div>

      <div className="flex gap-2 overflow-x-auto">
        {SEARCH_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => onTabChange(tab)}
            className={cn(
              "shrink-0 rounded-full px-3 py-1 text-[13px]",
              tab === activeTab
                ? "bg-ink text-app"
                : "bg-raised text-ink-secondary hover:bg-raised-hover",
            )}
          >
            {tab}
          </button>
        ))}
      </div>
    </div>
  );
}
