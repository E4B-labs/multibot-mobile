import { track } from "@/lib/analytics";
import { useEffect, useState } from "react";
import {
  Bot as BotIcon,
  BellDot,
  ClipboardCopy,
  Copy,
  EyeOff,
  FolderPlus,
  Loader2,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
  Puzzle,
  Trash2,
  Users,
} from "lucide-react";
import { useStore, formatTime, type Bot, type EngineGroup } from "@/state/store";
import { MausAvatar, InitialsAvatar } from "./Avatar";
import { stateForBot } from "@/lib/mascot";
import { cn } from "@/lib/cn";
import { authFetch } from "@/lib/auth";
// multibot: F11 — status silnika dla warunkowej kropki w stopce
import { engineOnline } from "@/lib/engineStatus";
import { useLanguage } from "@/lib/language";

const isElectron = navigator.userAgent.includes("Electron");

/** "Milind Soni" → "MS", "milind" → "M", "you@x.dev" → "Y", unset → "?" */
function profileInitials(profile?: { name?: string; email?: string }): string {
  const name = profile?.name?.trim();
  if (name) {
    const words = name.split(/\s+/);
    return words
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("");
  }
  const email = profile?.email?.trim();
  return email ? email[0]!.toUpperCase() : "?";
}

function preview(bot: Bot): string {
  if (bot.busy) return "Working…";
  const last = bot.messages[bot.messages.length - 1];
  if (!last) return "";
  if (last.kind === "options" && last.card) return last.card.title;
  if (last.kind === "activity" && last.tool) return last.tool.name;
  if (last.kind === "screen") return "Screen frame";
  return last.text ?? "";
}

interface MenuState {
  botId: string;
  x: number;
  y: number;
}

function BotContextMenu({ menu, onClose }: { menu: MenuState; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const bot = state.bots.find((b) => b.id === menu.botId);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-bot-menu]")) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  if (!bot) return null;
  // keep the menu on-screen near the click
  const top = Math.min(menu.y, window.innerHeight - 340);
  const left = Math.min(menu.x, window.innerWidth - 240);

  const item = (
    icon: React.ReactNode,
    label: string,
    onClick?: () => void,
    opts?: { danger?: boolean; disabled?: boolean; hint?: string },
  ) => (
    <button
      key={label}
      disabled={opts?.disabled}
      onClick={() => {
        onClick?.();
        onClose();
      }}
      title={opts?.hint}
      className={cn(
        "flex w-full items-center gap-3 px-3.5 py-2 text-left text-[14px]",
        opts?.danger ? "text-danger" : "text-ink",
        opts?.disabled ? "cursor-default opacity-40" : "hover:bg-raised/70",
      )}
    >
      {icon}
      {label}
    </button>
  );
  const divider = (key: string) => <div key={key} className="mx-2 my-1 border-t border-hairline/40" />;

  return (
    <div
      data-bot-menu
      style={{ top, left }}
      className="fixed z-40 w-[228px] overflow-hidden rounded-xl border border-hairline/50 bg-card py-1.5 shadow-2xl shadow-black/60"
    >
      {[
        item(
          bot.pinned ? <PinOff size={16} className="text-ink-secondary" /> : <Pin size={16} className="text-ink-secondary" />,
          bot.pinned ? "Unpin" : "Pin",
          () => dispatch({ type: "updateBot", botId: bot.id, patch: { pinned: !bot.pinned } }),
        ),
        item(<FolderPlus size={16} className="text-ink-secondary" />, "Move to new section", undefined, {
          disabled: true,
          hint: "Coming soon",
        }),
        item(<BellDot size={16} className="text-ink-secondary" />, "Mark as Unread", () =>
          dispatch({ type: "markUnread", botId: bot.id }),
        ),
        divider("d1"),
        item(<Pencil size={16} className="text-ink-secondary" />, "Edit Profile", () => {
          dispatch({ type: "select", id: bot.id });
          dispatch({ type: "toggleSettings", open: true });
        }),
        item(<Copy size={16} className="text-ink-secondary" />, "Duplicate", () =>
          dispatch({ type: "duplicateBot", botId: bot.id }),
        ),
        divider("d2"),
        item(<ClipboardCopy size={16} className="text-ink-secondary" />, "Copy conversation ID", () => {
          void navigator.clipboard?.writeText(bot.threadId);
        }),
        divider("d3"),
        item(<EyeOff size={16} className="text-ink-secondary" />, "Hide from sidebar", () =>
          dispatch({ type: "updateBot", botId: bot.id, patch: { hidden: true } }),
        ),
        item(<Trash2 size={16} />, "Delete", () => dispatch({ type: "deleteBot", botId: bot.id }), {
          danger: true,
        }),
      ]}
    </div>
  );
}

