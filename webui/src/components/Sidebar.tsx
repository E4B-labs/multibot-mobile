import { track } from "@/lib/analytics";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  BellDot,
  Bot as BotIcon,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  Copy,
  Crown,
  Eye,
  EyeOff,
  FolderPlus,
  Loader2,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Plug,
  Search,
  Settings,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useStore, formatTime, type Bot, type EngineGroup } from "@/state/store";
import { MausAvatar } from "./Avatar";
import { ScoutTeamModal } from "./ScoutTeamModal";
import { busyMascotMotion, type MausMotion, type MausState } from "@/lib/mascot";
import { cn } from "@/lib/cn";
// multibot: B4 — wspólny język (inspiracje.png): paleta wyszukiwania
import { SearchPalette, type SearchTab } from "./SearchPalette";
// multibot: F11 — status silnika dla warunkowej kropki w stopce
import { engineOnline } from "@/lib/engineStatus";
import { useLanguage } from "@/lib/language";
import { botDisplayName } from "@/lib/botNames";
import { authFetch } from "@/lib/auth";
import { canCreateGroup, engineBotId } from "@/lib/groups";
import { groupAvatarSplit, groupRowTitle } from "@/lib/groupRow";

/** Full name → initials, email → first letter, unset → "?". */
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

/**
 * Awatar w wierszu bota w szufladzie: bot, ktory nie pracuje, stoi calkiem
 * nieruchomo (neutralny stan "idle", zero beatow, `animated:false` -> `paused`
 * w CursorAvatar). Animacja tylko na czas `busy`.
 */
export function sidebarAvatarProps(
  bot: Bot,
): { state: MausState; motion: MausMotion; animated: boolean; motionKey: number } {
  if (!bot.busy) return { state: "idle", motion: "none", animated: false, motionKey: 0 };
  const busy = busyMascotMotion(bot.id);
  return { state: busy.state, motion: busy.motion, animated: true, motionKey: 1 };
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

export function hiddenBotsForSidebar(bots: Bot[]): Bot[] {
  return bots.filter((bot) => bot.hidden === true);
}

interface MenuState {
  botId: string;
  x: number;
  y: number;
}

function BotContextMenu({
  menu,
  onClose,
  onMoveToSection,
}: {
  menu: MenuState;
  onClose: () => void;
  onMoveToSection: (botId: string) => void;
}) {
  const { state, dispatch } = useStore();
  const polish = useLanguage() === "pl";
  const bot = state.bots.find((b) => b.id === menu.botId);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      // Prawy przycisk (na telefonie: długie przytrzymanie) otwiera to menu
      // zdarzeniem `contextmenu`, które przeglądarka wysyła PO `mousedown`
      // tego samego gestu. Zamykanie na `mousedown` sprawiało więc, że drugie
      // przytrzymanie tego samego wiersza najpierw zamykało menu, a ułamek
      // milisekundy później `contextmenu` otwierało je z powrotem — z zewnątrz
      // wyglądało to tak, jakby menu w ogóle nie dało się zamknąć i trzeba
      // było kliknąć jeszcze raz, gdzie indziej. O prawym przycisku decyduje
      // wyłącznie `contextmenu` (patrz przełącznik w `Sidebar`).
      if (e.button === 2) return;
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

  // Menu jedzie przez portal do <body> i na warstwę `z-[90]` — tę samą, której
  // używają SettingsPanel i ComputerPanel, żeby stanąć nad drawerem (`z-[60]`).
  // Renderowane w miejscu siedziało wewnątrz drawera, który na telefonie ma
  // `transform`, więc tworzy własny kontekst nakładania: `z-40` liczyło się
  // tylko wewnątrz szuflady, a `position: fixed` liczyło współrzędne względem
  // niej (czyli z przesunięciem o jej safe-area), a nie względem ekranu.
  return createPortal(
    <div
      data-bot-menu
      style={{ top, left }}
      className="fixed z-[90] w-[228px] select-none overflow-hidden rounded-xl border border-hairline/50 bg-card py-1.5 shadow-2xl shadow-black/60"
    >
      {[
        item(
          bot.pinned ? <PinOff size={16} className="text-ink-secondary" /> : <Pin size={16} className="text-ink-secondary" />,
          bot.pinned ? "Unpin" : "Pin",
          () => dispatch({ type: "updateBot", botId: bot.id, patch: { pinned: !bot.pinned } }),
        ),
        item(
          <FolderPlus size={16} className="text-ink-secondary" />,
          bot.section ? polish ? "Zmień sekcję" : "Change section" : polish ? "Przenieś do sekcji" : "Move to section",
          () => onMoveToSection(bot.id),
        ),
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
        item(
          bot.hidden ? <Eye size={16} className="text-ink-secondary" /> : <EyeOff size={16} className="text-ink-secondary" />,
          bot.hidden ? "Show in sidebar" : "Hide from sidebar",
          () => dispatch({ type: "updateBot", botId: bot.id, patch: { hidden: !bot.hidden } }),
        ),
        item(<Trash2 size={16} />, "Delete", () => dispatch({ type: "deleteBot", botId: bot.id }), {
          danger: true,
        }),
      ]}
    </div>,
    document.body,
  );
}

// Desktopowe sekcje botów zachowują się na telefonie jak lekkie nagłówki listy:
// tap zwija/rozwija sekcję, bez dokładania kolejnego poziomu nawigacji.
function SectionDivider({
  name,
  collapsed,
  onToggle,
  polish,
}: {
  name: string;
  collapsed: boolean;
  onToggle: () => void;
  polish: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      aria-label={collapsed ? polish ? `Rozwiń sekcję ${name}` : `Expand section ${name}` : polish ? `Zwiń sekcję ${name}` : `Collapse section ${name}`}
      title={collapsed ? polish ? "Rozwiń sekcję" : "Expand section" : polish ? "Zwiń sekcję" : "Collapse section"}
      className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 pb-1 pt-3 text-left text-ink-secondary hover:bg-white/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
    >
      {collapsed ? <ChevronRight size={14} className="shrink-0" /> : <ChevronDown size={14} className="shrink-0" />}
      <span className="truncate text-[11px] font-semibold uppercase tracking-[0.08em]">{name}</span>
      <span className="h-px flex-1 bg-white/10" />
    </button>
  );
}

/** Mobile popover for assigning a bot to an existing or new section. */
function SectionPicker({
  botId,
  anchor,
  onClose,
}: {
  botId: string;
  anchor: { x: number; y: number };
  onClose: () => void;
}) {
  const { state, dispatch } = useStore();
  const polish = useLanguage() === "pl";
  const [draft, setDraft] = useState("");
  const bot = state.bots.find((item) => item.id === botId);

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (event.button === 2) return;
      if (!(event.target as HTMLElement).closest("[data-section-picker]")) onClose();
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
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
  const top = Math.max(8, Math.min(anchor.y, window.innerHeight - 300));
  const left = Math.max(8, Math.min(anchor.x, window.innerWidth - 244));
  const names = [...new Set(state.bots.map((item) => item.section?.trim()).filter((value): value is string => Boolean(value)))];
  const assign = (section: string | null) => {
    dispatch({ type: "updateBot", botId, patch: { section } });
    onClose();
  };

  return createPortal(
    <div
      data-section-picker
      style={{ top, left }}
      className="fixed z-[90] max-h-[min(300px,calc(100vh-16px))] w-[236px] overflow-y-auto rounded-xl border border-hairline/50 bg-card p-1.5 shadow-2xl shadow-black/60"
    >
      <div className="px-2 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-secondary">
        {polish ? "Sekcje" : "Sections"}
      </div>
      {names.length > 0 && (
        <div className="flex flex-wrap gap-1 px-1 pb-1">
          {names.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => assign(name)}
              className={cn(
                "rounded-full border border-hairline/50 px-2 py-1 text-[12px]",
                bot.section === name ? "bg-accent text-white" : "text-ink hover:bg-raised",
              )}
            >
              {name}
            </button>
          ))}
        </div>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const name = draft.trim().slice(0, 60);
          if (name) assign(name);
        }}
        className="flex gap-1 px-1 py-1"
      >
        <input
          autoFocus
          value={draft}
          maxLength={60}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={polish ? "Nowa sekcja…" : "New section…"}
          className="min-w-0 flex-1 rounded-lg bg-inset px-2 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-secondary/60"
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          aria-label={polish ? "Dodaj do sekcji" : "Add to section"}
          className="shrink-0 rounded-lg bg-raised px-2.5 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-40"
        >
          ✓
        </button>
      </form>
      {bot.section && (
        <button
          type="button"
          onClick={() => assign(null)}
          className="mt-0.5 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-danger hover:bg-raised/70"
        >
          <FolderPlus size={14} className="rotate-180" />
          {polish ? "Usuń z sekcji" : "Remove from section"}
        </button>
      )}
    </div>,
    document.body,
  );
}

