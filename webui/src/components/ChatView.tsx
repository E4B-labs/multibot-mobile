import { Fragment, useEffect, useCallback, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { ArrowDown, Bell, CalendarClock, Crosshair, FileIcon, Loader2, Upload, Wand2 } from "lucide-react";
import { DrawerToggle } from "./DrawerToggle";
// multibot: wspólna pigułka zdarzenia i wspólna karta pliku
import { Spinner } from "./Loading";
import { EventChip } from "./EventChip";
import { SkillRef } from "./SkillRef";
import { AttachmentCard } from "./AttachmentCard";
// multibot: lightbox załączników-obrazków (port z upstreamu #436)
import { AttachmentPreviewDialog } from "./AttachmentPreview";
// multibot: pasek szukania w transkrypcie (port z upstreamu #437)
import { ChatFindBar } from "./ChatFindBar";
// multibot: menu „⋮" z animowaną sekwencją otwierania (port PC 91b8892d)
import { ChatHeaderMenu } from "./ChatHeaderMenu";
import { useChatFind } from "@/lib/useChatFind";
// multibot: flat replies — cytowanie wiadomości (port z upstreamu #437)
import { ReplyQuote, replyTargetOf } from "./ReplyQuote";
import { routineStartName, slashCommandLabel } from "@/lib/transcriptChips";
import { useStore, type Bot, type Message } from "@/state/store";
import { formatPeerEnvelope, parsePeerEnvelope } from "@/lib/peerEnvelope";
import { PeerBadge } from "./PeerBadge";
import { formatChatSessionTime, shouldStartChatSession } from "@/lib/chatSessions";
import { BotAvatar } from "./Avatar";
import { BOT_COLORS, sidebarAvatarProps } from "@/lib/mascot";
import { ChatMarkdown } from "./ChatMarkdown";
import { CopyMessageButton } from "./CopyMessageButton";
import { OptionCard } from "./OptionCard";
import { ComputerHandoffCard } from "./ComputerHandoffCard";
import { ConnectCard } from "./ConnectCard";
import { SecretRequestCard } from "./SecretRequestCard";
import { Composer } from "./Composer";
// multibot: TTS głośniczek przy wiadomościach bota (tylko z kluczem TTS)
import { SpeakButton } from "./SpeakButton";
import { ModelPicker } from "./ModelPicker";
import { cn } from "@/lib/cn";
import { useLanguage } from "@/lib/language";
import { botDisplayName } from "@/lib/botNames";
import { authFetch } from "@/lib/auth";
import { peerActivityGroupFor } from "@/lib/peerActivity";
// multibot: wygasłe logowanie harnessu — banerka z przyciskiem naprawy
import { AuthExpiredBanner } from "./AuthExpiredBanner";

/** Long user messages collapse behind a fade so pasted walls of text don't
 * bury the conversation; bots get full markdown. */
const USER_COLLAPSE_CHARS = 600;
const USER_COLLAPSE_LINES = 8;

/** Keep the composer text scoped to its bot instead of the active chat view. */
export function setBotDraft(drafts: Record<string, string>, botId: string, text: string): Record<string, string> {
  return { ...drafts, [botId]: text };
}

function MessageAttachment({ botId, file }: { botId: string; file: NonNullable<Message["attachments"]>[number] }) {
  const [url, setUrl] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  useEffect(() => {
    let active = true;
    let objectUrl = "";
    authFetch(`/api/bots/${botId}/attachments/${file.id}`)
      .then((response) => response.ok ? response.blob() : Promise.reject())
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {});
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [botId, file.id]);

  if (file.mime.startsWith("image/")) {
    return url ? (
      <>
        {/* multibot: klik otwiera lightbox; pobieranie przeniosłem do dialogu */}
        <button type="button" onClick={() => setPreviewOpen(true)} className="block cursor-zoom-in">
          <img src={url} alt={file.name} className="max-h-64 w-auto max-w-full rounded-xl object-contain" />
        </button>
        {previewOpen && (
          <AttachmentPreviewDialog url={url} name={file.name} onClose={() => setPreviewOpen(false)} />
        )}
      </>
    ) : <div className="h-24 w-40 animate-pulse rounded-xl bg-raised" />;
  }
  return (
    <div className="flex items-center gap-2">
      {/* multibot: karta pliku wspólna dla załączników użytkownika i bota */}
      <div className="min-w-0 flex-1">
        <AttachmentCard name={file.name} size={file.size} url={url} />
      </div>
      {file.mime === "text/html" && (
        <button
          type="button"
          disabled={!url}
          onClick={() => url && window.open(url, "_blank", "noopener,noreferrer")}
          className="shrink-0 rounded-xl bg-raised px-3 py-2 text-sm text-ink hover:bg-raised-hover disabled:opacity-40"
        >
          Otwórz
        </button>
      )}
    </div>
  );
}

/** multibot (F12): badge modelu przy wiadomości. Szuka ładnej etykiety w
 * katalogu instancji (id → label, np. "claude-opus-5" → "Opus 5"); jak nie
 * znajdzie, pokazuje surowe id. Użyty model leci z serwera na wiadomości. */
function ModelBadge({ model }: { model: string }) {
  const { state } = useStore();
  const label =
    state.instances
      .flatMap((instance) => instance.models.options)
      .find((option) => option.id === model)?.label ?? model;
  return (
    <span
      className="mb-1.5 inline-flex max-w-full items-center gap-1 truncate rounded-full border border-hairline/40 bg-raised/60 px-2 py-0.5 text-[10.5px] font-medium text-ink-secondary"
      title={model}
    >
      <span className="size-1 shrink-0 rounded-full bg-accent" />
      {label}
    </span>
  );
}

function Bubble({
  botId,
  message,
  highlighted,
  replyTarget,
  replyBotName,
  onJumpTo,
}: {
  botId: string;
  message: Message;
  highlighted?: boolean;
  /** multibot: wiadomość cytowana przez tę wiadomość (flat reply) */
  replyTarget?: Message;
  /** nazwa bota do etykiety cytatu („Replying to Atlas") */
  replyBotName?: string;
  onJumpTo?: (id: string) => void;
}) {
  const polish = useLanguage() === "pl";
  const user = message.role === "user";
  const [expanded, setExpanded] = useState(false);
  // multibot: koperta rozmowy bot↔bot — patrz lib/peerEnvelope.ts. Rozbieramy
  // ją przy wyświetlaniu, bo silnik musi dostać kopertę w całości.
  // `text` idzie do TTS i do liczenia długości dymka, więc zostaje sklejone;
  // do rysowania bierzemy nadawcę osobno, bo dostaje plakietkę z awatarem —
  // dymek roli „user" leci czystym tekstem, więc wtyczka wzmianek by go nie
  // złapała i na telefonie zostawało surowe „@Atlas: …".
  const envelope = parsePeerEnvelope(message.text ?? "");
  const text = formatPeerEnvelope(message.text ?? "");
  const body = envelope ? envelope.body : text;
  const collapsible =
    user && !expanded && (text.length > USER_COLLAPSE_CHARS || text.split("\n").length > USER_COLLAPSE_LINES);
  return (
    // multibot: group/msg reveals the SpeakButton (TTS) on bubble hover;
    // data-mb-msg = kotwica dla find-in-chat
    <div
      data-mb-msg={message.id}
      // multibot: seria dymków (iMessage) — reguły w styles.css, sekcja
      // `[data-mb-side]`. O przynależności do serii decyduje SĄSIEDZTWO W DOM,
      // nie indeks wiadomości: między dymkami stają pigułki zdarzeń, chipy
      // pokoju, karty, podglądy ekranu, załącznik SKILL.md i separatory sesji
      // — każde z nich przerywa serię i przerywa ją samym tym, że stoi
      // pomiędzy. Dlatego nie ma tu mapy „ta wiadomość jest N-ta w serii":
      // musiałaby powtórzyć całą logikę widoczności z pętli renderującej.
      data-mb-side={user ? "user" : "bot"}
      className={cn(
        "group/msg flex w-full rounded-2xl transition-shadow",
        user ? "justify-end" : "justify-start",
        highlighted ? "ring-2 ring-accent/70" : "",
      )}
    >
      {/* multibot: wiersz dymek+stopka — stopka (TTS, kopiuj) stoi na PRAWO od
          dymka, na tle czatu, wyrównana do jego dołu (`items-end`), z małym
          odstępem `gap-1`. Bez stopki pod dymkiem, więc dymki bota w liście
          niemal się stykają. Sufity szerokości (max-w) i min-w-0 zostają na
          wrapperze, przyciski są `shrink-0`, dymek `min-w-0` — długa treść
          kurczy dymek, nie wypycha przycisków poza ekran. */}
      <div className={cn("flex min-w-0 items-end gap-1", user ? "max-w-[70%]" : "max-w-full")}>
      <div
        data-mb-bubble=""
        className={cn(
          // multibot: dymek bota sięga aż do krawędzi kolumny — wcześniejsze
          // `max-w-[70%]` zostawiało na telefonie pusty pas po prawej stronie
          // ekranu. To jednak SUFIT (`max-w-full`), nie szerokość: `w-full`
          // rozciągało każdy dymek na całą kolumnę, więc „Sesja wygasła,
          // loguję się ponownie." dostawało pas na pół ekranu zamiast dymka na
          // swoją miarę (Kacper 08.09, zrzut z telefonu; zmierzone w headless
          // Chrome przy kolumnie 400 px: `w-full` 400 px, `max-w-full` 267 px).
          // Dymek jest elementem flexa, więc z samym sufitem kurczy się do
          // treści, a długa wiadomość, tabela czy blok kodu nadal biorą całe
          // 100%.
          //
          // multibot: `min-w-0 break-words` = koniec poziomego paska w czacie.
          // Dymek jest elementem flexa, a taki ma `min-width:auto`, więc NIE
          // kurczy się poniżej swojej szerokości min-content — jeden długi token
          // bez spacji (URL, ścieżka, base64) rozpychał dymek poza listę i lista
          // dostawała suwak poziomy. `min-w-0` zdejmuje blokadę, `break-words`
          // łamie sam token. `overflow-wrap` dziedziczy się w dół, więc obejmuje
          // też markdown; bloki kodu zostają nietknięte, bo `white-space:pre`
          // nie zawija.
          "min-w-0 break-words rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed",
          user
            ? "whitespace-pre-wrap bg-bubble-user text-ink"
            : "bg-card text-ink",
          message.pending && "opacity-60",
        )}
      >
        {message.model && <ModelBadge model={message.model} />}
        {replyTarget && (
          <ReplyQuote
            compact
            message={replyTarget}
            botName={replyBotName}
            onJump={() => onJumpTo?.(replyTarget.id)}
          />
        )}
        {!!message.attachments?.length && message.attachments.some((f) => f.name.toLowerCase() !== "skill.md") && (
          <div className={cn("flex flex-col gap-2", text && "mb-2")}>
            {message.attachments.filter((f) => f.name.toLowerCase() !== "skill.md").map((file) => <MessageAttachment key={file.id} botId={botId} file={file} />)}
          </div>
        )}
        {user ? (
          <>
            <div
              // multibot: kotwica dla find-in-chat — walker po trafieniach
              // schodzi tu i w `.chat-md`, czyli w treść dymka wraz z plakietką
              // nadawcy, ale już nie w stopkę, badge modelu ani cytat
              data-mb-body=""
              className={cn(collapsible && "max-h-40 overflow-hidden [mask-image:linear-gradient(to_bottom,black_60%,transparent)]")}
            >
              {envelope && <PeerBadge name={envelope.from} />}
              {body}
            </div>
            {collapsible && (
              <button onClick={() => setExpanded(true)} className="mt-1 text-[12.5px] text-ink-secondary hover:text-ink">
                {polish ? "Pokaż całą wiadomość" : "Show full message"}
              </button>
            )}
          </>
        ) : (
          <ChatMarkdown text={text} />
        )}
      </div>
      {/* multibot: stopka na PRAWO od dymka, na tle czatu — sterowania (TTS,
          kopiuj) w JEDNYM rzędzie. Hover dalej łapie `group/msg` na całym
          wierszu, więc mechanika pokazywania przycisków bez zmian (na dotyku
          na stałe). */}
      {!user && (
        <div className="flex shrink-0 items-center gap-1.5">
          {/* TTS renders null when the provider does not support it. */}
          <SpeakButton text={text} />
          {/* multibot: kopiuje zrodlo wiadomosci - patrz CopyMessageButton.tsx */}
          <CopyMessageButton text={text} />
        </div>
      )}
      </div>
    </div>
  );
}

function SessionSeparator({ at, polish }: { at: number; polish: boolean }) {
  const label = formatChatSessionTime(at, polish);
  return (
    <div className="flex w-full justify-center py-4 text-[11px] font-medium text-ink-secondary/75" role="separator" aria-label={label}>
      {label}
    </div>
  );
}

function EventPill({ message, polish }: { message: Message; polish: boolean }) {
  const { dispatch } = useStore();
  if (!message.event) return null;
  // Rutyna prowadzi w panel rutyn; przypomnienie — ustawione i odpalone — w
  // panel przypomnień (od 10.09.2026 to osobny rekord, nie rutyna z datą).
  const routineEvent = message.event.type === "routine-created";
  const reminderEvent = message.event.type === "reminder-created" || message.event.type === "reminder";
  const labels = polish
    ? { renamed: "Zmieniono nazwę na", "skill-created": "Utworzono umiejętność", "routine-created": "Utworzono rutynę", "reminder-created": "Przypomnienie", reminder: "Przypomnienie", "goal-progress": "Cel" }
    : { renamed: "Renamed to", "skill-created": "Created skill", "routine-created": "Created routine", "reminder-created": "Reminder", reminder: "Reminder", "goal-progress": "Goal" };
  // multibot: wspólna pigułka zamiast własnego markupu — patrz EventChip.tsx.
  // Rutyna dostaje ikonę zegara, zmiana nazwy zostaje czystym tekstem.
  // skill-created → wyśrodkowany SkillRef: ta sama nazwa, ten sam kolor i ten
  // sam popover co skill wspomniany w zdaniu.
  if (message.event.type === "skill-created") {
    return (
      <div className="flex w-full justify-center py-1">
        <SkillRef name={message.event.value} block />
      </div>
    );
  }
  return (
    <EventChip
      icon={
        routineEvent ? <CalendarClock size={13} />
          : reminderEvent ? <Bell size={13} />
            : message.event.type === "goal-progress" ? <Crosshair size={13} /> : undefined
      }
      label={labels[message.event.type]}
      value={message.event.value}
      onClick={
        routineEvent
          ? () => dispatch({ type: "toggleRoutines", open: true })
          : reminderEvent
            ? () => dispatch({ type: "toggleRoutines", open: true, tab: "reminders" })
            : undefined
      }
      title={
        routineEvent
          ? "Otwórz rutyny / Open routines"
          : reminderEvent
            ? "Otwórz przypomnienia / Open reminders"
            : undefined
      }
    />
  );
}

/** Pulls the full transcript and swaps the chat for the read-only room view. */
function openRoom(roomId: string, dispatch: ReturnType<typeof useStore>["dispatch"]) {
  return authFetch(`/api/rooms/${encodeURIComponent(roomId)}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((full) => full && dispatch({ type: "toggleRoom", room: full }));
}

/** A bot-to-bot card is a door, not a drawer: tapping it swaps the chat for the
 * room's read-only transcript (see RoomPanel). Between 07.09 and this fix the
 * card only expanded downwards into a member list and the room was unreachable.
 * The peer's chip inside the sentence is a second door: it opens that bot's own
 * chat instead of the room. */
function PeerActivity({ messages, currentBotId }: { messages: Message[]; currentBotId: string }) {
  const { state, dispatch } = useStore();
  const polish = useLanguage() === "pl";
  const [opening, setOpening] = useState(false);
  const first = messages[0];
  const room = first?.room;
  if (!room?.event) return null;
  const sent = room.event === "texted" && room.ownerBotId === currentBotId;
  const actor = state.bots.find((bot) => bot.id === room.ownerBotId);
  const peerIds = [...new Set(messages.flatMap((message) => message.room?.bot_ids ?? []).filter((id) => id !== room.ownerBotId && id !== currentBotId))];
  const peers = peerIds.map((id) => state.bots.find((bot) => bot.id === id)).filter((bot): bot is Bot => Boolean(bot));
  const chip = (bot: Bot | undefined, fallback: string) => {
    if (!bot) return <span className="truncate">{fallback}</span>;
    const name = botDisplayName(bot, polish ? "pl" : "en");
    // multibot: nigdy nie pokazujemy awatara bota, którego czat jest właśnie
    // otwarty; bot ukryty nie ma wiersza w pasku, więc też nie jest linkiem.
    if (bot.id === currentBotId || bot.hidden) return <span className="truncate">{name}</span>;
    const activate = (event: MouseEvent | ReactKeyboardEvent) => {
      if ("key" in event && event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      dispatch({ type: "select", id: bot.id });
    };
    return (
      <span
        role="link"
        tabIndex={0}
        title={polish ? "Otwórz czat z tym botem" : "Open this bot's chat"}
        onClick={activate}
        onKeyDown={activate}
        // multibot: `bot.color` to NAZWA z allowlisty, nie kolor CSS — bez
        // BOT_COLORS obwódka brałaby słowo kluczowe CSS (`green` = #008000).
        // `--bot-ink` to kolor bota dociągnięty w połowie do atramentu skórki: sam
        // hex tonie i na jasnych skórkach (yellow, white), i na ciemnych (black).
        // 50/50 w oklab trzyma odcień, a najgorszy kontrast na wypełnieniu to
        // 3,3:1 (lagoon/white) dla całej allowlisty w czterech skórkach.
        style={{
          "--bot": BOT_COLORS[bot.color] ?? BOT_COLORS.green,
          "--bot-ink": "color-mix(in oklab, var(--bot) 50%, var(--color-ink))",
        } as CSSProperties}
        className="inline-flex items-center gap-1 rounded-full min-w-0 px-1.5 py-0.5 text-[var(--bot-ink)] [box-shadow:0_0_0_1px_var(--bot-ink)] bg-[color-mix(in_oklab,var(--bot)_18%,var(--color-app))] hover:bg-[color-mix(in_oklab,var(--bot)_32%,var(--color-app))] focus-visible:bg-[color-mix(in_oklab,var(--bot)_32%,var(--color-app))] focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus focus-visible:outline-offset-1 transition-[background-color] duration-150"
      >
        <BotAvatar color={bot.color} avatarUrl={bot.avatarUrl} shape="blob" size={20} {...sidebarAvatarProps(bot)} />
        <span className="truncate">{name}</span>
      </span>
    );
  };
  const visiblePeers = peers.slice(0, 3);
  const extraPeers = peers.length - visiblePeers.length;
  // multibot: opis to jeden rząd flexa, nie zdanie z chipami wklejonymi w tekst.
  // Chip jest `inline-flex`, więc w toku tekstu bierze linię bazową z awatara i
  // tekst obok siada 2,2 px niżej (zmierzone) — `items-center` to kasuje.
  // `p-1 -m-1` daje `overflow-hidden` zapas na stałą obwódkę chipa (1 px) i na
  // obwódkę fokusu (1 px + 1 px offsetu) — razem 3 px z 4 px zapasu.
  const content = (
    <span className="flex min-w-0 items-center gap-1 overflow-hidden p-1 -m-1">
      <span className="shrink-0">{sent ? (polish ? "Napisano do" : "Messaged") : (polish ? "Wiadomość od" : "Message from")}</span>
      {sent
        ? visiblePeers.length
          ? visiblePeers.map((bot) => <Fragment key={bot.id}>{chip(bot, bot.id)}</Fragment>)
          : <span className="truncate">{room.bot_ids[1] ?? (polish ? "agenta" : "agent")}</span>
        : chip(actor, room.ownerBotId)}
      {sent && extraPeers > 0 && <span className="shrink-0">{`+${extraPeers}`}</span>}
    </span>
  );
  return (
    <div className="flex w-full">
      <button
        type="button"
        onClick={() => {
          setOpening(true);
          void openRoom(room.id, dispatch).finally(() => setOpening(false));
        }}
        disabled={opening}
        aria-busy={opening}
        title={polish ? "Otwórz pokój współpracy (tylko do odczytu)" : "Open collaboration room (read-only)"}
        className="flex w-full min-w-0 cursor-pointer items-center justify-center gap-2 py-1 text-[13px] text-ink-secondary transition-[color,transform] duration-150 hover:text-ink active:scale-[0.97] active:text-ink disabled:cursor-wait disabled:scale-[0.98] disabled:text-ink"
      >
        {content}
        {opening && <Spinner size={13} className="shrink-0" />}
      </button>
    </div>
  );
}

/** Clickable centered legacy room pill opening the read-only collaboration
 * room where those bots worked on a task together. */
function RoomChip({ message }: { message: Message }) {
  const { state, dispatch } = useStore();
  const polish = useLanguage() === "pl";
  const [opening, setOpening] = useState(false);
  const room = message.room;
  if (!room) return null;
  const pill = "flex max-w-full items-center gap-1.5 py-1 text-[13px] text-ink-secondary hover:text-ink";
  // A group turn mirrors ONE room shared by every member, so "X texted Y, Z"
  // read as nonsense in a member's private thread: name the group instead and
  // lead back to the group chat, not the room ledger.
  const groupId = room.groupId;
  if (groupId) {
    return (
      <div className="flex justify-center">
        <button
          onClick={() => {
            setOpening(true);
            void authFetch(`/api/groups/${encodeURIComponent(groupId)}`)
              .then((r) => (r.ok ? r.json() : null))
              .then((group) => group && dispatch({ type: "toggleGroup", group }))
              .finally(() => setOpening(false));
          }}
          className={pill}
          title={polish ? "Otwórz czat grupowy" : "Open group chat"}
        >
          {opening && <Spinner size={13} />}
          <span>{polish ? "Rozmowa w grupie" : "Group chat:"}</span>
          <span className="truncate font-medium text-ink">{room.name}</span>
        </button>
      </div>
    );
  }
  const owner = state.bots.find((b) => b.id === room.ownerBotId);
  const peers = room.bot_ids
    .filter((id) => id !== room.ownerBotId)
    .map((id) => state.bots.find((b) => b.id === id))
    .filter((b): b is Bot => Boolean(b));
  return (
    <div className="flex justify-center">
      <button
        onClick={() => {
          setOpening(true);
          void openRoom(room.id, dispatch).finally(() => setOpening(false));
        }}
        className={pill}
        title={polish ? "Otwórz pokój współpracy (tylko do odczytu)" : "Open collaboration room (read-only)"}
      >
        {opening && <Spinner size={13} />}
        <span className="flex items-center gap-1 font-medium text-ink">
          {owner && (
            <BotAvatar color={owner.color} avatarUrl={owner.avatarUrl} shape="blob" size={18} {...sidebarAvatarProps(owner)} />
          )}
          {owner ? botDisplayName(owner, polish ? "pl" : "en") : room.ownerBotId}
        </span>
        <span>
          {room.event === "replied" ? (polish ? "odpisał(a)" : "replied") : (polish ? "napisał(a) do" : "texted")}
        </span>
        {peers.map((peer) => (
          <span key={peer.id} className="flex items-center gap-1 font-medium text-ink">
            <BotAvatar color={peer.color} avatarUrl={peer.avatarUrl} shape="blob" size={18} {...sidebarAvatarProps(peer)} />
            {botDisplayName(peer, polish ? "pl" : "en")}
          </span>
        ))}
      </button>
    </div>
  );
}

// multibot: część wiadomości użytkownika to nie treść, tylko zdarzenie —
// start rutyny z przelotki (`[Routine: nazwa]`) i sam wybór z pickera `/`.
// Obie pokazujemy jako pigułkę zamiast surowego tekstu; start rutyny jest
// niebieski, żeby wiązał się z listą rutyn.
function userEventChip(message: Message, onOpenRoutines: () => void) {
  if (message.role !== "user" || message.kind !== "text" || message.attachments?.length) return null;
  const routine = routineStartName(message.text);
  if (routine) return <EventChip key={message.id} icon={<CalendarClock size={13} />} value={routine} accent onClick={onOpenRoutines} title="Otwórz rutyny / Open routines" />;
  const command = slashCommandLabel(message.text);
  if (command) return <EventChip key={message.id} icon={<Wand2 size={13} />} value={command} />;
  return null;
}

function ScreenFrame({ png, mime }: { png: string; mime?: string }) {
  return (
    <div className="flex justify-start">
      <img
        src={`data:${mime ?? "image/png"};base64,${png}`}
        alt="Bot's screen"
        className="max-w-[70%] rounded-2xl border border-hairline/40"
      />
    </div>
  );
}

function StreamingBubble({ text }: { text: string }) {
  return (
    // multibot: dymek strumienia dokleja się do serii bota tak samo jak gotowy
    // (patrz styles.css `[data-mb-side]`) — inaczej ostatni dymek odskakiwałby
    // w chwili, gdy strumień się kończy i Bubble go podmienia.
    <div className="flex w-full justify-start" data-mb-side="bot">
      {/* multibot: ta sama szerokość i ten sam dymek co w `Bubble` —
          inaczej tekst przeskakiwałby po zakończeniu strumienia. Wrapper-wiersz
          identyczny jak w `Bubble`, żeby sufit szerokości liczył się w tym
          samym miejscu w obu ścieżkach. */}
      <div className="flex min-w-0 max-w-full items-end gap-1">
      <div data-mb-bubble="" className="min-w-0 break-words rounded-2xl bg-card px-4 py-2.5 text-[15px] leading-relaxed text-ink">
        <ChatMarkdown text={text} streaming />
        <span className="ml-0.5 inline-block h-[14px] w-[2px] animate-pulse bg-ink-secondary align-middle" />
      </div>
      </div>
    </div>
  );
}

/** multibot: niebieski separator "NEW" nad pierwszą nieprzeczytaną wiadomością */
function NewSeparator() {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="h-px flex-1 bg-accent/30" />
      <span className="text-[11px] font-semibold uppercase tracking-wider text-accent">
        NEW
      </span>
      <div className="h-px flex-1 bg-accent/30" />
    </div>
  );
}

export function ChatView({ bot }: { bot: Bot }) {
  const { state, dispatch } = useStore();
  const polish = useLanguage() === "pl";
  const scrollRef = useRef<HTMLDivElement>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const updateDraft = useCallback((botId: string, text: string) => {
    setDrafts((current) => setBotDraft(current, botId, text));
  }, []);

  const streaming = state.streaming[bot.threadId];
  const provisioning = state.provisioning[bot.id];
  // multibot: awatar w naglowku czatu trzyma sie tej samej zasady co pasek
  // boczny i wiersz grupy — stoi nieruchomo ZAWSZE, takze gdy bot pracuje.
  // Jedyny animowany bot w aplikacji siedzi na pasku nad composerem.
  const headerAvatar = sidebarAvatarProps(bot);

  // Scroll pinning: follow the bottom while the user hasn't scrolled away.
  // Follow breaks ONLY on an upward user gesture (wheel/touch), never on
  // scroll position checks — streamed content growth flickers "at bottom"
  // false for a frame, and breaking there kills follow permanently
  // (upstream-verified failure). Scrolling back to the end re-arms it.
  const [follow, setFollow] = useState(true);
  const touchY = useRef(0);
  const [dragOver, setDragOver] = useState(false);
  const dragCounter = useRef(0);

  // multibot: find-in-chat — Ctrl/Cmd+F otwiera pasek, skok podświetla dymek
  const [findOpen, setFindOpen] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const jumpToHit = useCallback((id: string) => {
    setFollow(false);
    setHighlightId(id);
  }, []);
  useEffect(() => {
    if (!highlightId) return;
    document
      .querySelector(`[data-mb-msg="${CSS.escape(highlightId)}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlightId]);
  // multibot: flat reply — stan cytatu nad composerem
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  useEffect(() => setReplyTo(null), [bot.id]);

  // multibot: trafienia w treści — podświetla je useChatFind po Range'ach
  // (patrz lib/findInChat.ts), pasek pokazuje tylko „3/17".
  const find = useChatFind(scrollRef, findOpen);
  const resetFind = find.reset;
  const closeFind = useCallback(() => {
    setFindOpen(false);
    setHighlightId(null);
    resetFind();
  }, [resetFind]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setFollow(false);
        setFindOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const latestSkillEvent = [...bot.messages].reverse().find((message) => message.event?.type === "skill-created")?.id;

  useEffect(() => setFollow(true), [bot.id]);
  useEffect(() => {
    // zmiana bota zamyka find — trafienia należą do starego transkryptu,
    // razem z wpisaną frazą (inaczej pasek wracał z zapytaniem poprzedniego bota)
    setFindOpen(false);
    setHighlightId(null);
    resetFind();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bot.id]);
  useEffect(() => {
    let active = true;
    authFetch(`/api/bots/${bot.id}/skills`)
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((skills: Array<{ name?: unknown; description?: unknown }>) => {
        if (active) dispatch({
          type: "setSkills",
          skills: skills.flatMap((skill) =>
            typeof skill.name === "string"
              ? [{ name: skill.name, description: typeof skill.description === "string" ? skill.description : undefined }]
              : [],
          ),
        });
      })
      .catch(() => active && dispatch({ type: "setSkills", skills: [] }));
    return () => { active = false; };
  }, [bot.id, latestSkillEvent, dispatch]);
  useEffect(() => {
    if (follow) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [bot.id, bot.messages.length, streaming, bot.busy, follow]);

  const atEnd = () => {
    const el = scrollRef.current;
    return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };
  const jumpToLatest = () => {
    setFollow(true);
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  };

  let previousVisibleAt: number | undefined;

  return (
    <main
      className="relative flex h-full min-w-0 flex-1 flex-col bg-app"
      onDragEnter={(e) => {
        e.preventDefault();
        if (e.dataTransfer.types.includes("Files")) {
          dragCounter.current++;
          setDragOver(true);
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (e.dataTransfer.types.includes("Files")) e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        dragCounter.current = Math.max(0, dragCounter.current - 1);
        if (dragCounter.current === 0) setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        dragCounter.current = 0;
        setDragOver(false);
        const files = [...e.dataTransfer.files];
        if (files.length) {
          window.dispatchEvent(new CustomEvent("mb:composer:addFiles", { detail: files }));
        }
      }}
    >
      {/* Header — `sticky top-0` trzyma pasek w widoku, gdy rozmowa się
          przewija. Hamburger (`DrawerToggle`, tylko na telefonie) stoi jako
          pierwszy element i dzieli z paskiem wysokość. */}
      <div className="chat-header sticky top-0 z-20 bg-app flex items-center justify-between gap-2 px-3 py-4">
        <div className="flex min-w-0 items-center gap-2">
          <DrawerToggle />
          <button
            onClick={() => dispatch({ type: "toggleSettings" })}
            className="flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-raised/50"
            title={polish ? "Ustawienia bota" : "Bot settings"}
          >            <BotAvatar
              color={bot.color} avatarUrl={bot.avatarUrl}
              shape={bot.mascotShape}
              size={44}
              state={headerAvatar.state}
              motion={headerAvatar.motion}
              motionKey={headerAvatar.motionKey}
              animated={headerAvatar.animated}
            />
            {/* Nazwa i model w kolumnie, obie ucinane wielokropkiem: na wąskim
                ekranie nachodziły na pigułkę modelu po prawej. */}
            <div className="flex min-w-0 flex-col">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="min-w-0 truncate text-[16px] font-semibold text-ink">{botDisplayName(bot, polish ? "pl" : "en")}</span>
                {bot.busy && <Loader2 size={16} className="animate-spin text-ink-secondary" />}
              </div>
            </div>
          </button>
        </div>
        {/* gap-1, nie gap-2: ikony urosły z 18 na 22 px, a nazwa bota po lewej
            ma tylko tyle miejsca, ile zostanie po prawej grupie. Odstęp
            odrabiamy powiększonym paddingiem samych przycisków. */}
        <div className="flex shrink-0 items-center gap-1">
          {/* hidden per Kacper 07.09.2026, panels kept */}
          <ModelPicker bot={bot} />
          {/* Cztery ikony akcji nie mieszczą się obok nazwy i pigułki modelu na
              ekranie telefonu — chowają się pod jednym przyciskiem. */}
          <ChatHeaderMenu onToggleFind={() => { setFollow(false); setFindOpen((v) => !v); }} />
        </div>
      </div>

      {/* multibot: logowanie CLI wygasło — jedno kliknięcie prowadzi do
          okna logowania tego narzędzia w ustawieniach. */}
      <AuthExpiredBanner bot={bot} />

      {/* Error banner */}
      {state.error && (
        <div className="w-full px-5">
          <div className="mb-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger">
            {state.error}
          </div>
        </div>
      )}

      {/* multibot: nakładka przeciągania siedzi w tej samej ramce co lista
          wiadomości, nie w całej kolumnie czatu — inaczej jej środek wypadał
          między nagłówkiem a polem pisania i karta wyglądała na przesuniętą. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {findOpen && (
          <ChatFindBar find={find} onClose={closeFind} />
        )}
        {/* Messages */}
        <div
        ref={scrollRef}
        className="chat-scroll flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-5 [overflow-anchor:none]"
        onWheel={(e) => {
          if (e.deltaY < 0) setFollow(false);
          else if (atEnd()) setFollow(true);
        }}
        onTouchStart={(e) => (touchY.current = e.touches[0]?.clientY ?? 0)}
        onTouchMove={(e) => {
          const y = e.touches[0]?.clientY ?? 0;
          if (y > touchY.current + 4) setFollow(false);
          else if (atEnd()) setFollow(true);
        }}
        onScroll={() => {
          // przy otwartym pasku szukania NIE wracamy do trybu „goń dół": to
          // programowe przewinięcie na trafienie dojechało do końca listy, a
          // nie użytkownik prosił o live view
          if (!follow && !findOpen && atEnd()) setFollow(true);
        }}
      >
        {/* multibot: `pb-16` (64 px) zamiast `pb-10` — przy dojechaniu na sam
            dół ostatnia wiadomość kleiła się do pola pisania. Composer stoi
            w tym samym wierszu flexa, nie na nakładce, więc te 24 px ponad
            dotychczasowe 40 to czysty oddech pod ostatnim dymkiem. */}
        <div className="flex w-full min-w-0 flex-col gap-1 pb-16">
          {bot.messages.map((m, messageIndex) => {
            let child: ReactNode;
            switch (m.kind) {
              case "secret":
                child = <SecretRequestCard key={m.id} botId={bot.id} message={m} />;
                break;
              case "options":
                // multibot: karta przekazania komputera ma własny render
                // (miniatura ekranu + przejmij/gotowe/pomiń), reszta kart bez zmian
                child = m.card?.kind === "computer-handoff"
                  ? <ComputerHandoffCard key={m.id} botId={bot.id} message={m} />
                  : m.card?.kind === "connect"
                    ? <ConnectCard key={m.id} botId={bot.id} message={m} polish={polish} />
                    : <OptionCard key={m.id} botId={bot.id} message={m} />;
                break;
              // multibot: wywołania narzędzi lecą dalej do stanu (Sidebar pokazuje
              // last.tool.name jako status), ale w czacie są niewidoczne —
              // decyzja Kacpra 21.08: żadnych chipów narzędzi w transkrypcie.
              case "activity":
                child = null;
                break;
              case "event":
                child = <EventPill key={m.id} message={m} polish={polish} />;
                break;
              case "room":
                {
                  const activityGroup = peerActivityGroupFor(bot.messages, messageIndex, bot.id);
                  child = activityGroup
                    ? activityGroup[0]?.id === m.id
                      ? <PeerActivity key={m.id} messages={activityGroup as Message[]} currentBotId={bot.id} />
                      : null
                    : <RoomChip key={m.id} message={m} />;
                }
                break;
              case "screen":
                child = m.png ? <ScreenFrame key={m.id} png={m.png} mime={m.mime} /> : null;
                break;
              default:
                // multibot: pigułka zdarzenia wygrywa z dymkiem, gdy treść
                // wiadomości jest samym zdarzeniem (patrz userEventChip)
                child = userEventChip(m, () => dispatch({ type: "toggleRoutines", open: true })) ?? (
                  <Bubble
                    key={m.id}
                    botId={bot.id}
                    message={m}
                    highlighted={highlightId === m.id}
                    replyTarget={replyTargetOf(bot.messages, m.replyToId)}
                    replyBotName={botDisplayName(bot, polish ? "pl" : "en")}
                    onJumpTo={jumpToHit}
                  />
                );
            }
            const visible = child != null;
            const sessionStart = visible && shouldStartChatSession(previousVisibleAt, m.at);
            if (visible) previousVisibleAt = m.at;
            return (
              <Fragment key={m.id}>
                {sessionStart && <SessionSeparator at={m.at} polish={polish} />}
                {bot.firstUnreadId === m.id && <NewSeparator />}
                {/* SKILL.md stays outside and above its message, on sender side. */}
                {!!m.attachments?.some((f) => f.name.toLowerCase() === "skill.md") && (
                  <div className={cn("flex w-full", m.role === "user" ? "justify-end" : "justify-start")}>
                    <div className={cn("mb-2 flex w-full min-w-0 flex-col gap-2", m.role === "user" && "max-w-[70%]")}>
                      {m.attachments
                        .filter((f) => f.name.toLowerCase() === "skill.md")
                        .map((f) => (
                          <MessageAttachment key={f.id} botId={bot.id} file={f} />
                        ))}
                    </div>
                  </div>
                )}
                {child}
              </Fragment>
            );
          })}
          {provisioning && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-full border border-hairline/40 bg-panel px-3 py-1.5 text-[13px] text-ink-secondary">
                <Loader2 size={13} className="animate-spin" />
                {polish ? "Konfigurowanie komputera bota…" : "Setting up this bot's computer…"}
              </div>
            </div>
          )}
          {streaming ? <StreamingBubble text={streaming} /> : null}
        </div>
        </div>
        {/* desktop drag&drop overlay — any file dropped onto chat becomes an attachment */}
        {dragOver && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-app/70 backdrop-blur-[2px]">
            <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-accent/60 bg-card px-10 py-8 text-center shadow-2xl">
              <span className="flex size-12 items-center justify-center rounded-full bg-accent/15 text-accent">
                <Upload size={24} />
              </span>
              <div className="flex flex-col gap-1">
                <span className="text-[15px] font-semibold text-ink">
                  {polish ? "Upuść pliki tutaj" : "Drop files here"}
                </span>
                <span className="flex items-center justify-center gap-1.5 text-[12px] text-ink-secondary">
                  <FileIcon size={12} /> {polish ? "Zostaną dodane jako załączniki" : "They'll be added as attachments"}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Reading scrollback while new content arrives — one tap back to live */}
      {!follow && (bot.busy || Boolean(streaming)) && (
        <button
          onClick={jumpToLatest}
          className="absolute bottom-24 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-hairline/40 bg-raised px-3 py-1.5 text-[12.5px] text-ink shadow-lg hover:bg-raised-hover"
        >
          <ArrowDown size={13} /> {polish ? "Przejdź do najnowszych" : "Jump to latest"}
        </button>
      )}

      {/* multibot: flat reply — pasek cytatu nad composerem */}
      {replyTo && (
        <div className="px-5">
          <ReplyQuote
            message={replyTargetOf(bot.messages, replyTo.id) ?? replyTo}
            botName={botDisplayName(bot, polish ? "pl" : "en")}
            onClear={() => setReplyTo(null)}
          />
        </div>
      )}

      <Composer
        bot={bot}
        draft={drafts[bot.id] ?? ""}
        onDraftChange={(text) => updateDraft(bot.id, text)}
        replyToId={replyTo?.id}
        onClearReply={() => setReplyTo(null)}
      />

    </main>
  );
}
