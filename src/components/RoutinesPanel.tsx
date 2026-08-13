// multibot: F6 — rutyny silnika slafy w prawym slocie (400px, jak Settings/
// Computer). UI gada wyłącznie z przelotką harnessu (`server/engine/proxy.ts`:
// `/api/engine/<rest>` → `/api/<rest>` silnika):
//   GET    /api/engine/bots/mb-<threadId>/routines            — lista,
//   POST   /api/engine/bots/mb-<threadId>/routines            — create,
//   PATCH  /api/engine/bots/mb-<threadId>/routines/<rid>      — edit,
//   DELETE /api/engine/bots/mb-<threadId>/routines/<rid>      — delete,
//   POST   /api/engine/bots/mb-<threadId>/routines/<rid>/run  — Run now (ticker ≤60 s),
//   POST   /api/engine/bots/mb-<threadId>/routines/<rid>/webhook — {url, secret};
//     idempotentny: re-POST oddaje TEN SAM sekret (engine/server/routines.py),
//     więc "Show secret" to po prostu ponowny POST.
// Harmonogram waliduje silnik (`parse_schedule`: "every 30m" / cron / ISO) —
// UI tylko składa string i pokazuje 422 z `detail`.
import { useEffect, useState } from "react";
import {
  CalendarClock,
  Check,
  Copy,
  Loader2,
  Pencil,
  Play,
  Plus,
  Trash2,
  Webhook,
  X,
} from "lucide-react";
import { useStore, type Bot } from "@/state/store";
import { cn } from "@/lib/cn";

// Własny helper zamiast `api` ze store: silnik zwraca błędy jako `{detail}`
// (FastAPI), przelotka jako `{error}` — store'owy helper zgubiłby komunikat
// walidacji crona i pokazał gołe "422 Unprocessable Entity".
async function api(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(path, { headers: { "content-type": "application/json" }, ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = typeof body.detail === "string" ? body.detail : undefined;
    throw new Error(detail ?? body.error ?? `${res.status} ${res.statusText}`);
  }
  return body;
}

/** Mirror of engine `_to_routine()` (engine/server/routines.py). */
interface Routine {
  id: string;
  name: string;
  schedule: string | null;
  prompt: string;
  enabled: boolean;
  trigger: { type: string; url: string; events: string[] } | null;
  last_runs: Array<{ at: string; status?: string | null; error?: string | null }>;
}

const inputCls =
  "w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none";

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 text-[13px] text-ink-secondary">{children}</div>;
}

