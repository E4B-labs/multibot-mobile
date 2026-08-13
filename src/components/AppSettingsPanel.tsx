// App-level settings, in the right-side slot: who you are + credentials
// shared by all bots. Per-bot settings (name, persona, model, computer)
// live in SettingsPanel; contextual Box-token entry stays in ComputerPanel.
import { Loader2, Plus, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useStore } from "@/state/store";
import { ApiKeyRow } from "./ApiKeys";
import { useUpdaterState } from "@/lib/updater";
import { cn } from "@/lib/cn";
import { authFetch, setAuthToken } from "@/lib/auth";
// multibot: F11 — status silnika dla EngineStatusRow
import { engineOnline } from "@/lib/engineStatus";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
}

// multibot: F10 — import existing profile into local service. UI gada wyłącznie z
// przelotką harnessu (`server/engine/proxy.ts`: `/api/engine/<rest>` → `/api/<rest>`):
//   POST /api/engine/import/inspect {source} — podgląd bez kopiowania
//     (engine/server/importer.py `inspect`); katalog `profiles/` w źródle =
//     profile ROOT, odpowiedź niesie `profiles: [nazwy]` i wtedy dociągamy
//     inspect per podprofil (`<root>/profiles/<nazwa>`, mieszane separatory
//     łyka pathlib), 422 = to nie profil,
//   POST /api/engine/import {source, bot_id} — kopia profilu jako bot silnika
//     (201 = bot dict {id, name, ...}); 409 = id zajęte, 422 = złe id
//     (regex `^[a-z0-9][a-z0-9_-]{0,63}$`, engine/server/bots.py).
// Import tworzy WYŁĄCZNIE bota silnika — czaty tej apki bindują boty per wątek
// (`mb-<threadId>`, server/drivers/slafy.ts), więc sukces mówi to wprost i
// odsyła do "create a new bot with the slafy driver". 502/503 z przelotki =
// konwencja "Engine offline" (jak EngineAutonomy), reszta błędów = `detail`.

/** Mirror of engine `importer.inspect()` (engine/server/importer.py). */
interface InspectOut {
  name: string;
  has_soul: boolean;
  has_memory: boolean;
  memory_facts: number;
  has_markdown_memory: boolean;
  cron_jobs: number;
  has_env: boolean;
  skills: number;
  source: string;
  profiles?: string[];
}

// Jak w RoutinesPanel: własny helper, bo silnik zwraca błędy jako `{detail}`
// (FastAPI), przelotka jako `{error}`; do tego `status`, żeby odróżnić
// 502/503 (Engine offline) od 409/422 (komunikat dla usera).
async function api(path: string, init?: RequestInit): Promise<any> {
  const res = await authFetch(path, { headers: { "content-type": "application/json" }, ...init });
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

/** Bot id z nazwy profilu, dopasowany do regexu silnika. */
function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^[-_]+/, "")
      .slice(0, 64) || "imported"
  );
}

