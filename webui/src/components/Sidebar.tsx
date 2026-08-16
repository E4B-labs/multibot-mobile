import { track } from "@/lib/analytics";
import { useEffect, useRef, useState } from "react";
import {
  BellDot,
  Bot as BotIcon,
  ClipboardCopy,
  Copy,
  EyeOff,
  FolderPlus,
  Loader2,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Puzzle,
  Search,
  Settings,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useStore, formatTime, type Bot, type EngineGroup } from "@/state/store";
import { MausAvatar, InitialsAvatar } from "./Avatar";
import { stateForBot } from "@/lib/mascot";
import { MAUS_COLORS } from "@/lib/mascot";
import { cn } from "@/lib/cn";
// multibot: B4 — wspólny język (inspiracje.png): paleta wyszukiwania
import { SearchPalette, type SearchTab } from "./SearchPalette";
import { authFetch } from "@/lib/auth";
// multibot: F11 — status silnika dla warunkowej kropki w stopce
import { engineOnline } from "@/lib/engineStatus";
import { useLanguage } from "@/lib/language";

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
  return email ? email[0]!.toUpperCase() : "R";
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

interface GroupMenuState {
  group: EngineGroup;
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

function GroupContextMenu({ menu, onClose }: { menu: GroupMenuState; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const polish = useLanguage() === "pl";
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-group-menu]")) onClose();
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

  const remove = async () => {
    if (busy || !window.confirm(polish ? `Usunąć grupę „${menu.group.name || menu.group.id}”?` : `Delete “${menu.group.name || menu.group.id}”?`)) return;
    setBusy(true);
    try {
      const res = await authFetch(`/api/groups/${encodeURIComponent(menu.group.id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      if (state.groupOpen?.id === menu.group.id) dispatch({ type: "toggleGroup", group: null });
      dispatch({ type: "workspaceChanged", botId: "", resource: "groups" });
      onClose();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
      setBusy(false);
    }
  };

  const top = Math.min(menu.y, window.innerHeight - 90);
  const left = Math.min(menu.x, window.innerWidth - 220);
  return (
    <div
      data-group-menu
      style={{ top, left }}
      className="fixed z-40 w-[208px] overflow-hidden rounded-xl border border-hairline/50 bg-card py-1.5 shadow-2xl shadow-black/60"
    >
      <button
        onClick={() => void remove()}
        disabled={busy}
        className="flex w-full items-center gap-3 px-3.5 py-2 text-left text-[14px] text-danger hover:bg-danger/10 disabled:cursor-default disabled:opacity-50"
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
        {polish ? "Usuń grupę" : "Delete group"}
      </button>
    </div>
  );
}

// multibot: minimalistyczna "blob-twarz" rysowana białą kreską na kolorowym
// tle awatara (inspiracja: kwadratowy avatar z uśmiechniętą mordką).
function BlobFace({ expression }: { expression?: string | null }) {
  const ex = (expression ?? "happy").toLowerCase();
  let mouth = "M9 18 Q16 25 23 18"; // uśmiech
  if (ex.includes("sad") || ex.includes("frown")) mouth = "M9 22 Q16 17 23 22";
  else if (ex.includes("think") || ex.includes("sleep") || ex.includes("neutral")) mouth = "M11 20 H21";
  else if (ex.includes("surpris") || ex.includes("shock")) mouth = "M14 18 a2.2 2.2 0 1 0 4 0 a2.2 2.2 0 1 0 -4 0";
  return (
    <svg viewBox="0 0 32 32" className="size-1/2" fill="none" aria-hidden>
      <circle cx="11" cy="13" r="1.7" fill="white" />
      <circle cx="21" cy="13" r="1.7" fill="white" />
      <path d={mouth} stroke="white" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

function BotRow({ bot, onMenu }: { bot: Bot; onMenu: (menu: MenuState) => void }) {
  const { state, dispatch } = useStore();
  const selected = state.selectedId === bot.id;
  const last = bot.messages[bot.messages.length - 1];
  return (
    <button
      onClick={() => dispatch({ type: "select", id: bot.id })}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu({ botId: bot.id, x: e.clientX, y: e.clientY });
      }}
      className={cn(
        "flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left",
        selected ? "bg-white/[0.07]" : "hover:bg-white/[0.04]",
      )}
    >
      <div className="relative shrink-0">
        <div
          className="flex size-12 items-center justify-center rounded-[14px]"
          style={{ backgroundColor: MAUS_COLORS[bot.color] ?? "#8a8a8f" }}
        >
          <BlobFace expression={stateForBot(bot)} />
        </div>
        {/* zielona kropka "online" — adaptacja: pokazujemy przy nieprzeczytanych */}
        {bot.unread && (
          <span className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full bg-green-500 ring-2 ring-[#0d0d0f]" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[15px] font-semibold text-ink">{bot.name}</span>
            {bot.description && (
              <span className="max-w-[120px] shrink-0 truncate rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-ink-secondary">
                {bot.description}
              </span>
            )}
          </div>
          {last && (
            <span className="shrink-0 text-[11px] text-ink-secondary">{formatTime(last.at)}</span>
          )}
        </div>
        <div className="mt-0.5 truncate text-[13px] text-ink-secondary">{preview(bot)}</div>
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
  onMenu,
}: {
  bots: Bot[];
  createOpen: boolean;
  onCreateOpenChange: (open: boolean) => void;
  onMenu: (menu: GroupMenuState) => void;
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
    authFetch("/api/groups")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((gs: EngineGroup[]) => alive && setGroups(gs))
      .catch(() => alive && setGroups([]));
    return () => {
      alive = false;
    };
  }, [state.workspaceVersion]);

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
      const bot_ids = bots.map((b) => `mb-${b.threadId}`).filter((id) => picked.has(id));
      const res = await authFetch("/api/groups", {
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
    <div className="border-b border-white/5 px-2 pb-2 pt-1">
      {(groups ?? []).map((g) => (
        <button
          key={g.id}
          onClick={() => dispatch({ type: "toggleGroup", group: g })}
          onContextMenu={(e) => {
            e.preventDefault();
            onMenu({ group: g, x: e.clientX, y: e.clientY });
          }}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left",
            state.groupOpen?.id === g.id ? "bg-white/[0.07]" : "hover:bg-white/[0.04]",
          )}
        >
          <span className="flex -space-x-2 shrink-0">
            {g.bot_ids.slice(0, 3).map((engineId) => {
              const member = bots.find((b) => `mb-${b.threadId}` === engineId);
              return member ? <MausAvatar key={engineId} color={member.color} shape={member.mascotShape} state={stateForBot(member)} size={24} animated={false} /> : <Users key={engineId} size={18} className="text-ink-secondary" />;
            })}
          </span>
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
  const [groupMenu, setGroupMenu] = useState<GroupMenuState | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [groupCreateOpen, setGroupCreateOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<SearchTab>("All");
  const searchInputRef = useRef<HTMLInputElement>(null);

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

  // multibot: B4 — filtrowanie listy po zapytaniu z palety wyszukiwania
  const q = query.trim().toLowerCase();
  const filteredBots = q
    ? visibleBots.filter(
        (b) =>
          b.name.toLowerCase().includes(q) ||
          b.description.toLowerCase().includes(q),
      )
    : visibleBots;

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
    <aside className="fixed inset-0 z-[60] bg-black/40 md:static md:z-auto md:flex md:w-[320px] md:shrink-0 md:border-r md:border-hairline/40">
      {/* Rozmyte, kolorowe tło (bokeh) — tylko mobile; widać je lekko na
          krawędziach ekranu wokół karty. */}
      <div className="absolute inset-0 overflow-hidden md:hidden" aria-hidden>
        <div className="absolute -left-20 -top-24 size-72 rounded-full bg-orange-500/45 blur-3xl" />
        <div className="absolute -right-16 top-1/4 size-80 rounded-full bg-fuchsia-600/35 blur-3xl" />
        <div className="absolute -bottom-24 left-8 size-80 rounded-full bg-sky-500/35 blur-3xl" />
        <div className="absolute bottom-12 right-0 size-64 rounded-full bg-emerald-500/25 blur-3xl" />
      </div>

      {/* Główna karta ekranu: prawie czarna, zaokrąglona jak ramka telefonu. */}
      <div className="relative mx-2 my-2 flex h-[calc(100%-1rem)] w-[calc(100%-1rem)] flex-col overflow-hidden rounded-[28px] bg-[#0d0d0f] shadow-2xl shadow-black/60 md:mx-0 md:my-0 md:h-full md:w-full md:rounded-none">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 pb-2 pt-3.5">
          {/* X zamyka drawer (tylko mobile) */}
          <button
            onClick={() => document.body.classList.remove("mb-drawer-open")}
            className="rounded-md p-1 text-ink-secondary hover:bg-white/10 hover:text-ink md:hidden"
            aria-label={polish ? "Zamknij menu" : "Close menu"}
          >
            <X size={20} />
          </button>
          {/* Avatar użytkownika */}
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-blue-500 text-[14px] font-semibold text-white">
            {profileInitials(state.config?.profile) || "R"}
          </div>
          <div className="flex-1" />
          {/* Szukaj */}
          <button
            onClick={() => searchInputRef.current?.focus()}
            className="rounded-md p-2 text-ink-secondary hover:bg-white/10 hover:text-ink"
            aria-label={polish ? "Szukaj" : "Search"}
          >
            <Search size={20} />
          </button>
          {/* Dodaj */}
          <div className="relative" data-add-menu>
            <button
              onClick={() => setAddMenuOpen((v) => !v)}
              className="rounded-md p-2 text-ink-secondary hover:bg-white/10 hover:text-ink"
              aria-label={polish ? "Dodaj bota albo grupę" : "Add bot or group"}
              aria-expanded={addMenuOpen}
            >
              <Plus size={20} strokeWidth={2} />
            </button>
            {addMenuOpen && (
              <div className="absolute right-0 top-10 z-30 w-44 rounded-xl border border-white/10 bg-card p-1.5 shadow-lg">
                <button
                  onClick={() => {
                    track("bot_created");
                    setAddMenuOpen(false);
                    dispatch({ type: "newBot" });
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-ink hover:bg-white/10"
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
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-ink hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Users size={15} className="text-ink-secondary" />
                  {polish ? "Nowa grupa" : "New group"}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Search — B4: paleta wyszukiwania (inspiracje.png) */}
        <div className="px-4 pb-2">
          <SearchPalette
            query={query}
            onQueryChange={setQuery}
            activeTab={tab}
            onTabChange={setTab}
            inputRef={searchInputRef}
          />
        </div>

        {/* Unified conversation list: group rows sit with bots, above plugins. */}
        <div className="flex-1 overflow-y-auto px-2">
          {groupBots.length > 0 && (
            <GroupsSection
              bots={groupBots}
              createOpen={groupCreateOpen}
              onCreateOpenChange={setGroupCreateOpen}
              onMenu={setGroupMenu}
            />
          )}
          <div className="flex flex-col gap-0.5">
            {filteredBots.map((b) => (
              <BotRow key={b.id} bot={b} onMenu={setMenu} />
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="px-3 pb-3 pt-2">
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
            onClick={() => {
              document.body.classList.remove("mb-drawer-open");
              dispatch({ type: "togglePlugins", open: true });
            }}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-white/[0.06]"
          >
            <Puzzle size={20} className="text-ink-secondary" />
            <span className="text-[14px] text-ink">{polish ? "Wtyczki" : "Plugins"}</span>
          </button>
          <div className="flex items-center">
            <button
              onClick={() => {
                document.body.classList.remove("mb-drawer-open");
                dispatch({ type: "toggleAppSettings" });
              }}
              className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-white/[0.06]"
            >
              <InitialsAvatar initials={profileInitials(state.config?.profile)} size={28} />
              <span className="truncate text-[14px] text-ink">
                {state.config?.profile?.name?.trim() || state.config?.profile?.email?.trim() || "You"}
              </span>
            </button>
            <button
              onClick={() => {
                document.body.classList.remove("mb-drawer-open");
                dispatch({ type: "toggleAppSettings" });
              }}
              className="rounded-md p-2 text-ink-secondary hover:bg-white/10 hover:text-ink"
              title={polish ? "Ustawienia aplikacji" : "App settings"}
            >
              <Settings size={18} />
            </button>
          </div>
        </div>

        {menu && <BotContextMenu menu={menu} onClose={() => setMenu(null)} />}
        {groupMenu && <GroupContextMenu menu={groupMenu} onClose={() => setGroupMenu(null)} />}
      </div>
    </aside>
  );
}