function BotListItem({ bot, onMenu }: { bot: Bot; onMenu: (menu: MenuState) => void }) {
  const { state, dispatch } = useStore();
  const selected = state.selectedId === bot.id;
  const mascotMotion = selected && state.mascotMotion?.botId === bot.id ? state.mascotMotion : null;
  const last = bot.messages[bot.messages.length - 1];
  return (
    <button
      onClick={() => dispatch({ type: "select", id: bot.id })}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu({ botId: bot.id, x: e.clientX, y: e.clientY });
      }}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left",
        selected ? "bg-raised" : "hover:bg-raised/50",
      )}
    >
      <MausAvatar
        color={bot.color}
        shape={bot.mascotShape}
        state={stateForBot(bot)}
        size={56}
        motion={mascotMotion?.kind ?? "none"}
        motionKey={mascotMotion?.nonce ?? 0}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5 truncate text-[15px] font-semibold text-ink">
            {bot.pinned && <Pin size={12} className="shrink-0 text-ink-secondary" />}
            <span className="truncate">{bot.name}</span>
          </span>
          {selected && last && (
            <span className="shrink-0 text-xs text-ink-secondary">
              {formatTime(last.at)}
            </span>
          )}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[13px] text-ink-secondary">
            {preview(bot)}
          </span>
          {/* multibot: needs-attention dot — same pattern as the unread dot below,
              warning color + reason tooltip; wins over unread (more urgent). */}
          {bot.needsAttention != null ? (
            <span
              title={bot.needsAttention}
              className="size-2 shrink-0 rounded-full bg-warning"
            />
          ) : (
            bot.unread && (
              <span className="size-2 shrink-0 rounded-full bg-accent" />
            )
          )}
        </div>
      </div>
    </button>
  );
}