function summary(p: InspectOut): string {
  const parts = [
    p.skills > 0 && `${p.skills} skill${p.skills === 1 ? "" : "s"}`,
    p.has_memory && `${p.memory_facts} memory facts`,
    p.has_markdown_memory && "markdown memory",
    p.cron_jobs > 0 && `${p.cron_jobs} cron jobs`,
    p.has_soul && "SOUL.md",
    p.has_env && ".env",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "empty profile";
}

function ProfileImport() {
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState<"inspect" | "import" | null>(null);
  // found[0] = źródło; przy ROOT-cie dalej idą podprofile z `profiles/`
  const [found, setFound] = useState<InspectOut[] | null>(null);
  const [isRoot, setIsRoot] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [botId, setBotId] = useState("");
  const [done, setDone] = useState<{ id: string; name: string } | null>(null);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fail = (e: unknown) => {
    const status = (e as { status?: number }).status;
    if (status === 502 || status === 503 || status === undefined) setOffline(true);
    else setError(e instanceof Error ? e.message : String(e));
  };

  const select = (p: InspectOut) => {
    setSelected(p.source);
    setBotId(slug(p.name));
    setDone(null);
  };

  const inspect = () => {
    setBusy("inspect");
    setError(null);
    setOffline(false);
    setFound(null);
    setSelected(null);
    setDone(null);
    api("/api/engine/import/inspect", { method: "POST", body: JSON.stringify({ source }) })
      .then(async (root: InspectOut) => {
        // Podprofil bez markerów profilu → 422; pomijamy zamiast wywracać listę.
        const subs = root.profiles?.length
          ? (
              await Promise.all(
                root.profiles.map(
                  (p) =>
                    api("/api/engine/import/inspect", {
                      method: "POST",
                      body: JSON.stringify({ source: `${root.source}/profiles/${p}` }),
                    }).catch(() => null) as Promise<InspectOut | null>,
                ),
              )
            ).filter((p): p is InspectOut => p !== null)
          : [];
        setIsRoot(subs.length > 0);
        setFound([root, ...subs]);
        if (!subs.length) select(root);
      })
      .catch(fail)
      .finally(() => setBusy(null));
  };

  const doImport = () => {
    if (!selected || !botId) return;
    setBusy("import");
    setError(null);
    setOffline(false);
    api("/api/engine/import", {
      method: "POST",
      body: JSON.stringify({ source: selected, bot_id: botId }),
    })
      .then((bot: { id: string; name: string }) => setDone(bot))
      .catch(fail)
      .finally(() => setBusy(null));
  };

  const inputClass =
    "w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none";

  return (
    <div className="mt-4 rounded-xl bg-card p-4">
      <div className="text-[15px] font-medium text-ink">Import existing profile</div>
      <div className="mt-0.5 text-[13px] text-ink-secondary">
        Copy an existing profile into the local service — SOUL, memory and chat history come along.
      </div>

      <div className="mt-3 flex gap-2">
        <input
          className={inputClass}
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder="~/.hermes  or  C:\Users\you\AppData\Local\hermes"
        />
        <button
          onClick={inspect}
          disabled={!source.trim() || busy !== null}
          className="shrink-0 rounded-lg bg-raised px-3 py-1.5 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-40"
        >
          {busy === "inspect" ? "Inspecting…" : "Inspect"}
        </button>
      </div>

      {offline && (
        <div className="mt-3 flex items-center gap-2 text-[13px] text-ink-secondary">
          <span className="size-1.5 rounded-full bg-raised-hover" />
          Engine offline
        </div>
      )}

      {found && (
        <div className="mt-3 flex flex-col gap-1.5">
          {found.map((p, i) => (
            <button
              key={p.source}
              onClick={() => select(p)}
              className={cn(
                "rounded-lg bg-inset px-3 py-2 text-left hover:bg-raised",
                selected === p.source && "ring-2 ring-accent-border",
              )}
            >
              <div className="text-[13px] text-ink">
                {isRoot && i === 0 ? `${p.name} (default profile)` : p.name}
              </div>
              <div className="mt-0.5 text-[12px] text-ink-secondary">{summary(p)}</div>
            </button>
          ))}
        </div>
      )}

      {selected && !done && (
        <div className="mt-3 flex items-end gap-2">
          <label className="block w-full">
            <div className="mb-1 text-[12px] text-ink-secondary">Bot id in the service</div>
            <input
              className={inputClass}
              value={botId}
              onChange={(e) => setBotId(e.target.value)}
            />
          </label>
          <button
            onClick={doImport}
            disabled={!botId || busy !== null}
            className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-40"
          >
            {busy === "import" ? "Importing…" : "Import"}
          </button>
        </div>
      )}

      {done && (
        <div className="mt-3 text-[13px] text-ink-secondary">
          Imported as local bot <span className="text-ink">&ldquo;{done.id}&rdquo;</span> — SOUL,
          memory and chat history copied; its skills are now shared with every local bot. It
          won&rsquo;t appear as a chat here on its own — create a new bot with this custom model to
          use it.
        </div>
      )}

      {error && <div className="mt-2 text-[12px] text-danger">{error}</div>}
    </div>
  );
}

// multibot: F11 — status silnika slafy: jeden GET przy każdym otwarciu panelu
// (mount = otwarcie, panel renderuje się warunkowo w App.tsx), zero pollingu.
// Czemu tu: to jedyne panelowe miejsce "app-level" (per-bot rzeczy żyją w
// SettingsPanel), a sekcje usługi profili już tu mieszkają.
// Kropka: bg-success = działa, bg-raised-hover = konwencja "Engine offline"
// z local service status/import components.
function EngineStatusRow() {
  const [online, setOnline] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void engineOnline().then((ok) => alive && setOnline(ok));
    return () => {
      alive = false;
    };
  }, []);
  return (
    <div className="mt-4 rounded-xl bg-card p-4">
      <div className="text-[15px] font-medium text-ink">Local service</div>
      <div className="mt-0.5 text-[13px] text-ink-secondary">
        Background service for custom models, routines and skills.
      </div>
      <div className="mt-3 flex items-center gap-2 text-[13px] text-ink-secondary">
        <span className={cn("size-1.5 rounded-full", online ? "bg-success" : "bg-raised-hover")} />
        {online === null ? "Checking…" : online ? "Running" : "Service offline"}
      </div>
    </div>
  );
}

