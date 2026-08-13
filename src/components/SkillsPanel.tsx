// multibot: F8 — skille silnika slafy w prawym slocie (400px, jak Routines).
// UI gada wyłącznie z przelotką harnessu (`server/engine/proxy.ts`:
// `/api/engine/<rest>` → `/api/<rest>` silnika). Skille są WSPÓLNE dla całej
// floty (junction w engine/server/skills.py), więc trasy nie mają bot_id:
//   GET    /api/engine/skills         — lista {name, command, description,
//                                       instructions, path},
//   PATCH  /api/engine/skills/<name>  — zapis {description?, instructions?}
//     (rename też istnieje, ale UI go nie wystawia — przenosi katalog),
//   DELETE /api/engine/skills/<name>  — usunięcie.
// Teach-a-task (nagranie demonstracji w przeglądarce bota → skill) jest per bot:
//   POST /api/engine/bots/mb-<threadId>/teach/start      — 404 = brak przeglądarki,
//   POST /api/engine/bots/mb-<threadId>/teach/stop       — {events, transcript},
//   POST /api/engine/bots/mb-<threadId>/teach/synthesize — pełna tura agenta
//     (minuty), oddaje {skill_name}.
import { useEffect, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  GraduationCap,
  Loader2,
  Pencil,
  Square,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { useStore, type Bot } from "@/state/store";
import { ChatMarkdown } from "./ChatMarkdown";
import { cn } from "@/lib/cn";
import { authFetch } from "@/lib/auth";

// Lokalny helper jak w RoutinesPanel, plus `status` na błędzie: teach/start
// odróżnia "brak przeglądarki" (404) od "silnik padł" po kodzie, nie po treści.
async function api(path: string, init?: RequestInit): Promise<any> {
  const res = await authFetch(path, { headers: { "content-type": "application/json" }, ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = typeof body.detail === "string" ? body.detail : undefined;
    throw Object.assign(new Error(detail ?? body.error ?? `${res.status} ${res.statusText}`), {
      status: res.status,
    });
  }
  return body;
}

/** Mirror of engine `skills._record()` (engine/server/skills.py). */
interface Skill {
  name: string;
  command: string;
  description: string;
  instructions: string;
  path: string;
}

const inputCls =
  "w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none";

function SkillForm({
  skill,
  onSaved,
  onCancel,
}: {
  skill: Skill;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [description, setDescription] = useState(skill.description);
  const [instructions, setInstructions] = useState(skill.instructions);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    api(`/api/engine/skills/${encodeURIComponent(skill.name)}`, {
      method: "PATCH",
      body: JSON.stringify({ description, instructions }),
    })
      .then(onSaved)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setSaving(false));
  };

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-xl bg-card p-4">
      <div className="text-[15px] font-medium text-ink">Edit {skill.name}</div>
      <label className="block">
        <div className="mb-1.5 text-[13px] text-ink-secondary">Description</div>
        <input
          className={inputCls}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="When should the bot reach for this skill?"
        />
      </label>
      <label className="block">
        <div className="mb-1.5 text-[13px] text-ink-secondary">Instructions</div>
        <textarea
          className={cn(inputCls, "min-h-[180px] resize-none font-mono text-[12px]")}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
        />
      </label>
      {error && <div className="text-[12px] text-danger">{error}</div>}
      <div className="flex gap-2">
        <button
          onClick={save}
          disabled={saving}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-raised py-2 text-[13px] text-ink hover:bg-raised-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
          Save
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

// Stany nagrywania: idle → recording → stopped (transkrypt czeka) →
// synthesizing → done. `noBrowser` to podpowiedź po 404 z teach/start.
type TeachState =
  | { phase: "idle"; noBrowser?: boolean }
  | { phase: "starting" }
  | { phase: "recording"; recordingId: string }
  | { phase: "stopping"; recordingId: string }
  | { phase: "stopped"; recordingId: string; transcript: string }
  | { phase: "synthesizing" }
  | { phase: "done"; skillName: string };

function TeachCard({
  engineBotId,
  onSkillCreated,
}: {
  engineBotId: string;
  onSkillCreated: () => void;
}) {
  const [teach, setTeach] = useState<TeachState>({ phase: "idle" });
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  // multibot: deep-link do live view po F5-FE

  const start = () => {
    setTeach({ phase: "starting" });
    setError(null);
    api(`/api/engine/bots/${engineBotId}/teach/start`, { method: "POST" })
      .then(({ recording_id }: { recording_id: string }) =>
        setTeach({ phase: "recording", recordingId: recording_id }),
      )
      .catch((e: unknown) => {
        if ((e as { status?: number }).status === 404) {
          setTeach({ phase: "idle", noBrowser: true });
        } else {
          setTeach({ phase: "idle" });
          setError(e instanceof Error ? e.message : String(e));
        }
      });
  };

  const stop = (recordingId: string) => {
    setTeach({ phase: "stopping", recordingId });
    setError(null);
    api(`/api/engine/bots/${engineBotId}/teach/stop`, {
      method: "POST",
      body: JSON.stringify({ recording_id: recordingId }),
    })
      .then(({ transcript }: { transcript: string }) =>
        setTeach({ phase: "stopped", recordingId, transcript }),
      )
      .catch((e: unknown) => {
        setTeach({ phase: "idle" });
        setError(e instanceof Error ? e.message : String(e));
      });
  };

  const synthesize = (recordingId: string) => {
    setTeach({ phase: "synthesizing" });
    setError(null);
    api(`/api/engine/bots/${engineBotId}/teach/synthesize`, {
      method: "POST",
      body: JSON.stringify({ recording_id: recordingId, ...(name.trim() ? { name: name.trim() } : {}) }),
    })
      .then(({ skill_name }: { skill_name: string }) => {
        setTeach({ phase: "done", skillName: skill_name });
        setName("");
        onSkillCreated();
      })
      .catch((e: unknown) => {
        setTeach({ phase: "idle" });
        setError(e instanceof Error ? e.message : String(e));
      });
  };

  return (
    <div className="mt-3 rounded-xl bg-card p-4">
      <div className="flex items-center gap-2 text-[15px] font-medium text-ink">
        <GraduationCap size={16} className="text-ink-secondary" />
        Teach a task
      </div>
      <div className="mt-0.5 text-[13px] text-ink-secondary">
        Show the bot a task in its browser — it watches your clicks and writes itself a skill.
      </div>

      {teach.phase === "idle" && (
        <>
          {teach.noBrowser && (
            <div className="mt-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[12px] text-warning">
              This bot's browser isn't running — teaching records inside it. Ask the bot to open a
              page first, then start again.
            </div>
          )}
          <button
            onClick={start}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-raised py-2 text-[13px] text-ink hover:bg-raised-hover"
          >
            <Circle size={13} className="text-danger" />
            Start recording
          </button>
        </>
      )}

      {teach.phase === "starting" && (
        <div className="mt-3 flex items-center justify-center gap-2 py-1 text-[13px] text-ink-secondary">
          <Loader2 size={14} className="animate-spin" /> Connecting to the browser…
        </div>
      )}

      {(teach.phase === "recording" || teach.phase === "stopping") && (
        <>
          <div className="mt-3 flex items-center gap-2 text-[13px] text-ink">
            <span className="size-2 animate-pulse rounded-full bg-danger" />
            Recording — demonstrate the task in the bot's browser
          </div>
          <button
            onClick={() => stop(teach.recordingId)}
            disabled={teach.phase === "stopping"}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-raised py-2 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-50"
          >
            {teach.phase === "stopping" ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Square size={12} className="fill-current" />
            )}
            Stop recording
          </button>
        </>
      )}

      {teach.phase === "stopped" && (
        <>
          <div className="mb-1.5 mt-3 text-[13px] text-ink-secondary">What the bot saw</div>
          <pre className="max-h-[140px] overflow-y-auto whitespace-pre-wrap rounded-lg bg-inset p-3 text-[12px] leading-relaxed text-ink">
            {teach.transcript || "No steps recorded"}
          </pre>
          <input
            className={cn(inputCls, "mt-2")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Skill name (optional — the bot picks one)"
          />
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => synthesize(teach.recordingId)}
              disabled={!teach.transcript}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-raised py-2 text-[13px] text-ink hover:bg-raised-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Wand2 size={13} />
              Create skill
            </button>
            <button
              onClick={() => setTeach({ phase: "idle" })}
              className="rounded-lg bg-raised px-4 py-2 text-[13px] text-ink-secondary hover:bg-raised-hover hover:text-ink"
            >
              Discard
            </button>
          </div>
        </>
      )}

      {teach.phase === "synthesizing" && (
        <div className="mt-3 flex items-center justify-center gap-2 py-1 text-[13px] text-ink-secondary">
          <Loader2 size={14} className="animate-spin" /> The bot is writing the skill — this can
          take a few minutes…
        </div>
      )}

      {teach.phase === "done" && (
        <>
          <div className="mt-3 text-[13px] text-success">
            Skill created: <span className="font-medium">{teach.skillName}</span>
          </div>
          <button
            onClick={() => setTeach({ phase: "idle" })}
            className="mt-2 w-full rounded-lg bg-raised py-2 text-[13px] text-ink hover:bg-raised-hover"
          >
            Teach another
          </button>
        </>
      )}

      {error && (
        <div className="mt-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">
          {error}
        </div>
      )}
    </div>
  );
}

export function SkillsPanel({ bot }: { bot: Bot }) {
  const { dispatch } = useStore();
  // Ten sam wzorzec id co local runtime controls: domyślny botPrefix "mb-" z
  // decodeConfig w server/drivers/slafy.ts.
  const engineBotId = `mb-${bot.threadId}`;
  const [status, setStatus] = useState<"loading" | "offline" | "ready">("loading");
  const [skills, setSkills] = useState<Skill[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<Skill | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // "delete:<name>"
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api(`/api/engine/skills`).then((ss: Skill[]) => {
      setSkills(ss);
      setStatus("ready");
    });

  // Panel jest keyowany bot.id w Shell, więc mount = jeden bot. Ensure jak w
  // RoutinesPanel: teach jest per bot, a bot silnika powstaje leniwie — najpierw
  // idempotentny POST /api/bots (409 = już jest = sukces).
  useEffect(() => {
    let alive = true;
    authFetch(`/api/engine/bots`, {
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

  // Bez dialogu potwierdzenia — wzorzec repo (delete rutyny/bota też jest
  // bezpośredni), destruktywność sygnalizuje styl danger.
  const remove = (name: string) => {
    setBusy(`delete:${name}`);
    setError(null);
    api(`/api/engine/skills/${encodeURIComponent(name)}`, { method: "DELETE" })
      .then(() => setSkills((ss) => ss.filter((s) => s.name !== name)))
      .catch(showError)
      .finally(() => setBusy(null));
  };

  return (
    <aside className="animate-panel-in flex h-full w-[400px] shrink-0 flex-col border-l border-hairline/40 bg-panel">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <span className="w-[26px]" />
        <span className="text-[15px] font-semibold text-ink">Skills</span>
        <button
          onClick={() => dispatch({ type: "toggleSkills", open: false })}
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
            <Loader2 size={14} className="animate-spin" /> Loading skills…
          </div>
        ) : editing ? (
          <SkillForm
            skill={editing}
            onSaved={() => {
              setEditing(null);
              load().catch(() => setStatus("offline"));
            }}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <>
            <TeachCard
              engineBotId={engineBotId}
              onSkillCreated={() => load().catch(() => setStatus("offline"))}
            />

            {skills.length === 0 ? (
              <div className="mt-8 flex flex-col items-center gap-2 px-6 text-center text-ink-secondary">
                <Wand2 size={22} />
                <div className="text-[13px] font-medium text-ink">No skills yet</div>
                <span className="text-[12px]">
                  Skills are reusable playbooks shared by every bot — teach one above, or ask a bot
                  to write one for itself.
                </span>
              </div>
            ) : (
              skills.map((s) => {
                const open = expanded === s.name;
                return (
                  <div key={s.name} className="mt-3 rounded-xl bg-card p-4">
                    <div className="flex items-start justify-between gap-2">
                      <button
                        onClick={() => setExpanded(open ? null : s.name)}
                        className="flex min-w-0 flex-1 items-start gap-1.5 text-left"
                        title={s.path}
                      >
                        {open ? (
                          <ChevronDown size={15} className="mt-0.5 shrink-0 text-ink-secondary" />
                        ) : (
                          <ChevronRight size={15} className="mt-0.5 shrink-0 text-ink-secondary" />
                        )}
                        <span className="min-w-0">
                          <span className="block truncate text-[15px] font-medium text-ink">
                            {s.command}
                          </span>
                          <span className="mt-0.5 block text-[13px] text-ink-secondary">
                            {s.description || "No description"}
                          </span>
                        </span>
                      </button>
                      <div className="flex shrink-0 items-center gap-0.5">
                        <button
                          onClick={() => setEditing(s)}
                          className="rounded-md p-1.5 text-ink-secondary hover:bg-raised hover:text-ink"
                          title="Edit"
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          onClick={() => remove(s.name)}
                          disabled={busy === `delete:${s.name}`}
                          className="rounded-md p-1.5 text-ink-secondary hover:bg-raised hover:text-danger disabled:opacity-50"
                          title="Delete"
                        >
                          {busy === `delete:${s.name}` ? (
                            <Loader2 size={15} className="animate-spin" />
                          ) : (
                            <Trash2 size={15} />
                          )}
                        </button>
                      </div>
                    </div>
                    {open && (
                      <div className="mt-3 border-t border-hairline/40 pt-3 text-[13px]">
                        <div className="mb-2 truncate text-[11px] text-ink-secondary" title={s.path}>
                          {s.path}
                        </div>
                        {s.instructions ? (
                          <ChatMarkdown text={s.instructions} />
                        ) : (
                          <div className="text-ink-secondary">No instructions</div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
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