// multibot: awatar bota przywrócony do oryginalnego MausAvatar (kształt +
// wyraz z poprzedniego drawera), zamiast uproszczonej blob-twarzy.
function BotRow({ bot, onMenu }: { bot: Bot; onMenu: (menu: MenuState) => void }) {
  const { state, dispatch } = useStore();
  const selected = state.selectedId === bot.id;
  const avatar = sidebarAvatarProps(bot);
  const lang = useLanguage();
  const last = bot.messages[bot.messages.length - 1];
  return (
    <button
      onClick={() => {
        dispatch({ type: "select", id: bot.id });
        // Wybór bota zamyka drawer i pokazuje jego czat — to jedyne wyjście
        // z panelu, odkąd nie ma już przycisku X w nagłówku.
        document.body.classList.remove("mb-drawer-open");
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu({ botId: bot.id, x: e.clientX, y: e.clientY });
      }}
      style={{ WebkitTouchCallout: "none" }}
      className={cn(
        // Szuflada ma 8 px wcięcia od lewej (styles.css), więc podświetlenie nie
        // dotyka krawędzi i zaokrąglenie z obu stron ma sens; `pl-2` daje
        // awatarowi oddech od łuku.
        "flex w-full select-none items-center gap-3 rounded-2xl pl-2 pr-3 py-3 text-left",
        selected ? "bg-white/[0.07]" : "hover:bg-white/[0.04]",
      )}
    >
      <MausAvatar
        color={bot.color} avatarUrl={bot.avatarUrl}
        shape={bot.mascotShape}
        state={avatar.state}
        size={56}
        motion={avatar.motion}
        motionKey={avatar.motionKey}
        animated={avatar.animated}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            {bot.chiefOfStaff && <Crown size={12} className="shrink-0 text-accent" aria-label="Section chief" />}
            <span className="truncate text-[15px] font-semibold text-ink">{botDisplayName(bot, lang)}</span>
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

function HiddenBotRow({ bot, onMenu }: { bot: Bot; onMenu: (menu: MenuState) => void }) {
  const { dispatch } = useStore();
  const lang = useLanguage();
  return (
    <div className="flex items-center gap-1 rounded-2xl px-1 py-1 hover:bg-white/[0.04]">
      <button
        type="button"
        onClick={() => {
          dispatch({ type: "select", id: bot.id });
          document.body.classList.remove("mb-drawer-open");
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          onMenu({ botId: bot.id, x: e.clientX, y: e.clientY });
        }}
        style={{ WebkitTouchCallout: "none" }}
        className="flex min-w-0 flex-1 select-none items-center gap-3 py-2 pl-2 text-left"
      >
        <MausAvatar
          color={bot.color}
          avatarUrl={bot.avatarUrl}
          shape={bot.mascotShape}
          size={40}
          {...sidebarAvatarProps(bot)}
        />
        <span className="min-w-0 truncate text-[14px] text-ink">{botDisplayName(bot, lang)}</span>
      </button>
      <button
        type="button"
        onClick={() => dispatch({ type: "updateBot", botId: bot.id, patch: { hidden: false } })}
        aria-label={`Show ${botDisplayName(bot, lang)} in sidebar`}
        title="Show again"
        className="shrink-0 rounded-lg p-2 text-ink-secondary hover:bg-white/10 hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
      >
        <Eye size={16} />
      </button>
    </div>
  );
}

interface GroupMenuState {
  group: EngineGroup;
  x: number;
  y: number;
}

// multibot: F9-FE — menu grupy, ten sam mechanizm co `BotContextMenu`: długie
// przytrzymanie wiersza (na telefonie przeglądarka wysyła wtedy `contextmenu`),
// portal do <body> i warstwa `z-[90]` nad szufladą.
//
// Potwierdzenie jest DWUSTOPNIOWE, wprost w menu, a nie przez `window.confirm`
// jak na komputerze. Android WebView nie pokazuje natywnych okienek JS, dopóki
// skorupa nie podepnie `onJsConfirm` — a `src/screens/WebViewScreen.tsx` tego
// nie robi. `confirm()` zwróciłby po cichu `false` i „Usuń grupę" byłoby
// przyciskiem, który nic nie robi.
function GroupContextMenu({ menu, onClose }: { menu: GroupMenuState; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const polish = useLanguage() === "pl";
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      // Tak samo jak w menu bota: prawy przycisk (długie przytrzymanie) sam
      // otwiera to menu zdarzeniem `contextmenu` wysłanym PO `mousedown`, więc
      // zamykanie na `mousedown` kasowałoby menu w tym samym geście.
      if (e.button === 2) return;
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
    if (busy) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch(`/api/groups/${encodeURIComponent(menu.group.id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as Record<string, unknown>);
        const detail = typeof body.detail === "string" ? body.detail : undefined;
        const short = typeof body.error === "string" ? body.error : undefined;
        throw new Error(detail ?? short ?? `${res.status} ${res.statusText}`);
      }
      // Otwarty pokój usuniętej grupy trzeba zamknąć ręcznie — sam nie zniknie,
      // bo `App.tsx` rysuje go z `state.groupOpen`, a nie z listy z serwera.
      if (state.groupOpen?.id === menu.group.id) dispatch({ type: "toggleGroup", group: null });
      dispatch({ type: "workspaceChanged", botId: "", resource: "groups" });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
      setConfirming(false);
    }
  };

  const top = Math.min(menu.y, window.innerHeight - 140);
  const left = Math.min(menu.x, window.innerWidth - 240);

  return createPortal(
    <div
      data-group-menu
      style={{ top, left }}
      className="fixed z-[90] w-[228px] select-none overflow-hidden rounded-xl border border-hairline/50 bg-card py-1.5 shadow-2xl shadow-black/60"
    >
      <button
        onClick={() => void remove()}
        disabled={busy}
        className="flex min-h-11 w-full items-center gap-3 px-3.5 py-2 text-left text-[14px] text-danger hover:bg-danger/10 disabled:cursor-default disabled:opacity-50"
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
        {confirming
          ? polish
            ? "Na pewno usunąć?"
            : "Really delete?"
          : polish
            ? "Usuń grupę"
            : "Delete group"}
      </button>
      {error && <div className="px-3.5 pb-1.5 text-[12px] text-danger">{error}</div>}
    </div>,
    document.body,
  );
}

// Wiersz grupy trzyma styl `BotRow` (`rounded-2xl pl-2 pr-3`, 8 px wcięcia
// szuflady z `styles.css`), a nie wspólnego `ListRow` — `ListRow` ma własną
// ramkę i tło karty, więc obok listy botów wyglądałby jak wtręt z innego
// ekranu, a do tego nie przyjmuje `onContextMenu`, na którym stoi tu menu.
function GroupRow({
  group,
  bots,
  onMenu,
}: {
  group: EngineGroup;
  bots: Bot[];
  onMenu: (menu: GroupMenuState) => void;
}) {
  const { state, dispatch } = useStore();
  const polish = useLanguage() === "pl";
  const members = group.bot_ids
    .map((id) => bots.find((b) => engineBotId(b.threadId) === id))
    .filter((b): b is Bot => b != null);
  const selected = state.groupOpen?.id === group.id;
  const { shown, overflow } = groupAvatarSplit(members, 2, group.bot_ids.length);
  // Czas ostatniej wiadomości bierzemy z wątku grupy, jeśli serwer go dosłał —
  // gdy grupa przyszła bez wiadomości, po prawej nie ma nic (żadnej liczby).
  const lastAt = group.messages?.[group.messages.length - 1]?.at;
  // Ten sam sygnał, co kropka przy bocie: `needsAttention` dowolnego członka.
  const attention = members.find((b) => b.needsAttention != null)?.needsAttention;

  return (
    <button
      onClick={() => {
        dispatch({ type: "toggleGroup", group });
        // To samo wyjście z szuflady co przy wyborze bota — na telefonie
        // drawer zakrywa cały ekran i bez tego pokój otworzyłby się pod nim.
        document.body.classList.remove("mb-drawer-open");
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu({ group, x: e.clientX, y: e.clientY });
      }}
      style={{ WebkitTouchCallout: "none" }}
      className={cn(
        "flex w-full select-none items-center gap-3 rounded-2xl py-3 pl-2 pr-3 text-left",
        selected ? "bg-white/[0.07]" : "hover:bg-white/[0.04]",
      )}
    >
      {/* Skład grupy zamiast jednej szarej ikony: nachodzące na siebie
          awatary botów (wzorem Groka) mówią od razu, kto w grupie siedzi.
          Bez pierścienia-oddzielnika: czarna obwódka znika na tle drawera,
          ale na podświetleniu zaznaczonego wiersza wychodziła jako ciemny
          okrąg. Przy botach nieznanych aplikacji zostaje dawne koło, żeby
          wiersz nie był pusty. Widoczni są najwyżej dwaj członkowie, reszta
          idzie na plakietkę `+N` w prawym dolnym rogu stosu. */}
      {members.length > 0 ? (
        <span className="relative flex shrink-0 items-center">
          {shown.map((b, i) => (
            <span key={b.id} className={cn("shrink-0", i > 0 && "-ml-3")}>
              <MausAvatar
                color={b.color} avatarUrl={b.avatarUrl}
                shape={b.mascotShape}
                size={40}
                {...sidebarAvatarProps(b)}
              />
            </span>
          ))}
          {overflow > 0 && (
            <span className="absolute -bottom-0.5 -right-1 flex min-w-4 items-center justify-center rounded-full bg-control px-1 text-[10px] font-semibold text-ink">
              +{overflow}
            </span>
          )}
          {attention && (
            <span
              title={attention}
              className="absolute -right-1 -top-0.5 flex items-center justify-center rounded-full bg-app text-warning"
            >
              <AlertTriangle size={12} />
            </span>
          )}
        </span>
      ) : (
        <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-white/10 text-ink-secondary">
          <Users size={24} />
        </span>
      )}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {/* Wzorem Groka tytułem wiersza jest skład, nie nazwa grupy — nazwa
            zostaje w `title=` oraz tam, gdzie i była: w menu i w nagłówku
            pokoju. Gdy żaden członek nie jest tej aplikacji znany, zostaje
            nazwa, żeby wiersz nie był pusty. */}
        <span
          title={group.name || group.id}
          className="block min-w-0 flex-1 truncate text-[15px] font-semibold text-ink"
        >
          {groupRowTitle(members.map((b) => botDisplayName(b, polish ? "pl" : "en"))) || group.name || group.id}
        </span>
        {lastAt != null && (
          <span className="shrink-0 text-[11px] text-ink-secondary">{formatTime(lastAt)}</span>
        )}
      </div>
    </button>
  );
}

// Szuflada tworzenia grupy. Idzie portalem do <body> na `z-[100]`, czyli nad
// drawer (`z-[60]`) i nad menu kontekstowe (`z-[90]`) — renderowana w miejscu
// siedziałaby wewnątrz karty szuflady, która ma `overflow-hidden`, więc dół
// arkusza zostałby przycięty. Układ i klasy z `ModelPicker`: przyklejona do
// dołu ekranu, z zaokrąglonym górnym brzegiem i odsunięciem od paska nawigacji.
function GroupCreateSheet({
  bots,
  onClose,
  onCreated,
}: {
  bots: Bot[];
  onClose: () => void;
  onCreated: (group: EngineGroup) => void;
}) {
  const { dispatch } = useStore();
  const polish = useLanguage() === "pl";
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const create = async () => {
    if (busy || !canCreateGroup(name, picked.size)) return;
    setBusy(true);
    setError(null);
    try {
      // Kolejność składu bierzemy z listy botów, a nie z `Set` — zbiór pamięta
      // kolejność klikania, więc dwie identyczne grupy potrafiłyby mieć różnie
      // ułożony skład i wyglądać na różne.
      const bot_ids = bots.map((b) => engineBotId(b.threadId)).filter((id) => picked.has(id));
      const res = await authFetch("/api/groups", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), bot_ids }),
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        // Silnik odpowiada `{detail}` (FastAPI), przelotka `{error}`. Dopóki
        // backend grup nie jest wdrożony, wychodzi stąd 502 „silnik wyłączony"
        // — i to ma być widać w dialogu, a nie zniknąć bez śladu.
        const detail = typeof body.detail === "string" ? body.detail : undefined;
        const short = typeof body.error === "string" ? body.error : undefined;
        throw new Error(detail ?? short ?? `${res.status} ${res.statusText}`);
      }
      const group = body as unknown as EngineGroup;
      onCreated(group);
      dispatch({ type: "toggleGroup", group });
      document.body.classList.remove("mb-drawer-open");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative flex max-h-[80vh] flex-col overflow-hidden rounded-t-2xl border border-hairline/50 bg-card pb-[var(--safe-bottom)] shadow-2xl shadow-black/60">
        <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-4">
          <span className="text-[15px] font-semibold text-ink">
            {polish ? "Nowa grupa" : "New group"}
          </span>
          <button
            onClick={onClose}
            className="flex size-11 items-center justify-center rounded-lg text-ink-secondary hover:bg-white/10 hover:text-ink"
            aria-label={polish ? "Zamknij" : "Close"}
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-4">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={polish ? "Nazwa grupy" : "Group name"}
            className="h-12 w-full rounded-xl border border-hairline/40 bg-inset px-3 text-[15px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none"
          />
        </div>

        <div className="mt-2 flex-1 overflow-y-auto px-2 py-1">
          {bots.map((b) => {
            const id = engineBotId(b.threadId);
            const on = picked.has(id);
            // Cały wiersz jest celem dotyku i samym podświetleniem mówi,
            // czy bot jest wybrany — checkbox zniknął, bo kwadracik nie
            // pasował do języka wizualnego aplikacji.
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => toggle(id)}
                aria-pressed={on}
                className={cn(
                  "flex min-h-12 cursor-pointer select-none items-center gap-3 rounded-xl px-2 py-2 text-left text-[15px] text-ink",
                  on ? "bg-white/[0.07]" : "hover:bg-white/[0.04]",
                )}
              >
                <MausAvatar
                  color={b.color} avatarUrl={b.avatarUrl}
                  shape={b.mascotShape}
                  size={32}
                  {...sidebarAvatarProps(b)}
                />
                <span className="min-w-0 flex-1 truncate">{botDisplayName(b, polish ? "pl" : "en")}</span>
              </button>
            );
          })}
        </div>

        {error && <div className="px-4 pt-1 text-[13px] text-danger">{error}</div>}

        <div className="px-4 pb-3 pt-2">
          <button
            onClick={() => void create()}
            disabled={busy || !canCreateGroup(name, picked.size)}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-white/[0.12] text-[15px] font-semibold text-ink hover:bg-white/[0.18] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy && <Loader2 size={16} className="animate-spin" />}
            {polish ? "Utwórz" : "Create"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function Sidebar() {
  const { state, dispatch } = useStore();
  const polish = useLanguage() === "pl";
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [groupMenu, setGroupMenu] = useState<GroupMenuState | null>(null);
  const [groupCreateOpen, setGroupCreateOpen] = useState(false);
  const [scoutOpen, setScoutOpen] = useState(false);
  // `null` = jeszcze nie wiadomo (silnik offline albo pierwszy GET w locie).
  // Pusta tablica = wiadomo, że grup nie ma — to dwa różne stany i sekcja
  // rysuje się dopiero przy drugim.
  const [groups, setGroups] = useState<EngineGroup[] | null>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<SearchTab>("All");
  // multibot: zwijana sekcja grup (port PC 23cc789) — tapnięcie nagłówka
  // „Grupy" chowa/rozwija listę grup; stan lokalny, jak u PC.
  const [groupsCollapsed, setGroupsCollapsed] = useState(false);
  const [hiddenBotsCollapsed, setHiddenBotsCollapsed] = useState(true);
  const [sectionPicker, setSectionPicker] = useState<{ botId: string; x: number; y: number } | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => new Set());
  const toggleGroups = () => setGroupsCollapsed((c) => !c);
  const toggleSection = (name: string) => {
    setCollapsedSections((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };
  const searchInputRef = useRef<HTMLInputElement>(null);
  // Dymek profilu i jego menu: menu idzie portalem do <body>, więc nie ma
  // rodzica, względem którego mogłoby się ustawić — kotwiczymy je na pozycji
  // przycisku odczytanej w chwili otwarcia.
  const userButtonRef = useRef<HTMLButtonElement>(null);
  const [userMenuAt, setUserMenuAt] = useState<{ top: number; left: number } | null>(null);

  const toggleUserMenu = () => {
    if (userMenuOpen) {
      setUserMenuOpen(false);
      return;
    }
    const box = userButtonRef.current?.getBoundingClientRect();
    setUserMenuAt(box ? { top: box.bottom + 8, left: box.left } : null);
    setUserMenuOpen(true);
  };

  // Powtórne przytrzymanie tego samego wiersza zamyka jego menu, zamiast
  // otwierać je od nowa. Bez tego `contextmenu` zawsze ustawiał stan na
  // "otwarte" i menu dało się zamknąć tylko kliknięciem gdzie indziej.
  const openBotMenu = (next: MenuState) =>
    setMenu((prev) => (prev?.botId === next.botId ? null : next));

  // multibot: F11 — wskaźnik TYLKO gdy silnik offline a jakiś bot jeździ na
  // engine (dla reszty userów silnik nie istnieje — nic nie pokazujemy i nic
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

  // multibot: F9-FE — lista grup. Jeden GET przy montowaniu i ponowny przy
  // każdym `workspaceVersion`, czyli po zdarzeniu `group` ze strumienia oraz po
  // własnym `workspaceChanged` z `resource: "groups"` (oba trafiają w ten sam
  // licznik — `state/store.tsx`). Zero pollingu, tak jak na komputerze.
  useEffect(() => {
    let alive = true;
    authFetch("/api/groups")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((gs: EngineGroup[]) => alive && setGroups(gs))
      // Brak silnika to nie awaria interfejsu — sekcja ma wtedy po prostu
      // zniknąć, a nie wyrzucić błąd na cały ekran.
      .catch(() => alive && setGroups([]));
    return () => {
      alive = false;
    };
  }, [state.workspaceVersion]);

  const visibleBots = state.bots
    .filter((b) => !b.hidden)
    .sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false));
  const hiddenBots = hiddenBotsForSidebar(state.bots);

  // multibot: przypięty bot — duży awatar 1:1 pod wyszukiwarką, bez szpilki (wzór z foty)
  const pinnedBots = visibleBots.filter((b) => b.pinned);
  const baseBots = visibleBots.filter((b) => !b.pinned);

  // multibot: B4 — filtrowanie listy po zapytaniu z palety wyszukiwania
  const q = query.trim().toLowerCase();
  const filteredBots = q
    ? baseBots.filter(
        (b) =>
          b.name.toLowerCase().includes(q) ||
          b.description.toLowerCase().includes(q),
      )
    : baseBots;
  const unsectionedBots = filteredBots.filter((bot) => !bot.section?.trim());
  const sectionedBots = (() => {
    const result: Array<{ name: string; bots: Bot[] }> = [];
    for (const bot of filteredBots) {
      const name = bot.section?.trim();
      if (!name) continue;
      let section = result.find((item) => item.name === name);
      if (!section) {
        section = { name, bots: [] };
        result.push(section);
      }
      section.bots.push(bot);
    }
    return result;
  })();
  const filteredPinned = q
    ? pinnedBots.filter(
        (b) =>
          b.name.toLowerCase().includes(q) ||
          b.description.toLowerCase().includes(q),
      )
    : pinnedBots;
  const filteredHidden = q
    ? hiddenBots.filter(
        (b) =>
          b.name.toLowerCase().includes(q) ||
          b.description.toLowerCase().includes(q),
      )
    : hiddenBots;

  // Grupy filtrujemy tym samym zapytaniem co boty — paleta wyszukiwania stoi
  // nad całą listą, więc zostawienie grup poza filtrem wyglądałoby na błąd.
  const filteredGroups = q
    ? (groups ?? []).filter((g) => (g.name || g.id).toLowerCase().includes(q))
    : (groups ?? []);

  // Powtórne przytrzymanie tej samej grupy zamyka jej menu — ta sama poprawka
  // co przy botach (`openBotMenu`).
  const openGroupMenu = (next: GroupMenuState) =>
    setGroupMenu((prev) => (prev?.group.id === next.group.id ? null : next));

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

  useEffect(() => {
    if (!searchOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-search-menu]")) {
        setSearchOpen(false);
        setQuery("");
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSearchOpen(false);
        setQuery("");
      }
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [searchOpen]);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  return (
    <aside className="fixed inset-0 z-[60] bg-app md:static md:z-auto md:flex md:w-[320px] md:shrink-0 md:border-r md:border-hairline/40">
      {/* Główna karta ekranu: prawie czarna, zaokrąglona jak ramka telefonu.
          Bez marginesu poziomego — lista botów ma dochodzić do lewej krawędzi. */}
      <div className="relative my-2 flex h-[calc(100%-1rem)] w-full flex-col overflow-hidden rounded-[28px] bg-app shadow-2xl shadow-black/60 md:my-0 md:h-full md:rounded-none">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 pb-2 pt-3.5">
          {/* Dymek profilu stoi w lewym górnym rogu — w miejscu po przycisku X,
              który kiedyś zamykał drawer. Rozwija menu Wtyczki + Ustawienia. */}
          <div className="relative" data-user-menu>
            <button
              ref={userButtonRef}
              onClick={toggleUserMenu}
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-blue-500 text-[14px] font-semibold text-white"
              style={{ minHeight: 0 }}
              aria-label={polish ? "Menu użytkownika" : "User menu"}
              aria-expanded={userMenuOpen}
            >
              {profileInitials(state.config?.profile) || "R"}
            </button>
          </div>
          <div className="flex-1" />
          {/* Szukaj — kliknięcie lupki rozwija popover z paletą wyszukiwania */}
          <div data-search-menu>
            <button
              onClick={() => setSearchOpen((v) => !v)}
              className="rounded-md p-2 text-ink-secondary hover:bg-white/10 hover:text-ink"
              aria-label={polish ? "Szukaj" : "Search"}
              aria-expanded={searchOpen}
            >
              <Search size={20} />
            </button>
          </div>
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
                    dispatch({ type: "newBot", visibility: "team" });
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-ink hover:bg-white/10"
                >
                  <BotIcon size={15} className="text-ink-secondary" />
                  {polish ? "Nowy bot zespołowy" : "New team bot"}
                </button>
                <button
                  onClick={() => {
                    track("bot_created");
                    setAddMenuOpen(false);
                    dispatch({ type: "newBot", visibility: "private" });
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-ink hover:bg-white/10"
                >
                  <BotIcon size={15} className="text-ink-secondary" />
                  {polish ? "Nowy bot prywatny" : "New private bot"}
                </button>
                <button
                  onClick={() => {
                    setAddMenuOpen(false);
                    setGroupCreateOpen(true);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-ink hover:bg-white/10"
                >
                  <Users size={15} className="text-ink-secondary" />
                  {polish ? "Nowa grupa" : "New group"}
                </button>
                <button
                  onClick={() => {
                    setAddMenuOpen(false);
                    setScoutOpen(true);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-ink hover:bg-white/10"
                >
                  <FolderPlus size={15} className="text-ink-secondary" />
                  {polish ? "Zespół z folderu" : "Scout from folder"}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Szukaj — popover pełnej szerokości karty, rozwijany ikoną lupki */}
        {searchOpen && (
          <div
            data-search-menu
            className="absolute inset-x-2 top-2 z-40 flex items-center gap-1 rounded-2xl border border-white/10 bg-card p-2 shadow-lg"
          >
            {/* Jeden wiersz: pole szukania + X. Osobny nagłówek „Szukaj" nad
                polem z własną ramką robił dwie ramki i pusty pas u góry —
                poprawka: „dziwny spacing". */}
            <div className="min-w-0 flex-1">
              <SearchPalette
                query={query}
                onQueryChange={setQuery}
                activeTab={tab}
                onTabChange={setTab}
                inputRef={searchInputRef}
              />
            </div>
            <button
              onClick={() => {
                setSearchOpen(false);
                setQuery("");
              }}
              className="shrink-0 rounded-md p-2 text-ink-secondary hover:bg-white/10 hover:text-ink"
              aria-label={polish ? "Zamknij szukanie" : "Close search"}
            >
              <X size={18} />
            </button>
          </div>
        )}

        {/* Pinned — 1: wycentrowany duży (72px); 2: para obok, wycentrowana (56px);
            3+: siatka 3 kolumny (56px). Hover z opisem jak reszta botów. */}
        {filteredPinned.length > 0 && (
          <div
            className={cn(
              "gap-2 px-3 pb-3",
              filteredPinned.length === 1
                ? "flex justify-center"
                : filteredPinned.length === 2
                  ? "flex justify-center"
                  : "grid grid-cols-3",
            )}
          >
            {filteredPinned.map((b) => {
              const isSelected = state.selectedId === b.id;
              const avatarSize = filteredPinned.length === 1 ? 72 : filteredPinned.length === 2 ? 56 : 48;
              return (
                <button
                  key={b.id}
                  title={b.description?.trim() || preview(b)}
                  onClick={() => {
                    dispatch({ type: "select", id: b.id });
                    document.body.classList.remove("mb-drawer-open");
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    openBotMenu({ botId: b.id, x: e.clientX, y: e.clientY });
                  }}
                  className={cn(
                    "flex flex-col items-center gap-1.5 rounded-2xl px-2 py-2",
                    isSelected ? "bg-white/[0.07]" : "hover:bg-white/[0.04]",
                  )}
                >
                  <MausAvatar
                    color={b.color} avatarUrl={b.avatarUrl}
                    shape={b.mascotShape}
                    size={avatarSize}
                    {...sidebarAvatarProps(b)}
                  />
                  <span className="w-full truncate text-center text-[12px] font-medium leading-tight text-ink">
                    {botDisplayName(b, polish ? "pl" : "en")}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Unified conversation list — bez wcięcia po lewej (wiersze dochodzą
            do krawędzi ekranu), wcięcie zostaje po prawej, gdzie stoi godzina. */}
        <div className="flex-1 overflow-y-auto pr-2">
          <div className="flex flex-col gap-0.5">
            {unsectionedBots.map((b) => (
              <BotRow key={b.id} bot={b} onMenu={openBotMenu} />
            ))}
            {sectionedBots.map((section) => (
              <div key={section.name}>
                <SectionDivider
                  name={section.name}
                  collapsed={collapsedSections.has(section.name)}
                  onToggle={() => toggleSection(section.name)}
                  polish={polish}
                />
                {!collapsedSections.has(section.name) && (
                  <div className="flex flex-col gap-0.5">
                    {section.bots.map((bot) => (
                      <BotRow key={bot.id} bot={bot} onMenu={openBotMenu} />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Grupy pod botami: to lista wtórna wobec rozmów 1:1 i nie ma jej,
              dopóki użytkownik sam grupy nie założy — nad listą botów
              odsuwałaby w dół to, po co drawer się otwiera. Nagłówek jest
              przyciskiem (port PC 23cc789): tapnięcie zwija/rozwija listę. */}
          {filteredGroups.length > 0 && (
            <div className="mt-3 flex flex-col gap-0.5">
              <button
                type="button"
                onClick={toggleGroups}
                aria-expanded={!groupsCollapsed}
                aria-label={groupsCollapsed ? polish ? "Rozwiń sekcję Grupy" : "Expand section Groups" : polish ? "Zwiń sekcję Grupy" : "Collapse section Groups"}
                title={groupsCollapsed ? polish ? "Rozwiń sekcję" : "Expand section" : polish ? "Zwiń sekcję" : "Collapse section"}
                className="flex w-full items-center gap-1.5 rounded-lg px-3 pb-1 pt-1 text-left text-ink-secondary hover:bg-white/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
              >
                {groupsCollapsed ? <ChevronRight size={14} className="shrink-0" /> : <ChevronDown size={14} className="shrink-0" />}
                <span className="text-[12px] font-medium uppercase tracking-wide">
                  {polish ? "Grupy" : "Groups"}
                </span>
              </button>
              {!groupsCollapsed && (
                <div className="flex flex-col gap-0.5">
                  {filteredGroups.map((g) => (
                    <GroupRow key={g.id} group={g} bots={state.bots} onMenu={openGroupMenu} />
                  ))}
                </div>
              )}
            </div>
          )}

          {filteredHidden.length > 0 && (
            <div className="mt-3 flex flex-col gap-0.5 border-t border-white/10 pt-1">
              <button
                type="button"
                onClick={() => setHiddenBotsCollapsed((value) => !value)}
                aria-expanded={!hiddenBotsCollapsed}
                aria-label={hiddenBotsCollapsed ? "Expand hidden bots" : "Collapse hidden bots"}
                className="flex w-full items-center gap-1.5 rounded-lg px-3 pb-1 pt-1 text-left text-ink-secondary hover:bg-white/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
              >
                {hiddenBotsCollapsed ? <ChevronRight size={14} className="shrink-0" /> : <ChevronDown size={14} className="shrink-0" />}
                <span className="text-[12px] font-medium uppercase tracking-wide">Hidden bots ({filteredHidden.length})</span>
              </button>
              {!hiddenBotsCollapsed && (
                <div className="flex flex-col gap-0.5">
                  {filteredHidden.map((bot) => (
                    <HiddenBotRow key={bot.id} bot={bot} onMenu={openBotMenu} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {engineOffline && (
          <div className="flex items-center gap-3 px-3 pb-3 pt-2">
            <div
              title="Local service offline — custom-model bots can't run. Check App Settings."
              className="flex items-center gap-2 text-[12px] text-ink-secondary"
            >
              <span className="size-1.5 shrink-0 rounded-full bg-raised-hover" />
              Service offline
            </div>
          </div>
        )}

        {menu && (
          <BotContextMenu
            menu={menu}
            onClose={() => setMenu(null)}
            onMoveToSection={(botId) => {
              setSectionPicker({ botId, x: menu.x, y: menu.y });
              setMenu(null);
            }}
          />
        )}
        {sectionPicker && <SectionPicker botId={sectionPicker.botId} anchor={sectionPicker} onClose={() => setSectionPicker(null)} />}
        {groupMenu && <GroupContextMenu menu={groupMenu} onClose={() => setGroupMenu(null)} />}
        {groupCreateOpen && (
          <GroupCreateSheet
            bots={visibleBots}
            onClose={() => setGroupCreateOpen(false)}
            // Świeżą grupę dopisujemy lokalnie, żeby pojawiła się od razu:
            // strumień `group` przychodzi z opóźnieniem, a przy wyłączonym
            // silniku nie przyjdzie w ogóle.
            onCreated={(group) => setGroups((gs) => [...(gs ?? []), group])}
          />
        )}
        {scoutOpen && <ScoutTeamModal onClose={() => setScoutOpen(false)} />}
      </div>

      {/* Menu profilu — portal do <body> i `z-[90]`, ta sama warstwa co
          SettingsPanel/ComputerPanel, czyli nad drawerem (`z-[60]`). W miejscu
          renderowania byłoby zamknięte w kontekście nakładania szuflady (ma
          `transform`) i dodatkowo przycinane przez `overflow-hidden` karty.
          `data-user-menu` MUSI zostać także tutaj: portal wynosi menu poza
          poddrzewo przycisku, a wykrywanie „kliknięcia poza" chodzi po DOM-ie
          (`closest`). Bez tego atrybutu `mousedown` na pozycji menu zamykałby
          je, zanim przeglądarka zdążyłaby wysłać `click` do jego przycisku —
          i pierwsze tapnięcie w pozycję menu przepadałoby bez efektu. */}
      {userMenuOpen &&
        userMenuAt &&
        createPortal(
          <div
            data-user-menu
            style={{ top: userMenuAt.top, left: userMenuAt.left }}
            className="fixed z-[90] w-44 rounded-xl border border-white/10 bg-card p-1.5 shadow-lg"
          >
            <button
              onClick={() => {
                setUserMenuOpen(false);
                document.body.classList.remove("mb-drawer-open");
                dispatch({ type: "togglePlugins", open: true });
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-ink hover:bg-white/10"
            >
              <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-white/10 bg-[#151515] text-ink-secondary">\n                 <Plug size={15} />\n               </span>
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
          </div>,
          document.body,
        )}
    </aside>
  );
}
