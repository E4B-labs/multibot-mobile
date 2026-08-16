import { track } from "@/lib/analytics";
import { useEffect, useRef, useState } from "react";
import {
  BellDot,
  Bot as BotIcon,
  ClipboardCopy,
  Copy,
  EyeOff,
  FolderPlus,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Puzzle,
  Search,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import { useStore, formatTime, type Bot } from "@/state/store";
import { MausAvatar, InitialsAvatar } from "./Avatar";
import { stateForBot } from "@/lib/mascot";
import { cn } from "@/lib/cn";
// multibot: B4 — wspólny język (inspiracje.png): paleta wyszukiwania
import { SearchPalette, type SearchTab } from "./SearchPalette";
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

// multibot: awatar bota przywrócony do oryginalnego MausAvatar (kształt +
// wyraz z poprzedniego drawera), zamiast uproszczonej blob-twarzy.
function BotRow({ bot, onMenu }: { bot: Bot; onMenu: (menu: MenuState) => void }) {
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
        "flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left",
        selected ? "bg-white/[0.07]" : "hover:bg-white/[0.04]",
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
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <span className="truncate text-[13px] text-ink-secondary">{preview(bot)}</span>
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

export function Sidebar() {
  const { state, dispatch } = useStore();
  const polish = useLanguage() === "pl";
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
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

  useEffect(() => {
    if (!userMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-user-menu]")) setUserMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setUserMenuOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [userMenuOpen]);

  return (
    <aside className="fixed inset-0 z-[60] bg-black md:static md:z-auto md:flex md:w-[320px] md:shrink-0 md:border-r md:border-hairline/40">
      {/* Główna karta ekranu: prawie czarna, zaokrąglona jak ramka telefonu. */}
      <div className="relative mx-2 my-2 flex h-[calc(100%-1rem)] w-[calc(100%-1rem)] flex-col overflow-hidden rounded-[28px] bg-black shadow-2xl shadow-black/60 md:mx-0 md:my-0 md:h-full md:w-full md:rounded-none">
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
          {/* Avatar użytkownika — rozwija menu Ustawienia + Wtyczki */}
          <div className="relative" data-user-menu>
            <button
              onClick={() => setUserMenuOpen((v) => !v)}
              className="shrink-0 rounded-full"
              aria-label={polish ? "Menu użytkownika" : "User menu"}
              aria-expanded={userMenuOpen}
            >
              <InitialsAvatar initials={profileInitials(state.config?.profile) || "R"} size={36} />
            </button>
            {userMenuOpen && (
              <div className="absolute left-0 top-11 z-30 w-44 rounded-xl border border-white/10 bg-card p-1.5 shadow-lg">
                <button
                  onClick={() => {
                    setUserMenuOpen(false);
                    document.body.classList.remove("mb-drawer-open");
                    dispatch({ type: "togglePlugins", open: true });
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-ink hover:bg-white/10"
                >
                  <Puzzle size={15} className="text-ink-secondary" />
                  {polish ? "Wtyczki" : "Plugins"}
                </button>
                <button
                  onClick={() => {
                    setUserMenuOpen(false);
                    document.body.classList.remove("mb-drawer-open");
                    dispatch({ type: "toggleAppSettings" });
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-ink hover:bg-white/10"
                >
                  <Settings size={15} className="text-ink-secondary" />
                  {polish ? "Ustawienia" : "Settings"}
                </button>
              </div>
            )}
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

        {/* Unified conversation list */}
        <div className="flex-1 overflow-y-auto px-2">
          <div className="flex flex-col gap-0.5">
            {filteredBots.map((b) => (
              <BotRow key={b.id} bot={b} onMenu={setMenu} />
            ))}
          </div>
        </div>

        {/* Footer — status (menu Ustawienia/Wtyczki przeniesione pod avatar) */}
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
        </div>

        {menu && <BotContextMenu menu={menu} onClose={() => setMenu(null)} />}
      </div>
    </aside>
  );
}
