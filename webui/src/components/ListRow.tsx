import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type ListRowMeta =
  | { kind: "type"; value: string }
  | { kind: "time"; value: string };

export interface ListRowProps {
  avatar?: ReactNode;
  name: string;
  role?: string;
  description?: string;
  /** Prawa strona wiersza: typ (Agent/Skill/...) albo godzina. */
  meta?: ListRowMeta;
  onClick?: () => void;
  selected?: boolean;
}

/**
 * Wiersz listy — wspólny język (inspiracje.png / U26): okrągły kolorowy awatar,
 * pogrubiona nazwa, tuż za nią szara pigułka z rolą, w drugiej linii szary opis
 * ucięty do jednej linii, po prawej wyszarzony typ albo godzina.
 */
export function ListRow({
  avatar,
  name,
  role,
  description,
  meta,
  onClick,
  selected,
}: ListRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-card border border-hairline bg-card px-4 py-3 text-left",
        selected ? "ring-1 ring-accent/60" : "hover:bg-raised/60",
      )}
    >
      {avatar ? <div className="shrink-0">{avatar}</div> : null}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-semibold text-ink">{name}</span>
          {role ? (
            <span className="shrink-0 rounded-full bg-raised px-2 py-0.5 text-[12px] text-ink-secondary">
              {role}
            </span>
          ) : null}
        </div>
        {description ? (
          <div className="truncate text-[13px] text-ink-secondary">{description}</div>
        ) : null}
      </div>

      {meta ? (
        <div className="shrink-0 text-[13px] text-ink-secondary">
          {meta.value}
        </div>
      ) : null}
    </button>
  );
}