// multibot: F9-FE — grupy w sidebarze: każdy bot ma trwałą reprezentację
// `mb-<threadId>` w transporcie grupowym, niezależnie od wybranego drivera.
function GroupsSection({
  bots,
  createOpen,
  onCreateOpenChange,
}: {
  bots: Bot[];
  createOpen: boolean;
  onCreateOpenChange: (open: boolean) => void;
}) {
  const { state, dispatch } = useStore();
  const polish = useLanguage() === "pl";
  // null = nie załadowano (silnik offline / jeszcze nie sprawdzono)
  const [groups, setGroups] = useState<EngineGroup[] | null>(null);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Jeden GET przy mount (wzorzec engineStatus) — zero pollingu; POST create
  // dopisuje do listy lokalnie.
  useEffect(() => {
    let alive = true;
    authFetch("/api/engine/groups")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((gs: EngineGroup[]) => alive && setGroups(gs))
      .catch(() => alive && setGroups([]));
    return () => {
      alive = false;
    };
  }, []);

  const toggle = (engineBotId: string) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(engineBotId)) next.delete(engineBotId);
      else next.add(engineBotId);
      return next;
    });

  const create = async () => {
    if (busy || !name.trim() || picked.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      // Shadowy silnika wstają leniwie — bez tego POST grupy odbiłby się 422.
      for (const bot of bots) {
        const engineBotId = `mb-${bot.threadId}`;
        if (!picked.has(engineBotId)) continue;
        const res = await authFetch("/api/engine/bots", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: engineBotId, name: bot.name }),
        });
        if (!res.ok && res.status !== 409) throw new Error(`HTTP ${res.status}`);
      }
      // Kolejność `bot_ids` = kolejność floty; pierwszy bot to owner pokoju
      // (engine groups.py: fallback routingu rundy).
      const bot_ids = bots.map((b) => `mb-${b.threadId}`).filter((id) => picked.has(id));
      const res = await authFetch("/api/engine/groups", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), bot_ids }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = typeof body.detail === "string" ? body.detail : undefined;
        throw new Error(detail ?? body.error ?? `${res.status} ${res.statusText}`);
      }
      const group = body as EngineGroup;
      setGroups((gs) => [...(gs ?? []), group]);
      onCreateOpenChange(false);
      setName("");
      setPicked(new Set());
      dispatch({ type: "toggleGroup", group });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-t border-hairline/40 px-2 pb-1 pt-2">
      <div className="flex items-center justify-between px-3 pb-1">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-secondary">
          {polish ? "Grupy" : "Groups"}
        </span>
      </div>

      {(groups ?? []).map((g) => (
        <button
          key={g.id}
          onClick={() => dispatch({ type: "toggleGroup", group: g })}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left",
            state.groupOpen?.id === g.id ? "bg-raised" : "hover:bg-raised/50",
          )}
        >
          <Users size={16} className="shrink-0 text-ink-secondary" />
          <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{g.name || g.id}</span>
          <span className="shrink-0 text-[12px] text-ink-secondary">{g.bot_ids.length}</span>
        </button>
      ))}

      {createOpen && (
        <div className="mx-1 mt-1 flex flex-col gap-2 rounded-xl bg-card p-3">
          <input
            className="w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none"
            placeholder={polish ? "Nazwa grupy" : "Group name"}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
            {bots.map((b) => {
              const engineBotId = `mb-${b.threadId}`;
              return (
                <label
                  key={b.id}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-0.5 text-[13px] text-ink hover:bg-raised/50"
                >
                  <input
                    type="checkbox"
                    checked={picked.has(engineBotId)}
                    onChange={() => toggle(engineBotId)}
                    className="accent-accent"
                  />
                  <span className="truncate">{b.name}</span>
                </label>
              );
            })}
          </div>
          {error && <div className="text-[12px] text-danger">{error}</div>}
          <div className="flex gap-2">
            <button
              onClick={() => void create()}
              disabled={busy || !name.trim() || picked.size === 0}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-raised py-1.5 text-[13px] text-ink hover:bg-raised-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy && <Loader2 size={12} className="animate-spin" />}
              {polish ? "Utwórz" : "Create"}
            </button>
            <button
              onClick={() => {
                onCreateOpenChange(false);
                setError(null);
              }}
              className="rounded-lg bg-raised px-3 py-1.5 text-[13px] text-ink-secondary hover:bg-raised-hover hover:text-ink"
            >
              {polish ? "Anuluj" : "Cancel"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  const { state, dispatch } = useStore();
  const polish = useLanguage() === "pl";
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [groupCreateOpen, setGroupCreateOpen] = useState(false);

  // multibot: F11 — wskaźnik TYLKO gdy silnik offline a jakiś bot jeździ na
  // slafy (dla reszty userów silnik nie istnieje — nic nie pokazujemy i nic
  // nie odpytujemy). Boty i instancje hydratują się async, więc efekt na
  // [hasLocalBot] odpala się raz, gdy flaga stanie się prawdą — to jest to
  // "jedno sprawdzenie przy mount aplikacji"; kolejne robi AppSettingsPanel
  // przy otwarciu. Zero pollingu.
  const hasLocalBot = state.bots.some(
    (b) =>
      state.instances.find((i) => i.instanceId === b.modelSelection.instanceId)?.driverKind ===
      "slafy",
  );
  const [engineOffline, setEngineOffline] = useState(false);
  useEffect(() => {
    if (!hasLocalBot) {
      setEngineOffline(false);
      return;
    }
    let alive = true;
    void engineOnline().then((ok) => alive && setEngineOffline(!ok));
    return () => {
      alive = false;
    };
  }, [hasLocalBot]);

  const visibleBots = state.bots
    .filter((b) => !b.hidden)
    .sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false));

  // multibot: F9-FE — kandydaci do grup: cała flota, także ukryci. Kolejność
  // stabilna z listy botów; wybrany driver nie usuwa bota z grup.
  const groupBots = state.bots;

  useEffect(() => {
    if (!addMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-add-menu]")) setAddMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setAddMenuOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [addMenuOpen]);

  return (
    <aside className="flex h-full w-[320px] shrink-0 flex-col border-r border-hairline/40 bg-panel">
      {/* Titlebar: real traffic lights in Electron, faux ones in the browser */}
      <div
        className="flex items-center justify-between px-4 pt-3.5 pb-1"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        {isElectron ? (
          <div className="w-14" />
        ) : (
          <div className="flex items-center gap-2">
            <span className="size-3 rounded-full bg-[#ff5f57]" />
            <span className="size-3 rounded-full bg-[#febc2e]" />
            <span className="size-3 rounded-full bg-[#28c840]" />
          </div>
        )}
        <div className="relative" data-add-menu>
          <button
            onClick={() => setAddMenuOpen((v) => !v)}
            className="rounded-md p-1 text-ink-secondary hover:bg-raised hover:text-ink"
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            title={polish ? "Dodaj bota albo grupę" : "Add bot or group"}
            aria-expanded={addMenuOpen}
          >
            <Plus size={20} strokeWidth={2} />
          </button>
          {addMenuOpen && (
            <div className="absolute right-0 top-8 z-30 w-44 rounded-xl border border-hairline/40 bg-card p-1.5 shadow-lg">
              <button
                onClick={() => {
                  track("bot_created");
                  setAddMenuOpen(false);
                  dispatch({ type: "newBot" });
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-ink hover:bg-raised"
              >
                <BotIcon size={15} className="text-ink-secondary" />
                {polish ? "Nowy bot" : "New bot"}
              </button>
              <button
                onClick={() => {
                  setAddMenuOpen(false);
                  setGroupCreateOpen(true);
                }}
                disabled={groupBots.length === 0}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-ink hover:bg-raised disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Users size={15} className="text-ink-secondary" />
                {polish ? "Nowa grupa" : "New group"}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="px-3 pt-2 pb-3">
        <div className="flex items-center gap-2 rounded-lg bg-raised/70 px-3 py-2">
          <Search size={16} className="text-ink-secondary" />
          <input
            placeholder={polish ? "Szukaj" : "Search"}
            className="w-full bg-transparent text-[14px] text-ink placeholder:text-ink-secondary focus:outline-none"
          />
        </div>
      </div>

      {/* Bot list */}
      <div className="flex-1 overflow-y-auto px-2">
        <div className="flex flex-col gap-0.5">
          {visibleBots.map((b) => (
            <BotListItem key={b.id} bot={b} onMenu={setMenu} />
          ))}
        </div>
      </div>

      {/* multibot: F9-FE — grupy dostępne dla całej floty */}
      {groupBots.length > 0 && (
        <GroupsSection
          bots={groupBots}
          createOpen={groupCreateOpen}
          onCreateOpenChange={setGroupCreateOpen}
        />
      )}

      {/* Footer */}
      <div className="px-3 pb-3 pt-2">
        {/* multibot: F11 — subtelna kropka statusu silnika, tylko offline+slafy;
            szara bg-raised-hover = konwencja "Service offline" */}
        {engineOffline && (
          <div
            title="Local service offline — custom-model bots can't run. Check App Settings."
            className="flex items-center gap-2 px-3 py-1.5 text-[12px] text-ink-secondary"
          >
            <span className="size-1.5 shrink-0 rounded-full bg-raised-hover" />
            Service offline
          </div>
        )}
        <button
          onClick={() => dispatch({ type: "togglePlugins", open: true })}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-raised/50"
        >
          <Puzzle size={20} className="text-ink-secondary" />
            <span className="text-[14px] text-ink">{polish ? "Wtyczki" : "Plugins"}</span>
        </button>
        <div className="flex items-center">
          <button
            onClick={() => dispatch({ type: "toggleAppSettings" })}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-raised/50"
          >
            <InitialsAvatar initials={profileInitials(state.config?.profile)} size={28} />
            <span className="truncate text-[14px] text-ink">
              {state.config?.profile?.name?.trim() || state.config?.profile?.email?.trim() || "You"}
            </span>
          </button>
          <button
            onClick={() => dispatch({ type: "toggleAppSettings" })}
            className="rounded-md p-2 text-ink-secondary hover:bg-raised hover:text-ink"
            title={polish ? "Ustawienia aplikacji" : "App settings"}
          >
            <Settings size={18} />
          </button>
        </div>
      </div>

      {menu && <BotContextMenu menu={menu} onClose={() => setMenu(null)} />}
    </aside>
  );
}
