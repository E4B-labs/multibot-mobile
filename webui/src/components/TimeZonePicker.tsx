import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { AUTO_TIMEZONE, detectTimeZone, filterTimeZones, listTimeZones, zoneLabel, zoneTime } from "@/lib/timezone";

export function TimeZonePicker({ value, onChange, polish }: { value: string; onChange: (zone: string) => void; polish: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const detected = useMemo(() => detectTimeZone(), []);
  const zones = useMemo(() => listTimeZones(), []);
  const autoLabel = polish ? `Wykryj automatycznie (${zoneLabel(detected)})` : `Detect automatically (${zoneLabel(detected)})`;
  const rows = useMemo(() => {
    const matches = filterTimeZones(zones, query);
    const auto = { id: AUTO_TIMEZONE, label: autoLabel, zone: detected };
    const rest = matches.map((zone) => ({ id: zone, label: zoneLabel(zone), zone }));
    const needle = query.trim().toLowerCase();
    return !needle || autoLabel.toLowerCase().includes(needle) || matches.includes(detected) ? [auto, ...rest] : rest;
  }, [autoLabel, detected, query, zones]);

  useEffect(() => setHighlight(0), [query]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    const clock = setInterval(() => setNow(new Date()), 30_000);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      clearInterval(clock);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setNow(new Date());
    inputRef.current?.focus();
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const index = rows.findIndex((row) => row.id === value);
    if (index >= 0) listRef.current?.children[index]?.scrollIntoView({ block: "center" });
  }, [open, rows, value]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (rows.length === 0) return;
      const next = (highlight + (event.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
      setHighlight(next);
      listRef.current?.children[next]?.scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter") {
      event.preventDefault();
      const row = rows[highlight];
      if (row) {
        onChange(row.id);
        setOpen(false);
      }
    }
  };

  const current = value === AUTO_TIMEZONE ? autoLabel : zoneLabel(value);
  return (
    <div ref={ref} className="relative min-w-0">
      <button
        type="button"
        onClick={() => {
          setQuery("");
          setOpen((currentOpen) => !currentOpen);
        }}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex max-w-full min-w-0 items-center gap-2 rounded-lg border border-hairline/40 bg-inset px-2.5 py-2 text-[13px] text-ink hover:bg-raised/40 focus:outline-none"
      >
        <span className="truncate">{current}</span>
        <ChevronDown size={14} className="shrink-0 text-ink-secondary" />
      </button>
      {open && (
        <div role="listbox" className="absolute right-0 top-full z-30 mt-1.5 w-[min(360px,calc(100vw-32px))] overflow-hidden rounded-xl border border-hairline/40 bg-card shadow-lg">
          <div className="flex items-center gap-2 border-b border-hairline/40 px-3 py-2.5">
            <Search size={14} className="shrink-0 text-ink-secondary" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder={polish ? "Szukaj strefy czasowej" : "Search time zone"}
              className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-secondary/60"
            />
            <button type="button" onClick={() => setOpen(false)} aria-label={polish ? "Zamknij" : "Close"} className="shrink-0 rounded-md p-0.5 text-ink-secondary hover:text-ink"><X size={14} /></button>
          </div>
          <div ref={listRef} className="max-h-[min(320px,50vh)] overflow-y-auto py-1">
            {rows.length === 0 && <div className="px-3 py-6 text-center text-[13px] text-ink-secondary">{polish ? "Brak pasującej strefy" : "No matching time zone"}</div>}
            {rows.map((row, index) => (
              <button
                key={row.id || "auto"}
                type="button"
                role="option"
                aria-selected={row.id === value}
                onClick={() => { onChange(row.id); setOpen(false); }}
                onMouseEnter={() => setHighlight(index)}
                className={cn("flex w-full items-center gap-3 px-3 py-2 text-left text-[13px] text-ink hover:bg-raised", index === highlight && "bg-raised")}
              >
                <span className="min-w-0 flex-1 truncate">{row.label}</span>
                <span className="shrink-0 text-ink-secondary">{zoneTime(row.zone, now)}</span>
                <Check size={14} className={cn("shrink-0", row.id === value ? "opacity-100" : "opacity-0")} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
