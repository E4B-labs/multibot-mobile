import { useEffect, useRef, useState } from "react";
import { ArrowDown, Brain, CalendarClock, Check, File, Loader2, Monitor, Square, Wand2, X } from "lucide-react";
import { useStore, formatTime, type Bot, type Message } from "@/state/store";
import { MausAvatar } from "./Avatar";
import { stateForBot } from "@/lib/mascot";
import { ChatMarkdown } from "./ChatMarkdown";
import { OptionCard } from "./OptionCard";
import { Composer } from "./Composer";
import { DrawerToggle } from "./DrawerToggle";
// multibot: TTS głośniczek przy wiadomościach bota (tylko driver slafy)
import { SpeakButton } from "./SpeakButton";
import { ModelPicker, modelLabelText } from "./ModelPicker";
import { cn } from "@/lib/cn";
import { useLanguage } from "@/lib/language";
import { authFetch } from "@/lib/auth";

/** Long user messages collapse behind a fade so pasted walls of text don't
 * bury the conversation; bots get full markdown. */
const USER_COLLAPSE_CHARS = 600;
const USER_COLLAPSE_LINES = 8;

function MessageAttachment({ botId, file }: { botId: string; file: NonNullable<Message["attachments"]>[number] }) {
  const [url, setUrl] = useState<string | null>(null);
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
      <a href={url} download={file.name} className="block">
        <img src={url} alt={file.name} className="max-h-64 w-auto max-w-full rounded-xl object-contain" />
      </a>
    ) : <div className="h-24 w-40 animate-pulse rounded-xl bg-raised" />;
  }
  return (
    <a
      href={url ?? undefined}
      download={file.name}
      aria-disabled={!url}
      className="flex items-center gap-2 rounded-xl bg-raised px-3 py-2 text-sm text-ink hover:bg-raised-hover"
    >
      <File size={16} className="shrink-0 text-ink-secondary" />
      <span className="min-w-0 flex-1 truncate">{file.name}</span>
      <span className="shrink-0 text-xs text-ink-secondary">{file.size >= 1024 * 1024 ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(file.size / 1024))} KB`}</span>
    </a>
  );
}

function Bubble({ botId, message }: { botId: string; message: Message }) {
  const polish = useLanguage() === "pl";
  const user = message.role === "user";
  const [expanded, setExpanded] = useState(false);
  const text = message.text ?? "";
  const collapsible =
    user && !expanded && (text.length > USER_COLLAPSE_CHARS || text.split("\n").length > USER_COLLAPSE_LINES);
  return (
    // multibot: group/msg reveals the SpeakButton (TTS) on bubble hover
    <div className={cn("group/msg flex w-full", user ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[70%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed",
          user ? "whitespace-pre-wrap bg-bubble-user text-ink" : "bg-card text-ink",
        )}
      >
        {!!message.attachments?.length && (
          <div className={cn("flex flex-col gap-2", text && "mb-2")}>
            {message.attachments.map((file) => <MessageAttachment key={file.id} botId={botId} file={file} />)}
          </div>
        )}
        {user ? (
          <>
            <div
              className={cn(collapsible && "max-h-40 overflow-hidden [mask-image:linear-gradient(to_bottom,black_60%,transparent)]")}
            >
              {text}
            </div>
            {collapsible && (
              <button onClick={() => setExpanded(true)} className="mt-1 text-[12.5px] text-ink-secondary hover:text-ink">
                {polish ? "Pokaż całą wiadomość" : "Show full message"}
              </button>
            )}
          </>
        ) : (
          <>
            <ChatMarkdown text={text} />
            {/* multibot: TTS — see SpeakButton.tsx; renders null off-slafy */}
            <SpeakButton text={text} />
          </>
        )}
      </div>
    </div>
  );
}

/** A tool run: spinner while live, check/cross once settled. */
function ActivityChip({ message }: { message: Message }) {
  const tool = message.tool;
  if (!tool) return null;
  const failed = tool.ok === false;
  return (
    <div className="flex justify-start">
      <div
        className={cn(
          "flex items-center gap-2 rounded-full border border-hairline/40 bg-panel px-3 py-1.5 text-[13px]",
          failed ? "text-danger" : "text-ink-secondary",
        )}
      >
        {tool.ok === undefined ? (
          <Loader2 size={13} className="animate-spin" />
        ) : failed ? (
          <X size={13} />
        ) : (
          <Check size={13} className="text-success" />
        )}
        <span className="max-w-[480px] truncate font-mono">{tool.name}</span>
      </div>
    </div>
  );
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
    <div className="flex w-full justify-start">
      <div className="max-w-[70%] rounded-2xl bg-card px-4 py-2.5 text-[15px] leading-relaxed text-ink">
        <ChatMarkdown text={text} streaming />
        <span className="ml-0.5 inline-block h-[14px] w-[2px] animate-pulse bg-ink-secondary align-middle" />
      </div>
    </div>
  );
}

/** "Working for 12s" that ticks by mutating textContent on an interval —
 * no React commit per second while a turn streams (upstream trick). */
function WorkingTimer({ since }: { since: number }) {
  const polish = useLanguage() === "pl";
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const tick = () => {
      if (ref.current) ref.current.textContent = polish
        ? `Praca trwa ${Math.max(0, Math.round((Date.now() - since) / 1000))} s`
        : `Working for ${Math.max(0, Math.round((Date.now() - since) / 1000))}s`;
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [polish, since]);
  return <span ref={ref} className="text-[12.5px] text-ink-secondary" />;
}

export function ChatView({ bot }: { bot: Bot }) {
  const { state, dispatch } = useStore();
  const polish = useLanguage() === "pl";
  const scrollRef = useRef<HTMLDivElement>(null);

  const streaming = state.streaming[bot.threadId];
  const provisioning = state.provisioning[bot.id];
  const mascotMotion = state.mascotMotion?.botId === bot.id ? state.mascotMotion : null;

  // Scroll pinning: follow the bottom while the user hasn't scrolled away.
  // Follow breaks ONLY on an upward user gesture (wheel/touch), never on
  // scroll position checks — streamed content growth flickers "at bottom"
  // false for a frame, and breaking there kills follow permanently
  // (upstream-verified failure). Scrolling back to the end re-arms it.
  const [follow, setFollow] = useState(true);
  const touchY = useRef(0);

  useEffect(() => setFollow(true), [bot.id]);
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

  const first = bot.messages[0];

  return (
    <main className="relative flex h-full min-w-0 flex-1 flex-col bg-app">
      {/* Header — `sticky top-0` keeps this bar in view while the conversation
          scrolls. The hamburger (DrawerToggle, only on mobile) opens the drawer
          and sits inline as the first element, so it shares the bar's height. */}
      <div className="chat-header sticky top-0 z-20 bg-app flex items-center justify-between gap-2 px-3 py-4">
        <div className="flex min-w-0 items-center gap-2">
          <DrawerToggle />
          <button
            onClick={() => dispatch({ type: "toggleSettings" })}
            className="flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-raised/50"
            title={polish ? "Ustawienia bota" : "Bot settings"}
          >
            <MausAvatar
              color={bot.color}
              shape={bot.mascotShape}
              state={stateForBot(bot)}
              size={44}
              motion={mascotMotion?.kind ?? "none"}
              motionKey={mascotMotion?.nonce ?? 0}
            />
            <div className="flex min-w-0 flex-col items-start">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-[16px] font-semibold text-ink">{bot.name}</span>
                {bot.busy && <Loader2 size={16} className="animate-spin text-ink-secondary" />}
              </div>
              {(() => {
                const inst = state.instances.find((i) => i.instanceId === bot.modelSelection.instanceId);
                const label = modelLabelText(inst, bot.modelSelection.model);
                return label ? (
                  <span className="truncate text-[13px] text-ink-secondary">{label}</span>
                ) : null;
              })()}
            </div>
          </button>
        </div>
        {/* gap-1, nie gap-2: ikony urosły z 18 na 22 px, a nazwa bota po lewej
            ma tylko tyle miejsca, ile zostanie po prawej grupie. Odstęp
            odrabiamy powiększonym paddingiem samych przycisków. */}
        <div className="flex shrink-0 items-center gap-1">
          {bot.busy && (
            <button
              onClick={() => dispatch({ type: "interrupt", botId: bot.id })}
              className="flex items-center gap-1.5 rounded-full border border-hairline/40 bg-raised/60 px-2.5 py-1 text-[13px] text-ink-secondary hover:bg-raised hover:text-ink"
              title={polish ? "Zatrzymaj turę" : "Stop this turn"}
            >
              <Square size={12} className="fill-current" />
              {polish ? "Stop" : "Stop"}
            </button>
          )}
          <ModelPicker bot={bot} />
          <button
            onClick={() => dispatch({ type: "toggleComputer" })}
            className={cn(
              "rounded-lg px-1 py-3 hover:bg-raised",
              state.computerOpen ? "text-accent" : "text-ink-secondary hover:text-ink",
            )}
            title={polish ? "Komputer bota" : "Bot's computer"}
          >
            <Monitor size={22} />
          </button>
          <button
            onClick={() => dispatch({ type: "toggleMemory" })}
            className={cn(
              "rounded-lg px-1 py-3 hover:bg-raised",
              state.memoryOpen ? "text-accent" : "text-ink-secondary hover:text-ink",
            )}
            title={polish ? "Pamięć bota" : "Bot memory"}
            aria-label={polish ? "Pamięć bota" : "Bot memory"}
          >
            <Brain size={22} />
          </button>
          <button
            onClick={() => dispatch({ type: "toggleRoutines" })}
            className={cn(
              "rounded-lg px-1 py-3 hover:bg-raised",
              state.routinesOpen ? "text-accent" : "text-ink-secondary hover:text-ink",
            )}
            title={polish ? "Rutyny bota" : "Bot routines"}
            aria-label={polish ? "Rutyny bota" : "Bot routines"}
          >
            <CalendarClock size={22} />
          </button>
          <button
            onClick={() => dispatch({ type: "toggleSkills" })}
            className={cn(
              "rounded-lg px-1 py-3 hover:bg-raised",
              state.skillsOpen ? "text-accent" : "text-ink-secondary hover:text-ink",
            )}
            title={polish ? "Skille bota" : "Bot skills"}
            aria-label={polish ? "Skille bota" : "Bot skills"}
          >
            <Wand2 size={22} />
          </button>
        </div>
      </div>

      {/* Error banner */}
      {state.error && (
        <div className="mx-auto w-full max-w-[900px] px-5">
          <div className="mb-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger">
            {state.error}
          </div>
        </div>
      )}

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto px-5 [overflow-anchor:none]"
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
          if (!follow && atEnd()) setFollow(true);
        }}
      >
        <div className="mx-auto flex max-w-[900px] flex-col gap-3 pb-4">
          {first && (
            <div className="py-3 text-center text-[13px] text-ink-secondary">
              {polish ? "Dziś" : "Today"} {formatTime(first.at)}
            </div>
          )}
          {bot.messages.map((m) => {
            switch (m.kind) {
              case "options":
                return <OptionCard key={m.id} botId={bot.id} message={m} />;
              case "activity":
                return <ActivityChip key={m.id} message={m} />;
              case "screen":
                return m.png ? <ScreenFrame key={m.id} png={m.png} mime={m.mime} /> : null;
              default:
                return <Bubble key={m.id} botId={bot.id} message={m} />;
            }
          })}
          {provisioning && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-full border border-hairline/40 bg-panel px-3 py-1.5 text-[13px] text-ink-secondary">
                <Loader2 size={13} className="animate-spin" />
                {polish ? "Konfigurowanie komputera bota…" : "Setting up this bot's computer…"}
              </div>
            </div>
          )}
          {streaming ? (
            <StreamingBubble text={streaming} />
          ) : (
            bot.busy && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2.5 rounded-2xl bg-raised px-4 py-3">
                  <span className="flex items-center gap-1.5">
                    <span className="size-1.5 animate-bounce rounded-full bg-ink-secondary [animation-delay:0ms]" />
                    <span className="size-1.5 animate-bounce rounded-full bg-ink-secondary [animation-delay:150ms]" />
                    <span className="size-1.5 animate-bounce rounded-full bg-ink-secondary [animation-delay:300ms]" />
                  </span>
                  <WorkingTimer since={[...bot.messages].reverse().find((m) => m.role === "user")?.at ?? Date.now()} />
                </div>
              </div>
            )
          )}
        </div>
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

      <Composer bot={bot} />
    </main>
  );
}
