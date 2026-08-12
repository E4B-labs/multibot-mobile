// multibot: BYOK silnika slafy — karta w SettingsPanel (per bot, bo silnik
// trzyma provider per profil bota: `engine/server/providers.py`). UI gada
// wyłącznie z przelotką harnessu (`/api/engine/provider/<engineBotId>`,
// server/index.ts), nigdy z silnikiem wprost. Silnik nigdy nie oddaje klucza —
// GET niesie tylko `has_key`, więc pole klucza pokazuje stan placeholderem.
import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { api, type Bot } from "@/state/store";
import { cn } from "@/lib/cn";

// Dokładnie `_ENV_VARS` silnika (engine/server/providers.py) — wszystko inne
// silnik odrzuca 422, więc nie oferujemy więcej (huggingface NIE jest tam
// zarejestrowany, mimo że bywa w konfiguracji roota Hermesa).
const PROVIDERS = ["openrouter", "anthropic", "openai", "custom"] as const;
type Provider = (typeof PROVIDERS)[number];
const PROVIDER_LABELS: Record<Provider, string> = {
  openrouter: "OpenRouter",
  anthropic: "Anthropic",
  openai: "OpenAI",
  custom: "Custom",
};

/** GET /api/engine/provider/<id> — mirror of engine `get_provider()`. */
interface EngineProviderStatus {
  provider: string | null;
  model: string | null;
  base_url: string | null;
  has_key: boolean;
}

const inputCls =
  "w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none";

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 text-[13px] text-ink-secondary">{children}</div>;
}

export function EngineProviderCard({ bot }: { bot: Bot }) {
  // multibot: domyślny botPrefix "mb-" z decodeConfig w server/drivers/slafy.ts —
  // id bota w silniku to `<botPrefix><threadId>`; niestandardowy prefix wymaga
  // zmiany także tutaj.
  const engineBotId = `mb-${bot.threadId}`;
  const [status, setStatus] = useState<EngineProviderStatus | "offline" | null>(null);
  const [provider, setProvider] = useState<Provider>("openrouter");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api(`/api/engine/provider/${engineBotId}`)
      .then((s: EngineProviderStatus) => {
        setStatus(s);
        // fresh engine bot: all fields null — keep the defaults
        if (PROVIDERS.includes(s.provider as Provider)) setProvider(s.provider as Provider);
        setModel(s.model ?? "");
        setBaseUrl(s.base_url ?? "");
      })
      .catch(() => setStatus("offline"));

  // the card is keyed by bot.id in SettingsPanel, so mount = one bot
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasKey = status !== null && status !== "offline" && status.has_key;

  const save = () => {
    if (saving || !model.trim()) return;
    setSaving(true);
    setError(null);
    const key = apiKey.trim();
    api(`/api/engine/provider/${engineBotId}`, {
      method: "POST",
      body: JSON.stringify({
        provider,
        model: model.trim(),
        base_url: baseUrl.trim() || null,
        // pusty input + zapisany klucz → "" (falsy po stronie silnika = klucz
        // zostaje); pusty + brak klucza → pomiń pole, żeby zadziałał fallback
        // silnika na repo .env (providers.py: `api_key is None`).
        ...(key ? { api_key: key } : hasKey ? { api_key: "" } : {}),
      }),
    })
      .then(() => {
        setApiKey("");
        return load(); // po zapisie odśwież GET — stan zawsze z silnika
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setSaving(false));
  };

  return (
    <div className="rounded-xl bg-card p-4">
      <div className="text-[15px] font-medium text-ink">Local engine (BYOK)</div>
      <div className="mt-0.5 text-[13px] text-ink-secondary">
        Which API the Slafy engine calls for this bot, with your own key
      </div>

      {status === "offline" ? (
        <div className="mt-3 flex items-center gap-2 text-[13px] text-ink-secondary">
          <span className="size-1.5 rounded-full bg-raised-hover" />
          Engine offline
        </div>
      ) : status === null ? null : (
        <div className="mt-3 flex flex-col gap-3">
          <div className="flex overflow-hidden rounded-lg border border-hairline/40">
            {PROVIDERS.map((p, i) => (
              <button
                key={p}
                onClick={() => setProvider(p)}
                className={cn(
                  "flex-1 py-1.5 text-[13px]",
                  i > 0 && "border-l border-hairline/40",
                  provider === p
                    ? "bg-raised text-ink"
                    : "text-ink-secondary hover:bg-raised/60 hover:text-ink",
                )}
              >
                {PROVIDER_LABELS[p]}
              </button>
            ))}
          </div>

          <label className="block">
            <FieldLabel>Model</FieldLabel>
            <input
              className={inputCls}
              value={model}
              onChange={(e) => setModel(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && save()}
              placeholder="openrouter/auto"
            />
          </label>

          <label className="block">
            <FieldLabel>Base URL</FieldLabel>
            <input
              className={inputCls}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && save()}
              placeholder={provider === "custom" ? "https://api.example.com/v1" : "https://…  (optional)"}
            />
          </label>

          <label className="block">
            <div className="mb-1.5 flex items-center gap-2 text-[13px] text-ink-secondary">
              <span className={cn("size-1.5 rounded-full", hasKey ? "bg-success" : "bg-raised-hover")} />
              API key
              {hasKey && <span className="text-[11px] text-success">Saved</span>}
            </div>
            <div className="flex gap-2">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && save()}
                placeholder={hasKey ? "••••••••  (paste to replace)" : "sk-…"}
                autoComplete="off"
                className={inputCls}
              />
              <button
                onClick={save}
                disabled={saving || !model.trim()}
                className={cn(
                  "flex w-[72px] shrink-0 items-center justify-center gap-1.5 rounded-lg py-2 text-[13px]",
                  "bg-raised text-ink hover:bg-raised-hover",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                )}
                title="Save"
              >
                {saving ? <Loader2 size={13} className="animate-spin" /> : <><Check size={13} />Save</>}
              </button>
            </div>
          </label>

          {error && <div className="text-[12px] text-danger">{error}</div>}
        </div>
      )}
    </div>
  );
}
