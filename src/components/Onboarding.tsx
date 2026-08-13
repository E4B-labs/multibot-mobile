import { useEffect, useState } from "react";
import { Check, AlertTriangle, Loader2, Mic } from "lucide-react";
import { MausAvatar } from "./Avatar";
import { identifyEmail, setEmailGateDone, track } from "@/lib/analytics";
import { useStore } from "@/state/store";
import { cn } from "@/lib/cn";

// Three-step first-run onboarding: who you are (email), what's installed
// (live engine checks from the harness), what the app may use (TCC).
// Every check is skippable — onboarding must never brick the app.

// multibot: F11 — czwarta ścieżka w kroku "Your engines": bot na silniku slafy
// z własnym kluczem API, zero CLI. Kolejność jest twarda: NAJPIERW bot harnessu
// (POST /api/bots → PATCH modelSelection na instancję "slafy"), bo id bota w
// silniku wywodzi się z jego threadId (`mb-<threadId>`, server/drivers/slafy.ts).
// Dopiero POTEM klucz: engine `set_provider` robi `_require(bot_id)`
// (engine/server/app.py), więc bota silnika zakładamy jawnie jak ensureBot
// w slafy.ts (POST /api/engine/bots, 409 = już jest = sukces) i strzelamy
// POST /api/engine/provider/mb-<threadId>. Silnik offline (502/503/sieć) NIE
// blokuje flow — bot harnessu już stoi, klucz można dodać później w Settings.
// Wersja minimalna EngineProviderCard: bez base URL, więc i bez "custom".
const BYOK_PROVIDERS = ["openrouter", "anthropic", "openai"] as const;
const BYOK_LABELS: Record<(typeof BYOK_PROVIDERS)[number], string> = {
  openrouter: "OpenRouter",
  anthropic: "Anthropic",
  openai: "OpenAI",
};