/** Name + email, persisted to /api/config {profile} on blur. Prefilled from
 * the current config (the values are echoed back — they're not secrets). */
function ProfileFields() {
  const { state, dispatch } = useStore();
  const [name, setName] = useState(state.config?.profile?.name ?? "");
  const [email, setEmail] = useState(state.config?.profile?.email ?? "");
  // adopt late-arriving config exactly once per open (config loads async)
  useEffect(() => {
    setName(state.config?.profile?.name ?? "");
    setEmail(state.config?.profile?.email ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.config?.profile?.name, state.config?.profile?.email]);

  const save = () => {
    void authFetch("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: { name: name.trim(), email: email.trim().toLowerCase() } }),
    })
      .then((r) => r.json())
      .then((config) => dispatch({ type: "configStatus", config }))
      .catch(() => {});
  };

  const inputClass =
    "w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[14px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none";
  return (
    <div className="flex flex-col gap-3">
      <input value={name} onChange={(e) => setName(e.target.value)} onBlur={save} placeholder="Your name" className={inputClass} />
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        onBlur={save}
        placeholder="you@example.com"
        className={inputClass}
      />
    </div>
  );
}

function AccessTokenSettings() {
  const [token, setToken] = useState("");
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authFetch("/api/auth/token")
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("Unable to load token"))))
      .then((body) => setToken(typeof body.token === "string" ? body.token : ""))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const rotate = () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    authFetch("/api/auth/token/rotate", { method: "POST" })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("Unable to rotate token"))))
      .then((body) => {
        if (typeof body.token !== "string") throw new Error("Server returned no token");
        setToken(body.token);
        setAuthToken(body.token);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  return (
    <div className="mt-4 rounded-xl bg-card p-4">
      <div className="text-[15px] font-medium text-ink">Server access</div>
      <div className="mt-0.5 text-[13px] text-ink-secondary">Token required when connecting from another device.</div>
      <div className="mt-3 flex gap-2">
        <input
          readOnly
          type={shown ? "text" : "password"}
          value={token}
          placeholder="Loading…"
          className="min-w-0 flex-1 rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink outline-none"
        />
        <button onClick={() => setShown((value) => !value)} className="rounded-lg bg-raised px-3 py-2 text-[13px] text-ink hover:bg-raised-hover">
          {shown ? "Hide" : "Show"}
        </button>
      </div>
      <button onClick={rotate} disabled={busy} className="mt-2 rounded-lg bg-raised px-3 py-2 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-50">
        {busy ? "Generating…" : "Generate new token"}
      </button>
      {error && <div className="mt-2 text-[12px] text-danger">{error}</div>}
    </div>
  );
}

function InstallAppSettings() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallEvent(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    setInstalled(window.matchMedia("(display-mode: standalone)").matches);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  const install = async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    setInstallEvent(null);
  };
  const userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const isAppleMobile = /iPhone|iPad|iPod/.test(userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const installHint = isAppleMobile
    ? "iPhone/iPad Safari: Share → Add to Home Screen."
    : /Android/.test(userAgent)
      ? "Android Chrome: ⋮ → Install app or Add to Home screen."
      : /Firefox/.test(userAgent)
        ? "Firefox: open this page in Chrome or Edge to install it as an app."
        : "Chrome/Edge: use the install icon in the address bar or browser menu.";
  return (
    <div className="mt-4 rounded-xl bg-card p-4">
      <div className="text-[15px] font-medium text-ink">Install app</div>
      <div className="mt-0.5 text-[13px] text-ink-secondary">
        {installed
          ? "Multibot is installed on this device."
          : "Use Multibot as a full-screen app on phone or computer."}
      </div>
      {installEvent ? (
        <button onClick={() => void install()} className="mt-3 rounded-lg bg-raised px-3 py-2 text-[13px] text-ink hover:bg-raised-hover">
          Install Multibot
        </button>
      ) : !installed ? (
        <div className="mt-3 text-[12px] text-ink-secondary">
          {installHint}
        </div>
      ) : null}
    </div>
  );
}

interface CustomModel {
  id: string;
  displayName: string;
  baseUrl: string;
  model: string;
  hasKey: boolean;
}

function readCustomModel(value: any): CustomModel {
  const model = value?.model;
  return {
    id: String(value?.id ?? ""),
    displayName: String(value?.displayName ?? value?.name ?? value?.id ?? "Custom model"),
    baseUrl: String(value?.baseUrl ?? value?.base_url ?? model?.baseUrl ?? model?.base_url ?? ""),
    model: String(value?.modelId ?? (typeof model === "string" ? model : model?.default) ?? value?.defaultModel ?? ""),
    hasKey: Boolean(value?.hasKey ?? value?.configured ?? value?.keyConfigured),
  };
}

function CustomModels() {
  const { dispatch } = useStore();
  const [models, setModels] = useState<CustomModel[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputClass =
    "w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none";

  const reload = () =>
    api("/api/models/custom")
      .then((body) => {
        const rows = Array.isArray(body) ? body : body.models ?? [];
        setModels(rows.map(readCustomModel).filter((item: CustomModel) => item.id));
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));

  useEffect(() => {
    reload();
    // one load per panel mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshInstances = () =>
    api("/api/instances")
      .then(({ instances }) => dispatch({ type: "instances", instances }))
      .catch(() => {});

  const save = () => {
    const name = displayName.trim();
    const url = baseUrl.trim();
    const modelId = model.trim();
    if (busy || !name || !url || !modelId || !apiKey.trim()) return;
    setBusy(true);
    setError(null);
    const id = slug(name);
    api(`/api/models/custom/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify({ displayName: name, baseUrl: url, model: modelId, apiKey: apiKey.trim() }),
    })
      .then(() => {
        setDisplayName("");
        setBaseUrl("");
        setModel("");
        setApiKey("");
        reload();
        refreshInstances();
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  const remove = (id: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    api(`/api/models/custom/${encodeURIComponent(id)}`, { method: "DELETE" })
      .then(() => {
        setModels((items) => items.filter((item) => item.id !== id));
        refreshInstances();
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  return (
    <div className="mt-4 rounded-xl bg-card p-4">
      <div className="text-[15px] font-medium text-ink">Models</div>
      <div className="mt-0.5 text-[13px] text-ink-secondary">
        Add custom models by URL. Keys are stored locally and never shown again.
      </div>
      {models.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          {models.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg bg-inset px-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-[13px] font-medium text-ink">{item.displayName}</div>
                <div className="truncate text-[11px] text-ink-secondary">
                  {item.model} · {item.baseUrl} · {item.hasKey ? "key saved" : "no key"}
                </div>
              </div>
              <button
                aria-label={`Remove ${item.displayName}`}
                onClick={() => remove(item.id)}
                className="shrink-0 rounded-md p-1.5 text-ink-secondary hover:bg-raised hover:text-danger"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="mt-3 flex flex-col gap-2">
        <input className={inputClass} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Name" />
        <input className={inputClass} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="Base URL · https://…/v1" />
        <input className={inputClass} value={model} onChange={(e) => setModel(e.target.value)} placeholder="Model id · local/model" />
        <div className="flex gap-2">
          <input
            type="password"
            className={inputClass}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="API key"
            autoComplete="off"
          />
          <button
            onClick={save}
            disabled={busy || !displayName.trim() || !baseUrl.trim() || !model.trim() || !apiKey.trim()}
            className="flex w-[78px] shrink-0 items-center justify-center gap-1 rounded-lg bg-raised px-2 py-2 text-[13px] text-ink hover:bg-raised-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <><Plus size={13} />Add</>}
          </button>
        </div>
      </div>
      {error && <div className="mt-2 text-[12px] text-danger">{error}</div>}
    </div>
  );
}

function CommandLineTools() {
  const [cli, setCli] = useState<Array<{ id: string; displayName: string; enabled: boolean; detected: boolean; reason?: string; version?: string }>>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    void api("/api/cli-tools").then(({ tools }) => setCli(tools)).catch(() => {});
  }, []);

  const toggle = (tool: (typeof cli)[number]) => {
    setBusy(tool.id);
    void api(`/api/cli-tools/${encodeURIComponent(tool.id)}`, {
      method: "PUT",
      body: JSON.stringify({ enabled: !tool.enabled }),
    })
      .then(({ tool: saved }) => setCli((items) => items.map((item) => item.id === saved.id ? saved : item)))
      .finally(() => setBusy(null));
  };

  return (
    <div className="mt-4 rounded-xl bg-card p-4">
      <div className="text-[15px] font-medium text-ink">Command-line tools</div>
      <div className="mt-0.5 text-[13px] text-ink-secondary">Allow tools that can run bots on this device.</div>
      <div className="mt-3 flex flex-col gap-1">
        {cli.length === 0 ? (
          <div className="py-2 text-[13px] text-ink-secondary">No command-line tools detected.</div>
        ) : cli.map((item) => (
          <label key={item.id} className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-raised/60">
            <div className="min-w-0">
              <div className="truncate text-[13px] text-ink">{item.displayName}</div>
              <div className="truncate text-[11px] text-ink-secondary">
                {item.detected ? item.version ?? "Detected" : item.reason ?? "Not detected"}
              </div>
            </div>
            <input
              type="checkbox"
              checked={item.enabled}
              disabled={busy === item.id}
              onChange={() => toggle(item)}
              className="size-4 accent-[var(--color-accent)]"
            />
          </label>
        ))}
      </div>
    </div>
  );
}

/** Manual update check row — packaged app only (no bridge in dev). */
function UpdatesRow() {
  const s = useUpdaterState();
  if (!window.ogb?.updater) return null;
  const updater = window.ogb.updater;
  const label =
    s?.status === "checking"
      ? "Checking…"
      : s?.status === "available"
        ? `${s.version} available`
        : s?.status === "downloading"
          ? `Downloading… ${Math.round(s.percent ?? 0)}%`
          : s?.status === "downloaded"
            ? `${s.version} ready — restart to apply`
            : s?.status === "error"
              ? `Check failed: ${s.message ?? "unknown error"}`
              : "You're on the latest version we know of.";
  return (
    <div className="mt-4 rounded-xl bg-card p-4">
      <div className="text-[15px] font-medium text-ink">App updates</div>
      <div className="mt-0.5 text-[13px] text-ink-secondary">{label}</div>
      <div className="mt-3 flex gap-2">
        {s?.status === "available" ? (
          <button
            onClick={() => void updater.download()}
            className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white"
          >
            Download
          </button>
        ) : s?.status === "downloaded" ? (
          <button
            onClick={() => void updater.install()}
            className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white"
          >
            Restart to update
          </button>
        ) : (
          <button
            onClick={() => void updater.check()}
            disabled={s?.status === "checking" || s?.status === "downloading"}
            className="rounded-lg bg-raised px-3 py-1.5 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-40"
          >
            Check for updates
          </button>
        )}
      </div>
    </div>
  );
}

export function AppSettingsPanel() {
  const { dispatch } = useStore();

  return (
    <aside className="animate-panel-in flex h-full w-[400px] shrink-0 flex-col border-l border-hairline/40 bg-panel">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="w-6" />
        <span className="text-[15px] font-semibold text-ink">App Settings</span>
        <button
          onClick={() => dispatch({ type: "toggleAppSettings", open: false })}
          className="rounded-md p-1 text-ink-secondary hover:bg-raised hover:text-ink"
        >
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-5">
        <div className="mt-2 rounded-xl bg-card p-4">
          <div className="text-[15px] font-medium text-ink">Profile</div>
          <div className="mt-0.5 text-[13px] text-ink-secondary">Shown in the sidebar. Saved as you go.</div>
          <div className="mt-4">
            <ProfileFields />
          </div>
        </div>

        <div className="mt-4 rounded-xl bg-card p-4">
          <div className="text-[15px] font-medium text-ink">Connections</div>
          <div className="mt-0.5 text-[13px] text-ink-secondary">
            Shared by all bots. Saving a key reloads providers instantly; keys are stored locally and never
            shown again.
          </div>
          <div className="mt-4 flex flex-col gap-4">
            <ApiKeyRow section="composio" label="Composio Connect key" placeholder="ck_…" />
            <ApiKeyRow
              section="composioApi"
              label="Composio API key (optional)"
              placeholder="ak_…  unlocks the full app catalog"
            />
            <ApiKeyRow section="box" label="Box token" placeholder="Token from box.ascii.dev" />
          </div>
        </div>

        {/* multibot: G2 — server token, masked until explicitly shown. */}
        <AccessTokenSettings />
        <InstallAppSettings />

        {/* multibot: G1 — custom model catalog lives at app level, never per bot. */}
        <CustomModels />
        {/* multibot: G1 — CLI allowlist UI; provisioning actions land in G3. */}
        <CommandLineTools />

        {/* multibot: F11 — status local service above profile import */}
        <EngineStatusRow />

        <ProfileImport />

        <UpdatesRow />
      </div>
    </aside>
  );
}