/** Ten sam wzorzec co copy w bloku kodu ChatMarkdown. */
function CopyButton({ text, title }: { text: string; title: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <button
      onClick={copy}
      className="rounded p-1 text-ink-secondary hover:bg-raised hover:text-ink"
      title={title}
    >
      {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
    </button>
  );
}

// Presety harmonogramu → stringi, które silnik parsuje sam ("every 1h" =
// interwał local service; daily/weekly = cron, dzień tygodnia 0-6 z niedzielą=0).
const SCHEDULE_MODES = ["hourly", "daily", "weekly", "custom"] as const;
type ScheduleMode = (typeof SCHEDULE_MODES)[number];
const MODE_LABELS: Record<ScheduleMode, string> = {
  hourly: "Hourly",
  daily: "Daily",
  weekly: "Weekly",
  custom: "Custom",
};
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function RoutineForm({
  engineBotId,
  routine,
  onSaved,
  onCancel,
}: {
  engineBotId: string;
  /** null = create */
  routine: Routine | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(routine?.name ?? "");
  const [prompt, setPrompt] = useState(routine?.prompt ?? "");
  // Edycja startuje w "Custom" z aktualnym harmonogramem — display silnika
  // ("every 60m", "30 9 * * *") jest zarazem poprawnym inputem parse_schedule.
  const [mode, setMode] = useState<ScheduleMode>(routine ? "custom" : "daily");
  const [time, setTime] = useState("09:00");
  const [weekday, setWeekday] = useState(1);
  const [cronText, setCronText] = useState(routine?.schedule ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buildSchedule = (): string | null => {
    if (mode === "hourly") return "every 1h";
    const [h, m] = time.split(":");
    if (mode === "daily") return `${+m} ${+h} * * *`;
    if (mode === "weekly") return `${+m} ${+h} * * ${weekday}`;
    // create: pusty custom = rutyna manualna (tylko Run now / webhook);
    // edit: pusty custom = harmonogram bez zmian (PATCH bez pola `schedule`)
    return cronText.trim() || null;
  };

  const save = () => {
    if (saving || !name.trim() || !prompt.trim()) return;
    setSaving(true);
    setError(null);
    const schedule = buildSchedule();
    const body = { name: name.trim(), prompt: prompt.trim(), ...(schedule ? { schedule } : {}) };
    (routine
      ? api(`/api/engine/bots/${engineBotId}/routines/${routine.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        })
      : api(`/api/engine/bots/${engineBotId}/routines`, {
          method: "POST",
          body: JSON.stringify(body),
        })
    )
      .then(onSaved)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setSaving(false));
  };

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-xl bg-card p-4">
      <div className="text-[15px] font-medium text-ink">
        {routine ? "Edit routine" : "New routine"}
      </div>

      <label className="block">
        <FieldLabel>Name</FieldLabel>
        <input
          className={inputCls}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Morning digest"
        />
      </label>

      <label className="block">
        <FieldLabel>Prompt</FieldLabel>
        <textarea
          className={cn(inputCls, "min-h-[96px] resize-none")}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="What should the bot do each run?"
        />
      </label>

      <div>
        <FieldLabel>Schedule</FieldLabel>
        <div className="flex overflow-hidden rounded-lg border border-hairline/40">
          {SCHEDULE_MODES.map((m, i) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cn(
                "flex-1 py-1.5 text-[13px]",
                i > 0 && "border-l border-hairline/40",
                mode === m ? "bg-raised text-ink" : "text-ink-secondary hover:bg-raised/60 hover:text-ink",
              )}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
        {(mode === "daily" || mode === "weekly") && (
          <div className="mt-2 flex gap-2">
            {mode === "weekly" && (
              <select
                className={inputCls}
                value={weekday}
                onChange={(e) => setWeekday(+e.target.value)}
              >
                {WEEKDAYS.map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </select>
            )}
            <input
              type="time"
              className={inputCls}
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </div>
        )}
        {mode === "custom" && (
          <input
            className={cn(inputCls, "mt-2")}
            value={cronText}
            onChange={(e) => setCronText(e.target.value)}
            placeholder={routine ? "30 9 * * *  (empty = keep current)" : "30 9 * * *  or  every 30m  (empty = manual)"}
          />
        )}
      </div>

      {error && <div className="text-[12px] text-danger">{error}</div>}

      <div className="flex gap-2">
        <button
          onClick={save}
          disabled={saving || !name.trim() || !prompt.trim()}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-raised py-2 text-[13px] text-ink hover:bg-raised-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
          {routine ? "Save" : "Create"}
        </button>
        <button
          onClick={onCancel}
          className="rounded-lg bg-raised px-4 py-2 text-[13px] text-ink-secondary hover:bg-raised-hover hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export function RoutinesPanel({ bot }: { bot: Bot }) {
  const { dispatch } = useStore();
  // Ten sam wzorzec id co local runtime controls: domyślny botPrefix "mb-" z
  // decodeConfig w server/drivers/slafy.ts.
  const engineBotId = `mb-${bot.threadId}`;
  const [status, setStatus] = useState<"loading" | "offline" | "ready">("loading");
  const [routines, setRoutines] = useState<Routine[]>([]);
  // null = lista; "new" = create; Routine = edit
  const [editing, setEditing] = useState<Routine | "new" | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // "<action>:<rid>"
  const [ranId, setRanId] = useState<string | null>(null); // transient "Queued" po Run now
  const [openWebhook, setOpenWebhook] = useState<string | null>(null);
  /** Credentiale webhooka per rutyna, pobrane idempotentnym POST-em. */
  const [webhooks, setWebhooks] = useState<Record<string, { url: string; secret: string }>>({});
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api(`/api/engine/bots/${engineBotId}/routines`).then((rs: Routine[]) => {
      setRoutines(rs);
      setStatus("ready");
    });

  // Panel jest keyowany bot.id w Shell, więc mount = jeden bot. Bot silnika
  // powstaje leniwie przy pierwszej wiadomości (slafy.ts `ensureBot`) — świeży
  // bot bez rozmowy nie ma jeszcze profilu i GET rutyn dałby 404, więc najpierw
  // idempotentny POST /api/bots (409 = już jest = sukces, jak w driverze).
  useEffect(() => {
    let alive = true;
    fetch(`/api/engine/bots`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: engineBotId, name: engineBotId }),
    })
      .then((res) => {
        if (!res.ok && res.status !== 409) throw new Error(`HTTP ${res.status}`);
        return load();
      })
      .catch(() => alive && setStatus("offline"));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showError = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  const runNow = (rid: string) => {
    setBusy(`run:${rid}`);
    setError(null);
    api(`/api/engine/bots/${engineBotId}/routines/${rid}/run`, { method: "POST" })
      .then(() => {
        setRanId(rid);
        setTimeout(() => setRanId((cur) => (cur === rid ? null : cur)), 2500);
      })
      .catch(showError)
      .finally(() => setBusy(null));
  };

  // Bez dialogu potwierdzenia — wzorzec repo (Delete bota w Sidebar też jest
  // bezpośredni), destruktywność sygnalizuje styl danger.
  const remove = (rid: string) => {
    setBusy(`delete:${rid}`);
    setError(null);
    api(`/api/engine/bots/${engineBotId}/routines/${rid}`, { method: "DELETE" })
      .then(() => setRoutines((rs) => rs.filter((r) => r.id !== rid)))
      .catch(showError)
      .finally(() => setBusy(null));
  };

  /** Enable + "Show secret" to ten sam idempotentny POST (sekret nie rotuje). */
  const fetchWebhook = (rid: string) => {
    setBusy(`webhook:${rid}`);
    setError(null);
    api(`/api/engine/bots/${engineBotId}/routines/${rid}/webhook`, { method: "POST" })
      .then((creds: { url: string; secret: string }) => {
        setWebhooks((w) => ({ ...w, [rid]: creds }));
        return load(); // odśwież `trigger` w liście — stan zawsze z silnika
      })
      .catch(showError)
      .finally(() => setBusy(null));
  };

  const lastRunLine = (r: Routine) => {
    const run = r.last_runs[0];
    if (!run) return "No runs yet";
    const when = new Date(run.at).toLocaleString();
    return run.error ? `Last run ${when} — ${run.error}` : `Last run ${when}${run.status ? ` — ${run.status}` : ""}`;
  };

  return (
    <aside className="animate-panel-in flex h-full w-[400px] shrink-0 flex-col border-l border-hairline/40 bg-panel">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <span className="w-[26px]" />
        <span className="text-[15px] font-semibold text-ink">Routines</span>
        <button
          onClick={() => dispatch({ type: "toggleRoutines", open: false })}
          className="rounded-md p-1 text-ink-secondary hover:bg-raised hover:text-ink"
        >
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-5">
        {status === "offline" ? (
          // Konwencja local runtime controls
          <div className="mt-3 flex items-center gap-2 text-[13px] text-ink-secondary">
            <span className="size-1.5 rounded-full bg-raised-hover" />
            Engine offline
          </div>
        ) : status === "loading" ? (
          <div className="flex items-center justify-center gap-2 py-8 text-[13px] text-ink-secondary">
            <Loader2 size={14} className="animate-spin" /> Loading routines…
          </div>
        ) : editing !== null ? (
          <RoutineForm
            engineBotId={engineBotId}
            routine={editing === "new" ? null : editing}
            onSaved={() => {
              setEditing(null);
              load().catch(() => setStatus("offline"));
            }}
            onCancel={() => setEditing(null)}
          />
        ) : routines.length === 0 ? (
          // Empty state w konwencji pustych stanów panelu Computer
          <div className="mt-8 flex flex-col items-center gap-2 px-6 text-center text-ink-secondary">
            <CalendarClock size={22} />
            <div className="text-[13px] font-medium text-ink">No routines yet</div>
            <span className="text-[12px]">
              Routines are recurring tasks this bot runs on a schedule — they run in the background
              even while the app is closed.
            </span>
            <button
              onClick={() => setEditing("new")}
              className="mt-2 rounded-lg bg-raised px-4 py-2 text-[13px] text-ink hover:bg-raised-hover"
            >
              Create Routine
            </button>
          </div>
        ) : (
          <>
            <button
              onClick={() => setEditing("new")}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-raised py-2 text-[13px] text-ink hover:bg-raised-hover"
            >
              <Plus size={14} />
              New routine
            </button>

            {routines.map((r) => {
              const creds = webhooks[r.id];
              const whOpen = openWebhook === r.id;
              return (
                <div key={r.id} className="mt-3 rounded-xl bg-card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-[15px] font-medium text-ink">{r.name || r.id}</div>
                      <div className="mt-0.5 text-[13px] text-ink-secondary">
                        {r.schedule ?? "Manual"}
                        {!r.enabled && " · disabled"}
                      </div>
                      <div className="mt-0.5 truncate text-[12px] text-ink-secondary" title={lastRunLine(r)}>
                        {lastRunLine(r)}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <button
                        onClick={() => runNow(r.id)}
                        disabled={busy === `run:${r.id}`}
                        className="rounded-md p-1.5 text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-50"
                        title="Run now (fires within a minute)"
                      >
                        {busy === `run:${r.id}` ? (
                          <Loader2 size={15} className="animate-spin" />
                        ) : ranId === r.id ? (
                          <Check size={15} className="text-success" />
                        ) : (
                          <Play size={15} />
                        )}
                      </button>
                      <button
                        onClick={() => setOpenWebhook(whOpen ? null : r.id)}
                        className={cn(
                          "rounded-md p-1.5 hover:bg-raised",
                          whOpen || r.trigger ? "text-ink" : "text-ink-secondary hover:text-ink",
                        )}
                        title="Webhook trigger"
                      >
                        <Webhook size={15} />
                      </button>
                      <button
                        onClick={() => setEditing(r)}
                        className="rounded-md p-1.5 text-ink-secondary hover:bg-raised hover:text-ink"
                        title="Edit"
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        onClick={() => remove(r.id)}
                        disabled={busy === `delete:${r.id}`}
                        className="rounded-md p-1.5 text-ink-secondary hover:bg-raised hover:text-danger disabled:opacity-50"
                        title="Delete"
                      >
                        {busy === `delete:${r.id}` ? (
                          <Loader2 size={15} className="animate-spin" />
                        ) : (
                          <Trash2 size={15} />
                        )}
                      </button>
                    </div>
                  </div>

                  {ranId === r.id && (
                    <div className="mt-2 text-[12px] text-success">Queued — runs within a minute</div>
                  )}

                  {whOpen && (
                    <div className="mt-3 border-t border-hairline/40 pt-3">
                      {!r.trigger && !creds ? (
                        <>
                          <div className="text-[12px] text-ink-secondary">
                            A webhook lets external services fire this routine with an HMAC-signed
                            POST.
                          </div>
                          <button
                            onClick={() => fetchWebhook(r.id)}
                            disabled={busy === `webhook:${r.id}`}
                            className="mt-2 flex items-center gap-1.5 rounded-lg bg-raised px-3 py-1.5 text-[12px] text-ink hover:bg-raised-hover disabled:opacity-50"
                          >
                            {busy === `webhook:${r.id}` && <Loader2 size={12} className="animate-spin" />}
                            Enable webhook
                          </button>
                        </>
                      ) : (
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center gap-2">
                            <span className="w-[42px] shrink-0 text-[11px] uppercase tracking-wide text-ink-secondary">
                              URL
                            </span>
                            <code className="min-w-0 flex-1 truncate rounded bg-inset px-2 py-1 text-[12px] text-ink">
                              {creds?.url ?? r.trigger!.url}
                            </code>
                            <CopyButton text={creds?.url ?? r.trigger!.url} title="Copy webhook URL" />
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="w-[42px] shrink-0 text-[11px] uppercase tracking-wide text-ink-secondary">
                              Secret
                            </span>
                            {creds ? (
                              <>
                                <code className="min-w-0 flex-1 truncate rounded bg-inset px-2 py-1 text-[12px] text-ink">
                                  {creds.secret}
                                </code>
                                <CopyButton text={creds.secret} title="Copy HMAC secret" />
                              </>
                            ) : (
                              <button
                                onClick={() => fetchWebhook(r.id)}
                                disabled={busy === `webhook:${r.id}`}
                                className="flex items-center gap-1.5 rounded-lg bg-raised px-3 py-1 text-[12px] text-ink hover:bg-raised-hover disabled:opacity-50"
                              >
                                {busy === `webhook:${r.id}` && (
                                  <Loader2 size={12} className="animate-spin" />
                                )}
                                Show secret
                              </button>
                            )}
                          </div>
                          <div className="text-[11px] text-ink-secondary">
                            Sign the raw POST body with HMAC-SHA256 and send the hex digest in the
                            webhook signature header.
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}

        {error && (
          <div className="mt-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">
            {error}
          </div>
        )}
      </div>
    </aside>
  );
}
