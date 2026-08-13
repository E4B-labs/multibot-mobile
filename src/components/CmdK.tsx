// multibot: Cmd+K (macOS) / Ctrl+K command palette. Overlay follows the
// Onboarding pattern (fixed inset-0 + z-50 on app tokens), rows follow the
// Composer @mention picker. Actions are generated from what the store REALLY
// exposes: select / newBot / toggleSettings / toggleComputer /
// toggleAppSettings / togglePlugins. Fuzzy filter = plain case-insensitive
// subsequence match, no libraries.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Monitor, Plus, Puzzle, Settings, SlidersHorizontal } from "lucide-react";
import { useStore } from "@/state/store";
import { MausAvatar } from "./Avatar";
import { normalizeState } from "@/lib/mascot";
import { cn } from "@/lib/cn";

/** Subsequence match: every query char appears, in order, in the target. */
function fuzzyMatch(query: string, target: string): boolean {
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (!q) return true;
  const t = target.toLowerCase();
  let i = 0;
  for (const ch of t) {
    if (ch === q[i]) i++;
    if (i === q.length) return true;
  }
  return false;
}

interface Command {
  id: string;
  label: string;
  hint: string;
  icon: ReactNode;
  run: () => void;
}

export function CmdK() {
  const { state, dispatch } = useStore();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Meta+K on macOS, Ctrl+K everywhere. preventDefault is mandatory —
  // Chrome otherwise steals Ctrl+K for the address bar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      // Esc closes even when focus wandered off the input (no-op when closed)
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // fresh palette on every open
  useEffect(() => {
    if (open) {
      setQuery("");
      setHighlight(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const current = state.bots.find((b) => b.id === state.selectedId);

  const commands = useMemo<Command[]>(() => {
    const close = (fn: () => void) => () => {
      fn();
      setOpen(false);
    };
    const cmds: Command[] = state.bots
      .filter((b) => !b.hidden)
      .map((b) => ({
        id: `bot:${b.id}`,
        label: b.name,
        hint: b.id === state.selectedId ? "Current bot" : "Switch to bot",
        icon: (
          <MausAvatar color={b.color} state={normalizeState(b.mascotExpression) ?? "happy"} size={22} />
        ),
        run: close(() => dispatch({ type: "select", id: b.id })),
      }));
    cmds.push({
      id: "new-bot",
      label: "New bot",
      hint: "Create",
      icon: <Plus size={16} />,
      run: close(() => dispatch({ type: "newBot" })),
    });
    // panel actions that need a bot exist only when one is selected —
    // Shell renders SettingsPanel/ComputerPanel only when `bot` is truthy
    if (current) {
      cmds.push({
        id: "settings",
        label: `Bot settings — ${current.name}`,
        hint: "Panel",
        icon: <Settings size={16} />,
        run: close(() => dispatch({ type: "toggleSettings", open: true })),
      });
      cmds.push({
        id: "computer",
        label: `Bot's computer — ${current.name}`,
        hint: "Panel",
        icon: <Monitor size={16} />,
        run: close(() => dispatch({ type: "toggleComputer", open: true })),
      });
    }
    cmds.push({
      id: "app-settings",
      label: "App settings",
      hint: "Panel",
      icon: <SlidersHorizontal size={16} />,
      run: close(() => dispatch({ type: "toggleAppSettings", open: true })),
    });
    cmds.push({
      id: "plugins",
      label: "Plugins",
      hint: "Panel",
      icon: <Puzzle size={16} />,
      run: close(() => dispatch({ type: "togglePlugins", open: true })),
    });
    return cmds;
  }, [state.bots, state.selectedId, current, dispatch]);

  const visible = useMemo(() => commands.filter((c) => fuzzyMatch(query, c.label)), [commands, query]);

  useEffect(() => setHighlight(0), [query]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-app/80 pt-[18vh]"
      onMouseDown={() => setOpen(false)}
    >
      <div
        className="w-[560px] max-w-[calc(100vw-40px)] animate-pop-in overflow-hidden rounded-2xl border border-hairline/40 bg-panel shadow-lg"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setOpen(false);
              return;
            }
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              if (!visible.length) return;
              const delta = e.key === "ArrowDown" ? 1 : -1;
              setHighlight((h) => (h + delta + visible.length) % visible.length);
              return;
            }
            if (e.key === "Enter") {
              e.preventDefault();
              visible[highlight]?.run();
            }
          }}
          placeholder="Type a command or bot name…"
          className="w-full border-b border-hairline/30 bg-transparent px-4 py-3 text-[15px] text-ink placeholder:text-ink-secondary focus:outline-none"
        />
        <div className="max-h-[320px] overflow-y-auto py-1.5">
          {visible.length === 0 && (
            <div className="px-4 py-3 text-[13px] text-ink-secondary">No matching commands</div>
          )}
          {visible.map((c, i) => (
            <button
              key={c.id}
              onClick={c.run}
              onMouseEnter={() => setHighlight(i)}
              className={cn(
                "flex w-full items-center gap-2.5 px-4 py-2 text-left",
                i === highlight ? "bg-raised-hover" : "",
              )}
            >
              <span className="flex size-6 shrink-0 items-center justify-center text-ink-secondary">
                {c.icon}
              </span>
              <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink">{c.label}</span>
              <span className="shrink-0 text-xs text-ink-secondary">{c.hint}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
