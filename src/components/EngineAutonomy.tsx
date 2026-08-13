// multibot: F4 — autonomia i twarde reguły narzędzi silnika slafy. Karta pod
// EngineProviderCard w SettingsPanel, tylko dla botów na driverze slafy. UI gada
// wyłącznie z przelotką harnessu (generyczny proxy `server/engine/proxy.ts`:
// `/api/engine/<rest>` → `/api/<rest>` silnika):
//   GET/PATCH /api/engine/bots/mb-<threadId>             — `autonomy` (BotPatch,
//     engine/server/app.py); brak klucza w bot.json = "approval",
//   GET/PATCH /api/engine/bots/mb-<threadId>/permissions — twarde on/off
//     toolsetów (engine/server/permissions.py); wyłączony = silnik odmawia
//     ZAWSZE, niezależnie od trybu.
// Allowlista "always" (permissions.allowlist) NIE ma w silniku trasy HTTP (ani
// GET, ani DELETE wpisu) — sekcja niżej to notka do czasu, aż backend ją wystawi.
import { useEffect, useState } from "react";
import { api, type Bot } from "@/state/store";
import { cn } from "@/lib/cn";

type Autonomy = "approval" | "autonomous";

/** Ten sam przełącznik co karta Notifications w SettingsPanel. */
function Switch({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors",
        on ? "bg-accent" : "bg-raised",
      )}
    >
      <span
        className={cn(
          "absolute top-[3px] size-5 rounded-full bg-white transition-all",
          on ? "left-[21px]" : "left-[3px]",
        )}
      />
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1 mt-4 text-[12px] font-medium uppercase tracking-[0.08em] text-ink-secondary">
      {children}
    </div>
  );
}

export function EngineAutonomy({ bot }: { bot: Bot }) {
  // Ten sam wzorzec id co EngineProviderCard: domyślny botPrefix "mb-" z
  // decodeConfig w server/drivers/slafy.ts.
  const engineBotId = `mb-${bot.threadId}`;
  const [status, setStatus] = useState<"loading" | "offline" | "ready">("loading");
  const [autonomy, setAutonomy] = useState<Autonomy>("approval");
  const [perms, setPerms] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  // karta jest keyowana bot.id w SettingsPanel, więc mount = jeden bot
  useEffect(() => {
    Promise.all([
      api(`/api/engine/bots/${engineBotId}`),
      api(`/api/engine/bots/${engineBotId}/permissions`),
    ])
      .then(([b, p]: [{ autonomy?: string }, Record<string, boolean>]) => {
        setAutonomy(b.autonomy === "autonomous" ? "autonomous" : "approval");
        setPerms(p);
        setStatus("ready");
      })
      .catch(() => setStatus("offline"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Optimistic + revert przy błędzie; po sukcesie stan zawsze z odpowiedzi
  // silnika (PATCH oddaje zaktualizowanego bota / pełną mapę toolsetów).
  const toggleAutonomy = () => {
    const prev = autonomy;
    const next: Autonomy = prev === "autonomous" ? "approval" : "autonomous";
    setAutonomy(next);
    setError(null);
    api(`/api/engine/bots/${engineBotId}`, {
      method: "PATCH",
      body: JSON.stringify({ autonomy: next }),
    })
      .then((b: { autonomy?: string }) =>
        setAutonomy(b.autonomy === "autonomous" ? "autonomous" : "approval"),
      )
      .catch((e: unknown) => {
        setAutonomy(prev);
        setError(e instanceof Error ? e.message : String(e));
      });
  };

  const toggleToolset = (toolset: string) => {
    const prev = perms;
    const enabled = !prev[toolset];
    setPerms({ ...prev, [toolset]: enabled });
    setError(null);
    api(`/api/engine/bots/${engineBotId}/permissions`, {
      method: "PATCH",
      body: JSON.stringify({ toolset, enabled }),
    })
      .then((p: Record<string, boolean>) => setPerms(p))
      .catch((e: unknown) => {
        setPerms(prev);
        setError(e instanceof Error ? e.message : String(e));
      });
  };

  return (
    <div className="rounded-xl bg-card p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-[15px] font-medium text-ink">Autonomous</div>
          <div className="mt-0.5 text-[13px] text-ink-secondary">
            Runs tools without asking for approval — tool rules below still apply
          </div>
        </div>
        {status === "ready" && (
          <Switch
            on={autonomy === "autonomous"}
            onClick={toggleAutonomy}
            label="Autonomous mode"
          />
        )}
      </div>

      {status === "offline" ? (
        <div className="mt-3 flex items-center gap-2 text-[13px] text-ink-secondary">
          <span className="size-1.5 rounded-full bg-raised-hover" />
          Engine offline
        </div>
      ) : status === "loading" ? null : (
        <>
          <SectionLabel>Tool rules</SectionLabel>
          <div className="text-[13px] text-ink-secondary">
            Disabled tools are refused by the engine in every mode
          </div>
          <div className="mt-1 flex flex-col">
            {Object.entries(perms).map(([toolset, enabled]) => (
              <div
                key={toolset}
                className="flex items-center justify-between border-b border-hairline/40 py-2 last:border-b-0"
              >
                <span className="text-[13px] text-ink">{toolset.replace(/_/g, " ")}</span>
                <Switch
                  on={enabled}
                  onClick={() => toggleToolset(toolset)}
                  label={`Allow ${toolset}`}
                />
              </div>
            ))}
          </div>

          <SectionLabel>Always allowed</SectionLabel>
          <div className="text-[13px] text-ink-secondary">
            Tools you approve with &ldquo;Always&rdquo; are enforced by the engine, but it
            doesn&rsquo;t expose the list yet
          </div>
        </>
      )}

      {error && <div className="mt-2 text-[12px] text-danger">{error}</div>}
    </div>
  );
}