// Konwencja błędów jak lokalne api() w AppSettingsPanel: silnik oddaje `{detail}`
// (FastAPI), przelotka `{error}`; `status` odróżnia offline od błędu usera.
async function jfetch(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(path, { headers: { "content-type": "application/json" }, ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = typeof body.detail === "string" ? body.detail : undefined;
    const err = new Error(detail ?? body.error ?? `${res.status} ${res.statusText}`) as Error & {
      status?: number;
    };
    err.status = res.status;
    throw err;
  }
  return body;
}

type InstanceRow = {
  instanceId: string;
  driverKind: string;
  displayName: string;
  snapshot: { state: "available" | "unavailable"; reason?: string; version?: string | null; authenticated?: boolean };
};

const isElectron = navigator.userAgent.includes("Electron");

function StatusRow({
  ok,
  warn,
  title,
  detail,
}: {
  ok: boolean;
  warn?: boolean;
  title: string;
  detail: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl bg-card p-3.5">
      <span
        className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full ${
          ok ? "bg-[#00c97222] text-[#38d591]" : warn ? "bg-[#ff980022] text-[#ff9800]" : "bg-raised text-ink-secondary"
        }`}
      >
        {ok ? <Check size={14} /> : <AlertTriangle size={13} />}
      </span>
      <div className="min-w-0">
        <div className="text-[14px] font-medium text-ink">{title}</div>
        <div className="mt-0.5 text-[12.5px] leading-relaxed text-ink-secondary">{detail}</div>
      </div>
    </div>
  );
}

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [instances, setInstances] = useState<InstanceRow[] | null>(null);
  const [perms, setPerms] = useState<{ mic: string } | null>(null);
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());

  // multibot: F11 — BYOK (nagłówek nad BYOK_PROVIDERS). Onboarding renderuje się
  // wewnątrz StoreProvider, więc dispatch jest pod ręką; SSE frame `{kind:"bot"}`
  // tylko PATCHUJE znane boty (botPatched → updateBot), więc świeżego bota
  // dokładamy do store sami, wzorem duplicateBot.
  const { dispatch } = useStore();
  const [byokOpen, setByokOpen] = useState(false);
  const [byokProvider, setByokProvider] = useState<(typeof BYOK_PROVIDERS)[number]>("openrouter");
  const [byokModel, setByokModel] = useState("openrouter/auto");
  const [byokKey, setByokKey] = useState("");
  const [byokBusy, setByokBusy] = useState(false);
  const [byokDone, setByokDone] = useState<"saved" | "offline" | null>(null);
  const [byokError, setByokError] = useState<string | null>(null);

  const createByokBot = async () => {
    if (byokBusy || !byokModel.trim()) return;
    setByokBusy(true);
    setByokError(null);
    try {
      // 1. bot harnessu — threadId wyznacza id bota w silniku
      const { bot } = await jfetch("/api/bots", { method: "POST" });
      const { bot: patched } = await jfetch(`/api/bots/${bot.id}`, {
        method: "PATCH",
        body: JSON.stringify({ modelSelection: { instanceId: "slafy", model: "hermes-agent" } }),
      });
      // odpowiedź PATCH nie niesie messages — sklejamy jak duplicateBot
      dispatch({ type: "botAdded", bot: { ...bot, ...patched, messages: bot.messages } });
      track("onboarding_byok_bot_created");
      // 2. klucz — dopiero po bocie; silnik offline nie blokuje flow
      try {
        const engineBotId = `mb-${bot.threadId}`;
        const mk = await fetch("/api/engine/bots", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: engineBotId, name: engineBotId }),
        });
        if (!mk.ok && mk.status !== 409) {
          throw Object.assign(new Error(`HTTP ${mk.status}`), { status: mk.status });
        }
        await jfetch(`/api/engine/provider/${engineBotId}`, {
          method: "POST",
          body: JSON.stringify({
            provider: byokProvider,
            model: byokModel.trim(),
            ...(byokKey.trim() ? { api_key: byokKey.trim() } : {}),
          }),
        });
        setByokKey("");
        setByokDone("saved");
      } catch (e) {
        const status = (e as { status?: number }).status;
        if (status === 502 || status === 503 || status === undefined) setByokDone("offline");
        else setByokError(e instanceof Error ? e.message : String(e));
      }
    } catch (e) {
      setByokError(e instanceof Error ? e.message : String(e));
    } finally {
      setByokBusy(false);
    }
  };

  const saveProfile = () => {
    identifyEmail(email.trim().toLowerCase());
    // persisted server-side (~/.openmausbot/config.json) — the sidebar
    // footer reads it back through /api/config
    void fetch("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: { name: name.trim(), email: email.trim().toLowerCase() } }),
    }).catch(() => {});
    setStep(1);
  };

  useEffect(() => {
    track("onboarding_step", { step });
    if (step === 1 && !instances) {
      fetch("/api/instances")
        .then((r) => r.json())
        .then((d) => setInstances(d.instances ?? []))
        .catch(() => setInstances([]));
    }
    if (step === 2 && isElectron) {
      const poll = () => window.ogb?.permStatus?.().then(setPerms).catch(() => {});
      poll();
      // keep polling — the user may grant in System Settings and come back
      const t = setInterval(poll, 2000);
      return () => clearInterval(t);
    }
  }, [step, instances]);

  const finish = () => {
    track("onboarding_completed", {
      engines_available: instances?.filter((i) => i.snapshot.state === "available").length ?? -1,
      mic: perms?.mic ?? "n/a",
    });
    setEmailGateDone("submitted");
    onDone();
  };

  const byKind = (kind: string) => instances?.find((i) => i.driverKind === kind);
  const claude = byKind("claudeAgent");
  const codex = byKind("codex");
  const grok = byKind("grokAgent");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-app">
      <div className="flex w-[460px] flex-col rounded-2xl border border-hairline/40 bg-panel p-8">
        {step === 0 && (
          <div className="flex flex-col items-center">
            <MausAvatar color="green" state="happy" size={72} />
            <h1 className="mt-4 text-[20px] font-semibold text-ink">Welcome to OpenMausBot</h1>
            <p className="mt-1.5 text-center text-[14px] leading-relaxed text-ink-secondary">
              Bots that do real work on their own computer. Tell us who you are
              and we&rsquo;ll let you know when big things ship.
            </p>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="mt-5 w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2.5 text-[15px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none"
            />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && valid && saveProfile()}
              placeholder="you@example.com"
              className="mt-3 w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2.5 text-[15px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none"
            />
            <button
              onClick={saveProfile}
              disabled={!valid}
              className="mt-3 w-full rounded-lg bg-accent py-2.5 text-[15px] font-medium text-white disabled:opacity-40"
            >
              Continue
            </button>
            <button
              onClick={() => {
                track("email_skipped");
                setStep(1);
              }}
              className="mt-3 text-[12px] text-ink-secondary hover:text-ink"
            >
              Maybe later
            </button>
          </div>
        )}

        {step === 1 && (
          <div className="flex flex-col">
            <h1 className="text-[18px] font-semibold text-ink">Your engines</h1>
            <p className="mt-1 text-[13.5px] text-ink-secondary">
              Bots run on the AI tools already on this Mac — here&rsquo;s what we found.
            </p>
            <div className="mt-4 flex flex-col gap-2.5">
              {!instances ? (
                <div className="flex items-center gap-2 py-6 text-ink-secondary">
                  <Loader2 size={16} className="animate-spin" /> Checking…
                </div>
              ) : (
                <>
                  <StatusRow
                    ok={claude?.snapshot.state === "available"}
                    warn
                    title={`Claude Code ${claude?.snapshot.version ? `· ${claude.snapshot.version.split(" ")[0]}` : ""}`}
                    detail={
                      claude?.snapshot.state === "available"
                        ? claude.snapshot.authenticated
                          ? "Installed and signed in — ready to power bots."
                          : "Installed. Run `claude` once in a terminal to sign in."
                        : "Not found. Install: npm i -g @anthropic-ai/claude-code"
                    }
                  />
                  <StatusRow
                    ok={codex?.snapshot.state === "available"}
                    warn
                    title={`Codex ${codex?.snapshot.version ? `· ${codex.snapshot.version.replace("codex-cli ", "")}` : ""}`}
                    detail={
                      codex?.snapshot.state === "available"
                        ? "Installed — bots can run on Codex too."
                        : "Optional. Install: npm i -g @openai/codex"
                    }
                  />
                  <StatusRow
                    ok={grok?.snapshot.state === "available"}
                    warn
                    title={`Grok Build ${grok?.snapshot.version ? `· ${grok.snapshot.version.split(" ")[1]}` : ""}`}
                    detail={
                      grok?.snapshot.state === "available"
                        ? grok.snapshot.authenticated
                          ? "Installed and signed in — bots can run on Grok too."
                          : "Installed. Run `grok login` in a terminal to sign in."
                        : "Optional. Install: curl -fsSL https://x.ai/cli/install.sh | bash"
                    }
                  />

                  {/* multibot: F11 — BYOK: bot na lokalnym silniku z własnym kluczem */}
                  {byokDone ? (
                    <div className="flex items-start gap-3 rounded-xl bg-card p-3.5">
                      <span
                        className={cn(
                          "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full",
                          byokDone === "saved" ? "bg-success/15 text-success" : "bg-raised text-ink-secondary",
                        )}
                      >
                        {byokDone === "saved" ? <Check size={14} /> : <AlertTriangle size={13} />}
                      </span>
                      <div className="min-w-0">
                        <div className="text-[14px] font-medium text-ink">Slafy bot created</div>
                        <div className="mt-0.5 text-[12.5px] leading-relaxed text-ink-secondary">
                          {byokDone === "saved"
                            ? "Key saved — the bot is in your sidebar, ready to chat."
                            : "Engine offline — the bot is in your sidebar; add your key later in its Settings."}
                        </div>
                      </div>
                    </div>
                  ) : !byokOpen ? (
                    <button
                      onClick={() => setByokOpen(true)}
                      className="rounded-xl bg-card p-3.5 text-left hover:bg-raised/50"
                    >
                      <div className="text-[14px] font-medium text-ink">Use your own key (local engine)</div>
                      <div className="mt-0.5 text-[12.5px] leading-relaxed text-ink-secondary">
                        No CLI needed — a bot on the local Slafy engine calling OpenRouter, Anthropic
                        or OpenAI with your API key.
                      </div>
                    </button>
                  ) : (
                    <div className="rounded-xl bg-card p-3.5">
                      <div className="text-[14px] font-medium text-ink">Use your own key (local engine)</div>
                      <div className="mt-2.5 flex overflow-hidden rounded-lg border border-hairline/40">
                        {BYOK_PROVIDERS.map((p, i) => (
                          <button
                            key={p}
                            onClick={() => setByokProvider(p)}
                            className={cn(
                              "flex-1 py-1.5 text-[13px]",
                              i > 0 && "border-l border-hairline/40",
                              byokProvider === p
                                ? "bg-raised text-ink"
                                : "text-ink-secondary hover:bg-raised/60 hover:text-ink",
                            )}
                          >
                            {BYOK_LABELS[p]}
                          </button>
                        ))}
                      </div>
                      <input
                        value={byokModel}
                        onChange={(e) => setByokModel(e.target.value)}
                        placeholder="openrouter/auto"
                        className="mt-2.5 w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none"
                      />
                      <div className="mt-2.5 flex gap-2">
                        <input
                          type="password"
                          value={byokKey}
                          onChange={(e) => setByokKey(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && createByokBot()}
                          placeholder="sk-…  (or add it later in Settings)"
                          autoComplete="off"
                          className="w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none"
                        />
                        <button
                          onClick={createByokBot}
                          disabled={byokBusy || !byokModel.trim()}
                          className="flex w-[96px] shrink-0 items-center justify-center gap-1.5 rounded-lg bg-raised py-2 text-[13px] text-ink hover:bg-raised-hover disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {byokBusy ? <Loader2 size={13} className="animate-spin" /> : "Create bot"}
                        </button>
                      </div>
                      {byokError && <div className="mt-2 text-[12px] text-danger">{byokError}</div>}
                    </div>
                  )}
                </>
              )}
            </div>
            <button
              onClick={() => (isElectron ? setStep(2) : finish())}
              className="mt-5 w-full rounded-lg bg-accent py-2.5 text-[15px] font-medium text-white"
            >
              Continue
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col">
            <h1 className="text-[18px] font-semibold text-ink">Permissions</h1>
            <p className="mt-1 text-[13.5px] text-ink-secondary">
              Optional, and only ever used when you ask for the feature.
            </p>
            <div className="mt-4 flex flex-col gap-2.5">
              <div className="flex items-center justify-between gap-3 rounded-xl bg-card p-3.5">
                <div className="flex items-start gap-3">
                  <Mic size={18} className="mt-0.5 shrink-0 text-ink-secondary" />
                  <div>
                    <div className="text-[14px] font-medium text-ink">Microphone & speech</div>
                    <div className="mt-0.5 text-[12.5px] text-ink-secondary">
                      Voice dictation into the composer, transcribed on-device.
                    </div>
                  </div>
                </div>
                {perms?.mic === "granted" ? (
                  <Check size={16} className="shrink-0 text-[#38d591]" />
                ) : perms?.mic === "denied" || perms?.mic === "restricted" ? (
                  <button
                    onClick={() => window.ogb?.permOpenSettings?.("mic")}
                    className="shrink-0 rounded-lg bg-raised px-3 py-1.5 text-[13px] text-ink hover:bg-raised-hover"
                  >
                    Open Settings
                  </button>
                ) : (
                  <button
                    onClick={() =>
                      window.ogb?.permRequestMic?.().then(() => window.ogb?.permStatus?.().then(setPerms))
                    }
                    className="shrink-0 rounded-lg bg-raised px-3 py-1.5 text-[13px] text-ink hover:bg-raised-hover"
                  >
                    Enable
                  </button>
                )}
              </div>
              {/* Screen Recording deliberately has no row here: macOS 15+
                  makes a pre-grant unreliable (per-process status caching,
                  helper misattribution, periodic re-prompts) — the OS flow
                  triggers on the first real capture in the Computer panel,
                  which is the moment the user has context for the dialog. */}
            </div>
            <button onClick={finish} className="mt-5 w-full rounded-lg bg-accent py-2.5 text-[15px] font-medium text-white">
              Start using OpenMausBot
            </button>
            <button onClick={finish} className="mt-3 text-[12px] text-ink-secondary hover:text-ink">
              Skip for now
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
