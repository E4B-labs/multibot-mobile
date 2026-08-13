// The bot's computer, in the right-side slot. Where it runs decides the
// whole flow: cloud → provision the box on open (idempotent) and preview
// via SSE frames or a ~4s screenshot poll; local ("This Mac") → frames
// come from the Electron main process (desktopCapturer over the preload
// bridge — box endpoints are never touched); off → parked. Auto (unset)
// prefers the cloud box when one exists, else local inside the app.
// multibot (F5): fourth mode "playwright" → the bot's own engine browser with a
// persistent profile, streamed here over one WS (frames down, input up) through
// the harness pipe proxy (`/api/engine/bots/mb-<threadId>/computer`). All
// drivers, all platforms — no Electron and no macOS gate on this path.
import { useEffect, useRef, useState } from "react";
import {
  CalendarClock,
  ExternalLink,
  Loader2,
  Monitor,
  Moon,
  Power,
  Settings,
  X,
} from "lucide-react";
import { useStore, type Bot } from "@/state/store";
import { ApiKeyRow } from "./ApiKeys";
import { cn } from "@/lib/cn";

async function api(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(path, { headers: { "content-type": "application/json" }, ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  return body;
}

type Phase =
  | "checking"
  | "unconfigured"
  | "starting"
  | "ready"
  | "local"
  | "local-unavailable"
  // multibot (F5): the bot's engine browser — live view + take-over over WS
  | "playwright"
  | "off"
  | "error";

// multibot (F5): one screencast frame from the engine bridge (engine/server/
// computer.py): base64 jpeg plus the CSS-viewport size — the same space CDP
// input coordinates must be expressed in.
type PwFrame = { data: string; w: number; h: number };

export function ComputerPanel({ bot }: { bot: Bot }) {
  const { state, dispatch } = useStore();
  const [phase, setPhase] = useState<Phase>("checking");
  const [boxState, setBoxState] = useState<string | null>(null);
  const [polledFrame, setPolledFrame] = useState<{ png: string; mime: string } | null>(null);
  const [localFrame, setLocalFrame] = useState<string | null>(null);
  const [pending, setPending] = useState<"join" | "sleep" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // bumped when a Box token is saved inline, to re-run the spin-up flow
  const [retry, setRetry] = useState(0);
  // multibot (F5): engine-browser live view + take-over. Refs mirror state the
  // native wheel listener and coordinate math must read without stale closures.
  const [pwFrame, setPwFrame] = useState<PwFrame | null>(null);
  const [pwStatus, setPwStatus] = useState<"connecting" | "live" | "reconnecting">("connecting");
  const [takeover, setTakeover] = useState(false);
  const pwWs = useRef<WebSocket | null>(null);
  const pwFrameRef = useRef<PwFrame | null>(null);
  const pwImg = useRef<HTMLImageElement | null>(null);
  const pwLastMove = useRef(0);

  // resolve the mode on open; box endpoints are only ever hit on the
  // cloud path, so local/off can never render a JSON error as an image
  useEffect(() => {
    let alive = true;
    setPhase("checking");
    setPolledFrame(null);
    setLocalFrame(null);
    setError(null);
    const isElectron = Boolean(window.ogb);
    if (bot.computer === "off") {
      setPhase("off");
      return;
    }
    if (bot.computer === "local") {
      setPhase(isElectron ? "local" : "local-unavailable");
      return;
    }
    // multibot (F5): explicit choice only — auto never resolves here, and the
    // box endpoints below are never touched (the WS effect owns this phase)
    if (bot.computer === "playwright") {
      setPhase("playwright");
      return;
    }
    // cloud, or auto (cloud box wins when one exists, else local in-app)
    api(`/api/bots/${bot.id}/computer`)
      .then((status) => {
        if (!alive) return;
        const autoLocal = bot.computer !== "cloud" && isElectron;
        if (!status.configured) {
          setPhase(autoLocal ? "local" : "unconfigured");
          return;
        }
        if (!status.box && autoLocal) {
          setPhase("local");
          return;
        }
        setPhase("starting");
        return api(`/api/bots/${bot.id}/computer/provision`, { method: "POST" }).then((r) => {
          if (!alive) return;
          setBoxState(r.state ?? null);
          setPhase("ready");
        });
      })
      .catch((e) => {
        if (!alive) return;
        setError(e.message);
        setPhase("error");
      });
    return () => {
      alive = false;
    };
  }, [bot.id, bot.computer, retry]);

  // cloud preview: SSE frames win while the bot works; otherwise poll
  const live = state.screens[bot.id];
  const sseFlowing = Boolean(bot.busy && live);
  const inFlight = useRef(false);
  useEffect(() => {
    if (phase !== "ready" || sseFlowing) return;
    let alive = true;
    const shoot = async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const { png, format } = await api(`/api/bots/${bot.id}/computer/screenshot`, { method: "POST" });
        if (alive) setPolledFrame({ png, mime: format === "jpeg" ? "image/jpeg" : "image/png" });
      } catch {
        /* box mid-command or asleep — next tick */
      } finally {
        inFlight.current = false;
      }
    };
    void shoot();
    const timer = setInterval(shoot, 4000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [phase, sseFlowing, bot.id]);

  // local preview: frames from the Electron main process. The FIRST capture
  // attempt is what makes macOS show the Screen Recording prompt (there is
  // no reliable pre-grant flow on macOS 15+), so repeated empty frames mean
  // the user denied — surface the Settings repair path instead of spinning.
  const [localMisses, setLocalMisses] = useState(0);
  useEffect(() => {
    if (phase !== "local" || !window.ogb) return;
    let alive = true;
    setLocalMisses(0);
    const shoot = async () => {
      try {
        const url = await window.ogb!.screenFrame();
        if (alive && url) setLocalFrame(url);
        else if (alive) setLocalMisses((n) => n + 1);
      } catch {
        if (alive) setLocalMisses((n) => n + 1);
      }
    };
    void shoot();
    const timer = setInterval(shoot, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [phase]);

  // multibot (F5): live view of the bot's engine browser. The browser may not
  // exist before the first turn, so every (re)connect POSTs /computer/start
  // first (idempotent) — which also heals close 4404 (browser gone). Engine
  // offline surfaces as a failed upgrade → onclose → the same backoff loop.
  useEffect(() => {
    if (phase !== "playwright") return;
    let alive = true;
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = 1000;
    setPwFrame(null);
    pwFrameRef.current = null;
    setPwStatus("connecting");
    setTakeover(false);
    // default botPrefix "mb-", same pattern as local runtime controls
    const engineBotId = `mb-${bot.threadId}`;
    const connect = async () => {
      if (!alive) return;
      try {
        await fetch(`/api/engine/bots/${engineBotId}/computer/start`, { method: "POST" });
      } catch {
        /* engine unreachable — the WS close below schedules the retry */
      }
      if (!alive) return;
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/api/engine/bots/${engineBotId}/computer`);
      pwWs.current = ws;
      ws.onopen = () => {
        if (!alive) return;
        delay = 1000;
        setPwStatus("live");
      };
      ws.onmessage = (e) => {
        if (!alive) return;
        try {
          const msg = JSON.parse(String(e.data));
          if (msg.type === "frame") {
            const frame: PwFrame = { data: String(msg.data), w: Number(msg.w) || 0, h: Number(msg.h) || 0 };
            pwFrameRef.current = frame;
            setPwFrame(frame);
          }
        } catch {
          /* junk frame — skip */
        }
      };
      ws.onclose = () => {
        if (!alive) return;
        pwWs.current = null;
        setPwStatus("reconnecting");
        setTakeover(false);
        timer = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 8000);
      };
    };
    void connect();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      pwWs.current = null;
      ws?.close();
    };
  }, [phase, bot.threadId]);

  // multibot (F5): take-over — pointer/keyboard from the preview, rescaled from
  // the displayed <img> to the frame's CSS-viewport space and sent up as
  // {type:"input", event} (one event per message; shapes match the engine's
  // _mouse_params/_key_params in engine/server/computer.py).
  const pwSend = (event: Record<string, unknown>) => {
    const ws = pwWs.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "input", event }));
  };
  const cdpModifiers = (e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) =>
    (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);
  const pwPoint = (e: { clientX: number; clientY: number }) => {
    const f = pwFrameRef.current;
    const rect = pwImg.current?.getBoundingClientRect();
    if (!f || !f.w || !f.h || !rect || !rect.width) return null;
    // the container's aspect follows the frame, so the img box IS the frame —
    // one uniform scale, no letterbox offsets
    const scale = f.w / rect.width;
    return {
      x: Math.min(f.w, Math.max(0, (e.clientX - rect.left) * scale)),
      y: Math.min(f.h, Math.max(0, (e.clientY - rect.top) * scale)),
    };
  };
  const pwMouse = (type: "mousePressed" | "mouseReleased" | "mouseMoved") => (e: React.MouseEvent) => {
    if (!takeover) return;
    e.preventDefault();
    // preventDefault suppresses focus-on-click, so reclaim it here — otherwise a
    // detour through the composer leaves keystrokes going nowhere
    if (type === "mousePressed") pwImg.current?.focus();
    if (type === "mouseMoved") {
      const now = performance.now();
      if (now - pwLastMove.current < 33) return; // ~30 Hz is plenty for CDP
      pwLastMove.current = now;
    }
    const p = pwPoint(e);
    if (!p) return;
    pwSend({
      kind: "mouse",
      type,
      ...p,
      button: type === "mouseMoved" ? "none" : (["left", "middle", "right"][e.button] ?? "left"),
      clickCount: type === "mouseMoved" ? 0 : e.detail || 1,
      modifiers: cdpModifiers(e),
    });
  };
  const pwKey = (type: "keyDown" | "keyUp") => (e: React.KeyboardEvent) => {
    if (!takeover) return;
    e.preventDefault(); // keep app shortcuts (Cmd/Ctrl+K & co.) out of the page
    pwSend({ kind: "key", type, key: e.key, code: e.code, modifiers: cdpModifiers(e) });
  };
  // wheel needs preventDefault, and React registers wheel listeners passively —
  // bind natively (passive:false) only while take-over is on; focus the img so
  // keystrokes land here instead of the composer
  useEffect(() => {
    const img = pwImg.current;
    if (!takeover || !img) return;
    img.focus();
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = pwPoint(e);
      if (!p) return;
      pwSend({
        kind: "mouse",
        type: "mouseWheel",
        ...p,
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        modifiers: cdpModifiers(e),
      });
    };
    img.addEventListener("wheel", onWheel, { passive: false });
    return () => img.removeEventListener("wheel", onWheel);
    // pwPoint/pwSend only read refs, so the snapshot captured here stays valid
  }, [takeover]);

  const lastScreenMessage = [...bot.messages].reverse().find((m) => m.kind === "screen" && m.png);
  const cloudFrame =
    live ??
    polledFrame ??
    (lastScreenMessage ? { png: lastScreenMessage.png!, mime: lastScreenMessage.mime ?? "image/png" } : null);
  const frameSrc =
    phase === "local"
      ? localFrame
      : // multibot (F5): engine screencast frames are always jpeg
        phase === "playwright"
        ? pwFrame && `data:image/jpeg;base64,${pwFrame.data}`
        : phase === "ready" || phase === "starting"
          ? cloudFrame && `data:${cloudFrame.mime};base64,${cloudFrame.png}`
          : null;

  const run = (kind: "join" | "sleep") => {
    setPending(kind);
    setError(null);
    api(`/api/bots/${bot.id}/computer/${kind}`, { method: "POST" })
      .then((result) => {
        // the join URL's stream token rotates — always freshly minted, never cached
        if (kind === "join" && result.joinUrl) window.open(result.joinUrl);
        if (kind === "sleep") setBoxState("archived");
      })
      .catch((e) => setError(e.message))
      .finally(() => setPending(null));
  };

  const emptyState: Record<Exclude<Phase, "ready" | "local" | "playwright">, string> = {
    checking: "Checking…",
    starting: "Starting your bot's computer…",
    unconfigured: "No cloud computer configured",
    "local-unavailable": "Local preview needs the desktop app — run pnpm dev:desktop",
    off: "This bot's computer is off",
    error: "Couldn't reach the computer",
  };

  return (
    <aside className="animate-panel-in flex h-full w-[400px] shrink-0 flex-col border-l border-hairline/40 bg-panel">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <button
          onClick={() => dispatch({ type: "toggleSettings", open: true })}
          className="rounded-md p-1 text-ink-secondary hover:bg-raised hover:text-ink"
          title="Bot settings"
        >
          <Settings size={18} />
        </button>
        <span className="text-[15px] font-semibold text-ink">Computer</span>
        <button
          onClick={() => dispatch({ type: "toggleComputer", open: false })}
          className="rounded-md p-1 text-ink-secondary hover:bg-raised hover:text-ink"
        >
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-5">
        {/* Screen preview */}
        <div className="mb-1.5 mt-2 flex items-center justify-between text-[13px] text-ink-secondary">
          <span>{bot.name}'s screen</span>
          {phase === "local" && <span className="text-[11px]">this Mac</span>}
          {/* multibot (F5): connection state + take-over toggle, above the preview */}
          {phase === "playwright" && (
            <span className="flex items-center gap-2">
              <span className="text-[11px]">
                {pwStatus === "live" ? "bot browser" : pwStatus === "connecting" ? "connecting…" : "reconnecting…"}
              </span>
              {pwStatus === "live" && pwFrame && (
                <button
                  onClick={() => setTakeover((t) => !t)}
                  className={cn(
                    "rounded-md px-2 py-0.5 text-[11px] font-medium",
                    takeover ? "bg-accent text-white" : "bg-raised text-ink hover:bg-raised-hover",
                  )}
                >
                  {takeover ? "Hand back" : "Take over"}
                </button>
              )}
            </span>
          )}
        </div>
        {/* multibot (F5): in playwright mode the box follows the frame's aspect,
            so the img box IS the frame (object-contain adds no letterbox) and
            take-over coordinates stay one uniform scale; the accent ring marks
            an active take-over */}
        <div
          className={cn(
            "flex w-full items-center justify-center overflow-hidden rounded-xl bg-card",
            phase !== "playwright" && "aspect-[16/10]",
            phase === "playwright" && takeover && "ring-2 ring-accent",
          )}
          style={
            phase === "playwright"
              ? { aspectRatio: pwFrame?.w && pwFrame?.h ? `${pwFrame.w} / ${pwFrame.h}` : "16 / 10" }
              : undefined
          }
        >
          {frameSrc ? (
            phase === "playwright" ? (
              <img
                ref={pwImg}
                src={frameSrc}
                alt={`${bot.name}'s screen`}
                draggable={false}
                tabIndex={-1}
                onMouseDown={pwMouse("mousePressed")}
                onMouseUp={pwMouse("mouseReleased")}
                onMouseMove={pwMouse("mouseMoved")}
                onKeyDown={pwKey("keyDown")}
                onKeyUp={pwKey("keyUp")}
                onContextMenu={(e) => takeover && e.preventDefault()}
                className={cn("h-full w-full object-contain outline-none", takeover && "cursor-crosshair")}
              />
            ) : (
              <img src={frameSrc} alt={`${bot.name}'s screen`} className="h-full w-full object-contain" />
            )
          ) : (
            <div className="flex flex-col items-center gap-2 px-6 text-center text-ink-secondary">
              {phase === "checking" || phase === "starting" || phase === "local" || phase === "playwright" ? (
                <Loader2 size={18} className="animate-spin" />
              ) : phase === "off" ? (
                <Power size={22} />
              ) : (
                <Monitor size={22} />
              )}
              <span className="text-[12px]">
                {phase === "ready"
                  ? "Waiting for the first frame…"
                  : // multibot (F5): engine offline and browser-not-yet-up land in
                    // the same reconnect loop; name the state, keep spinning
                    phase === "playwright"
                    ? pwStatus === "reconnecting"
                      ? "Engine offline or browser restarting — reconnecting…"
                      : "Starting the bot's browser…"
                    : phase === "local"
                    ? localMisses >= 3
                      ? "No frames yet — the preview needs Screen Recording permission. After granting, relaunch the app (macOS applies it on next launch)."
                      : "Capturing this Mac's screen…"
                    : emptyState[phase]}
              </span>
              {phase === "local" && localMisses >= 3 && (
                <button
                  onClick={() => window.ogb?.permOpenSettings?.("screen")}
                  className="mt-1 rounded-lg bg-raised px-3 py-1.5 text-[12px] text-ink hover:bg-raised-hover"
                >
                  Open Settings
                </button>
              )}
            </div>
          )}
        </div>

        {error && (
          <div className="mt-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">
            {error}
          </div>
        )}
        {phase === "unconfigured" && (
          <div className="mt-3 rounded-xl bg-card p-4">
            <div className="mb-3 text-[13px] text-ink-secondary">
              Paste a Box token from box.ascii.dev to give this bot a cloud computer — it spins up right here.
            </div>
            <ApiKeyRow
              section="box"
              label="Box token"
              placeholder="Token from box.ascii.dev"
              onSaved={(configured) => configured && setRetry((n) => n + 1)}
            />
          </div>
        )}

        {/* Cloud-only actions */}
        {phase === "ready" && (
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => run("join")}
              disabled={pending === "join"}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-raised py-2 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-50"
            >
              {pending === "join" ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />}
              Open desktop
            </button>
            {boxState !== "archived" && (
              <button
                onClick={() => run("sleep")}
                disabled={pending === "sleep"}
                className="flex items-center justify-center gap-2 rounded-lg bg-raised px-3 py-2 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-50"
                title="Put the computer to sleep"
              >
                {pending === "sleep" ? <Loader2 size={14} className="animate-spin" /> : <Moon size={14} />}
                Sleep
              </button>
            )}
          </div>
        )}

        {/* Computer source */}
        <div className="mt-4 rounded-xl bg-card p-4">
          <div className="text-[15px] font-medium text-ink">Runs on</div>
          <div className="mt-0.5 text-[13px] text-ink-secondary">
            {/* multibot (F5): one-line pitch for the engine browser when picked */}
            {bot.computer === "playwright"
              ? "The bot's own local browser, with logins that persist between runs."
              : `${bot.computer ? "" : "Auto: the cloud box when one exists, else this Mac. "}Pick where this bot's computer lives.`}
          </div>
          <div className="mt-3 flex overflow-hidden rounded-lg border border-hairline/40">
            {(
              [
                ["cloud", "Cloud box"],
                ["local", "This Mac"],
                // multibot (F5): the bot's engine browser — all drivers, all platforms
                ["playwright", "Bot browser"],
                ["off", "Off"],
              ] as const
            ).map(([mode, label], i) => (
              <button
                key={mode}
                onClick={() => dispatch({ type: "updateBot", botId: bot.id, patch: { computer: mode } })}
                className={cn(
                  "flex-1 py-1.5 text-[13px]",
                  i > 0 && "border-l border-hairline/40",
                  bot.computer === mode
                    ? "bg-raised text-ink"
                    : "text-ink-secondary hover:bg-raised/60 hover:text-ink",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Routines */}
        <div className="mt-4 rounded-xl bg-card p-4">
          <div className="flex items-center gap-2 text-[15px] font-medium text-ink">
            <CalendarClock size={16} className="text-ink-secondary" />
            Routines
          </div>
          <div className="mt-0.5 text-[13px] text-ink-secondary">
            Routines are recurring tasks this agent runs on a schedule.
          </div>
          {/* multibot: F6 — boty na driverze slafy dostają żywy panel rutyn
              (gate jak w SettingsPanel); reszta floty zostaje na stubie. */}
          {state.instances.find((i) => i.instanceId === bot.modelSelection.instanceId)
            ?.driverKind === "slafy" ? (
            <button
              onClick={() => dispatch({ type: "toggleRoutines", open: true })}
              className="mt-3 w-full rounded-lg bg-raised py-2 text-[13px] text-ink hover:bg-raised-hover"
            >
              Manage Routines
            </button>
          ) : (
            <button
              disabled
              className="mt-3 w-full cursor-not-allowed rounded-lg bg-raised py-2 text-[13px] text-ink-secondary opacity-60"
              title="Coming soon"
            >
              Create Routine
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
