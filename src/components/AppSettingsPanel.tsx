// App-level settings, in the right-side slot: who you are + credentials
// shared by all bots. Per-bot settings (name, persona, model, computer)
// live in SettingsPanel; contextual Box-token entry stays in ComputerPanel.
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { useStore } from "@/state/store";
import { ApiKeyRow } from "./ApiKeys";
import { useUpdaterState } from "@/lib/updater";
import { cn } from "@/lib/cn";

// multibot: F10 — import profilu Hermesa do silnika slafy. UI gada wyłącznie z
// przelotką harnessu (`server/engine/proxy.ts`: `/api/engine/<rest>` → `/api/<rest>`):
//   POST /api/engine/import/inspect {source} — podgląd bez kopiowania
//     (engine/server/importer.py `inspect`); katalog `profiles/` w źródle =
//     Hermes ROOT, odpowiedź niesie `profiles: [nazwy]` i wtedy dociągamy
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

function HermesImport() {
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
      <div className="text-[15px] font-medium text-ink">Import from Hermes</div>
      <div className="mt-0.5 text-[13px] text-ink-secondary">
        Copy an existing Hermes profile into the engine — SOUL, memory and chat history come along.
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
            <div className="mb-1 text-[12px] text-ink-secondary">Bot id in the engine</div>
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
          Imported as engine bot <span className="text-ink">&ldquo;{done.id}&rdquo;</span> — SOUL,
          memory and chat history copied; its skills are now shared with every engine bot. It
          won&rsquo;t appear as a chat here on its own — create a new bot with the slafy driver to
          use it.
        </div>
      )}

      {error && <div className="mt-2 text-[12px] text-danger">{error}</div>}
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
    void fetch("/api/config", {
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

        <HermesImport />

        <UpdatesRow />
      </div>
    </aside>
  );
}
