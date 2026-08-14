// The bot's computer, in the right-side slot. H1/H2 (server/hosted-computer.ts)
// give every bot exactly one computer: a persistent Linux desktop in a
// container, alive from bot creation to bot deletion. There is no source
// picker and no "off" — opening this panel attaches to a screen that is
// already running, it never starts or stops anything.
//
// The screen itself is the container's own noVNC, proxied by the harness so
// the client never learns the container port — rendered here in a plain
// <iframe>, no VNC client of our own. H5 layers a short input lease on top:
// the agent owns input by default; the user can take it, see-through
// continues either way (agent can always watch, never blocked from reading).
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, Maximize2, Settings, X } from "lucide-react";
import { useStore, type Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import { authFetch } from "@/lib/auth";
import { useLanguage } from "@/lib/language";
import { TeachCard } from "./SkillsPanel";

async function api(path: string, init?: RequestInit): Promise<any> {
  const res = await authFetch(path, { headers: { "content-type": "application/json" }, ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  return body;
}

/** Straight from the server (server/hosted-computer.ts ComputerState). */
export type ComputerState = "provisioning" | "ready" | "recovering" | "error";
/** H5 input lease (server/computer-control.ts). */
export type ControlOwner = "agent" | "user";

/** State → the one label PLAN-COMPUTER.md H4 allows for it. */
export function computerStateLabel(state: ComputerState, polish: boolean): string {
  switch (state) {
    case "provisioning":
      return polish ? "Uruchamianie komputera…" : "Starting computer…";
    case "ready":
      return polish ? "Komputer gotowy" : "Computer ready";
    case "recovering":
      return polish ? "Wznawianie…" : "Recovering…";
    case "error":
      return polish ? "Błąd komputera" : "Computer error";
  }
}

/** The noVNC iframe src. view_only=1 iff the agent (not this viewer) holds
 *  the input lease — H5: "When the user does not hold the lease the iframe
 *  is view_only=1." */
export function computerVncSrc(botId: string, controlOwner: ControlOwner): string {
  const base = `/api/bots/${botId}/computer/vnc/vnc.html?autoconnect=1&resize=scale&path=api/bots/${botId}/computer/vnc/websockify`;
  return controlOwner === "agent" ? `${base}&view_only=1` : base;
}

const POLL_MS = 4000;
// server lease (computer-control.ts LEASE_MS) is 30s; renew at a third of
// that so a slow tick never lets it lapse
const RENEW_MS = 10_000;

export function ComputerPanel({ bot }: { bot: Bot }) {
  const { dispatch } = useStore();
  const polish = useLanguage() === "pl";
  const [computerState, setComputerState] = useState<ComputerState>("provisioning");
  const [detail, setDetail] = useState<string | null>(null);
  const [owner, setOwner] = useState<ControlOwner>("agent");
  const [controlPending, setControlPending] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const ownerRef = useRef<ControlOwner>("agent");
  ownerRef.current = owner;

  // poll the harness for the container's state; ready/provisioning/
  // recovering/error only — never a user-facing "off"
  useEffect(() => {
    let alive = true;
    const poll = () =>
      api(`/api/bots/${bot.id}/computer`)
        .then((r) => {
          if (!alive) return;
          setComputerState(r.state);
          setDetail(r.detail ?? null);
        })
        .catch((e) => {
          if (alive) {
            setComputerState("error");
            setDetail(e instanceof Error ? e.message : String(e));
          }
        });
    void poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [bot.id]);

  // sync who currently holds the input lease when the panel opens or the
  // bot changes; release it on the way out so a closed tab (or a bot
  // switch mid-takeover) can never hold the computer hostage
  useEffect(() => {
    let alive = true;
    setOwner("agent");
    api(`/api/bots/${bot.id}/computer/control`)
      .then((r) => alive && setOwner(r.owner))
      .catch(() => {});
    const botId = bot.id;
    return () => {
      alive = false;
      if (ownerRef.current === "user") {
        void api(`/api/bots/${botId}/computer/control/release`, { method: "POST" }).catch(() => {});
      }
    };
  }, [bot.id]);

  // renew the lease on a timer while the user holds it — the lease is
  // short by design, so it must be renewed while active or it expires
  useEffect(() => {
    if (owner !== "user") return;
    const timer = setInterval(() => {
      api(`/api/bots/${bot.id}/computer/control/renew`, { method: "POST" })
        .then((r) => setOwner(r.owner))
        .catch(() => setOwner("agent"));
    }, RENEW_MS);
    return () => clearInterval(timer);
  }, [owner, bot.id]);

  // Escape closes fullscreen only — it never touches the computer itself
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  const acquireControl = () => {
    setControlPending(true);
    api(`/api/bots/${bot.id}/computer/control/acquire`, { method: "POST" })
      .then((r) => setOwner(r.owner))
      .catch(() => {})
      .finally(() => setControlPending(false));
  };
  const releaseControl = () => {
    setControlPending(true);
    api(`/api/bots/${bot.id}/computer/control/release`, { method: "POST" })
      .then((r) => setOwner(r.owner))
      .catch(() => {})
      .finally(() => setControlPending(false));
  };

  const controlButton = computerState === "ready" && (
    <button
      type="button"
      onClick={owner === "user" ? releaseControl : acquireControl}
      disabled={controlPending}
      className={cn(
        "rounded-lg px-3 py-1.5 text-[13px] font-medium disabled:opacity-50",
        owner === "user" ? "bg-accent text-white" : "bg-raised text-ink hover:bg-raised-hover",
      )}
    >
      {owner === "user" ? (polish ? "Oddaj sterowanie" : "Hand back") : polish ? "Przejmij sterowanie" : "Take control"}
    </button>
  );

  const screen = (fullscreenView: boolean) =>
    computerState === "ready" ? (
      <div className="relative h-full w-full">
        <iframe
          title={polish ? "Ekran bota" : "Bot screen"}
          src={computerVncSrc(bot.id, owner)}
          className="h-full w-full border-0"
        />
        {/* view-only screen: clicks land nowhere useful, so use them to expand */}
        {owner === "agent" && !fullscreenView && (
          <button
            type="button"
            aria-label={polish ? "Pełny ekran" : "Full screen"}
            onClick={() => setFullscreen(true)}
            className="absolute inset-0 cursor-zoom-in"
          />
        )}
      </div>
    ) : (
      <div className="flex flex-col items-center gap-2 px-6 text-center text-ink-secondary">
        {computerState === "error" ? <AlertTriangle size={22} /> : <Loader2 size={18} className="animate-spin" />}
        <span className="text-[12px]">{computerStateLabel(computerState, polish)}</span>
        {detail && computerState !== "provisioning" && <span className="text-[11px] opacity-70">{detail}</span>}
      </div>
    );

  return (
    <>
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
          <span className="text-[15px] font-semibold text-ink">{polish ? "Komputer bota" : "Bot computer"}</span>
          <button
            onClick={() => dispatch({ type: "toggleComputer", open: false })}
            className="rounded-md p-1 text-ink-secondary hover:bg-raised hover:text-ink"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-1 flex-col px-5 pb-5">
          {/* Jedna maszyna na całą instalację — bez tego użytkownik zobaczy ten
              sam pulpit u każdego bota i uzna to za błąd. */}
          <div className="mt-2 text-[12px] text-ink-secondary">
            {polish
              ? "Jeden komputer, wspólny dla wszystkich botów — logowania i pliki widzą wszystkie."
              : "One computer, shared by all bots — logins and files are visible to every one of them."}
          </div>
          <div className="mb-1.5 mt-2 flex items-center justify-between text-[13px] text-ink-secondary">
            <span>{polish ? "Ekran bota" : "Bot screen"}</span>
            <button
              type="button"
              onClick={() => setFullscreen(true)}
              className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium hover:bg-raised hover:text-ink"
            >
              <Maximize2 size={12} />
              {polish ? "Pełny ekran" : "Full screen"}
            </button>
          </div>

          <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl bg-card">
            {!fullscreen && screen(false)}
          </div>

          {controlButton && <div className="mt-3 flex justify-end">{controlButton}</div>}

          <TeachCard
            engineBotId={`mb-${bot.threadId}`}
            onSkillCreated={() => {}}
            polish={polish}
            computerReady={computerState === "ready"}
            notReadyLabel={computerStateLabel(computerState, polish)}
            onStartControl={acquireControl}
            onStopControl={releaseControl}
          />
        </div>
      </aside>

      {fullscreen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-app">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-[15px] font-semibold text-ink">{polish ? "Ekran bota" : "Bot screen"}</span>
            <div className="flex items-center gap-2">
              {controlButton}
              <button
                onClick={() => setFullscreen(false)}
                className="rounded-md p-1 text-ink-secondary hover:bg-raised hover:text-ink"
              >
                <X size={18} />
              </button>
            </div>
          </div>
          <div className="flex flex-1 items-center justify-center overflow-hidden">{screen(true)}</div>
        </div>
      )}
    </>
  );
}
