// Connected apps marketplace, backed by Composio Connect. Catalog comes
// from /api/connectors/catalog — the full toolkit list with logos when a
// Composio API key is configured, a curated set otherwise. Icons resolve
// logo → favicon → monogram.
// multibot (F7): ten sam katalog niesie też własne serwery MCP użytkownika
// (source === "custom") — renderowane w sekcji "Custom connectors" niżej,
// obsługiwane trasami harnessa /api/connectors/custom/:id (działają bez
// klucza Composio).
import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, X } from "lucide-react";
import { api, useStore } from "@/state/store";
import { cn } from "@/lib/cn";

interface ToolkitCard {
  slug: string;
  label: string;
  blurb: string;
  logo: string | null;
  domain: string | null;
  // multibot (F7): source mówi, którą trasą kartę odłączyć — Composio OAuth
  // vs DELETE /api/connectors/custom/:id.
  source?: "composio" | "custom";
}

function ServiceIcon({ card }: { card: ToolkitCard }) {
  // 0 = official logo, 1 = favicon by domain, 2 = monogram
  const [stage, setStage] = useState(card.logo ? 0 : card.domain ? 1 : 2);
  if (stage === 0 && card.logo) {
    return <img src={card.logo} alt="" className="size-8 rounded-md" onError={() => setStage(1)} />;
  }
  if (stage === 1 && card.domain) {
    return (
      <img
        src={`https://www.google.com/s2/favicons?domain=${card.domain}&sz=64`}
        alt=""
        className="size-8 rounded-md"
        onError={() => setStage(2)}
      />
    );
  }
  return (
    <div className="flex size-8 items-center justify-center rounded-md bg-raised text-[13px] font-semibold text-ink-secondary">
      {card.label.slice(0, 1).toUpperCase()}
    </div>
  );
}

// multibot (F7): własne konektory MCP — formularz i pomocnicy. Lustrzane
// stałe walidacji z server/mcp-connectors.ts, żeby błąd id pokazać od razu,
// bez rundy do serwera (resztę wsadu i tak waliduje backend — 400 idzie
// inline przez api()).
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,60}$/;
const RESERVED_IDS = new Set(["composio", "computer", "agents", "ogb"]);
// ten sam wygląd co pole "Search apps" wyżej
const FIELD =
  "w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none disabled:opacity-50";

type TransportType = "stdio" | "http" | "sse";
type CustomDraft = { id: string; name: string; type: TransportType; locked: boolean };
type KV = { k: string; v: string };

// Katalog nie zwraca transportu (env/headers to sekrety i zostają na
// serwerze) — typ do prefillu edycji czytamy z prefiksu blurba, który
// connectorCards() zawsze buduje jako "<transport>: …".
function typeFromBlurb(blurb: string): TransportType {
  return blurb.startsWith("http:") ? "http" : blurb.startsWith("sse:") ? "sse" : "stdio";
}

function kvToMap(rows: KV[]): Record<string, string> | undefined {
  const entries = rows.filter((r) => r.k.trim());
  return entries.length ? Object.fromEntries(entries.map((r) => [r.k.trim(), r.v])) : undefined;
}

// Zapis = PUT /api/connectors/custom/:id, zawsze nadpisuje CAŁY wpis — więc
// edycja nie prefilluje command/url/env/headers, tylko id (zablokowane),
// nazwę i typ transportu; użytkownik wpisuje resztę od nowa.
function ConnectorForm({
  draft,
  onSaved,
  onClose,
}: {
  draft: CustomDraft;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [id, setId] = useState(draft.id);
  const [name, setName] = useState(draft.name);
  const [type, setType] = useState<TransportType>(draft.type);
  const [command, setCommand] = useState("");
  const [url, setUrl] = useState("");
  // env (stdio) albo headers (http/sse) — jedna lista, etykieta z typu
  const [pairs, setPairs] = useState<KV[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    const cleanId = id.trim();
    if (!ID_RE.test(cleanId)) {
      setError("Id: lowercase letters, digits, - and _ only; must start with a letter or digit (max 61 chars).");
      return;
    }
    if (RESERVED_IDS.has(cleanId)) {
      setError(`Id "${cleanId}" is reserved by a built-in integration.`);
      return;
    }
    // stdio: jedno pole "command + argumenty", rozbijane po spacjach
    // (pierwszy token = command, reszta = args; argumenty ze spacjami
    // w cudzysłowie nie są wspierane)
    const tokens = command.trim().split(/\s+/).filter(Boolean);
    const kv = kvToMap(pairs);
    const transport =
      type === "stdio"
        ? {
            type,
            command: tokens[0] ?? "",
            ...(tokens.length > 1 ? { args: tokens.slice(1) } : {}),
            ...(kv ? { env: kv } : {}),
          }
        : { type, url: url.trim(), ...(kv ? { headers: kv } : {}) };
    setSaving(true);
    setError(null);
    api(`/api/connectors/custom/${cleanId}`, {
      method: "PUT",
      body: JSON.stringify({ name: name.trim() || cleanId, transport }),
    })
      .then(onSaved)
      .catch((e) => setError(e.message))
      .finally(() => setSaving(false));
  };

  return (
    <div className="border-t border-hairline/40 bg-card px-4 py-3">
      <div className="text-[13px] font-medium text-ink">
        {draft.locked ? `Edit ${draft.id}` : "New connector"}
      </div>
      {draft.locked && (
        <div className="mt-1 text-[12px] text-warning">
          Re-enter secrets when editing — saving overwrites the whole connector.
        </div>
      )}
      <div className="mt-2 flex gap-1.5">
        <input
          value={id}
          onChange={(e) => setId(e.target.value)}
          disabled={draft.locked}
          placeholder="id (a-z, 0-9, -, _)"
          className={cn(FIELD, "flex-1")}
        />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          className={cn(FIELD, "flex-1")}
        />
      </div>
      <div className="mt-2 flex items-center gap-1">
        {(["stdio", "http", "sse"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setType(t)}
            className={cn(
              "rounded-md px-2.5 py-1 text-[12px]",
              type === t ? "bg-raised text-ink" : "text-ink-secondary hover:text-ink",
            )}
          >
            {t}
          </button>
        ))}
      </div>
      {type === "stdio" ? (
        <>
          <input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="npx -y @your/mcp-server --flag"
            className={cn(FIELD, "mt-2")}
          />
          <div className="mt-1 text-[11px] text-ink-secondary">
            Command and arguments, separated by spaces.
          </div>
        </>
      ) : (
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/mcp"
          className={cn(FIELD, "mt-2")}
        />
      )}
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[12px] text-ink-secondary">
          {type === "stdio" ? "Environment variables" : "Headers"}
        </span>
        <button
          onClick={() => setPairs((p) => [...p, { k: "", v: "" }])}
          className="text-[12px] text-ink-secondary underline hover:text-ink"
        >
          Add {type === "stdio" ? "variable" : "header"}
        </button>
      </div>
      {pairs.map((row, i) => (
        <div key={i} className="mt-1.5 flex items-center gap-1.5">
          <input
            value={row.k}
            onChange={(e) => setPairs((p) => p.map((r, j) => (j === i ? { ...r, k: e.target.value } : r)))}
            placeholder={type === "stdio" ? "NAME" : "Header"}
            className={cn(FIELD, "flex-1")}
          />
          <input
            value={row.v}
            onChange={(e) => setPairs((p) => p.map((r, j) => (j === i ? { ...r, v: e.target.value } : r)))}
            placeholder="Value"
            className={cn(FIELD, "flex-[2]")}
          />
          <button
            onClick={() => setPairs((p) => p.filter((_, j) => j !== i))}
            className="rounded-md p-1 text-ink-secondary hover:text-danger"
          >
            <X size={14} />
          </button>
        </div>
      ))}
      {error && <div className="mt-2 text-[12px] text-danger">{error}</div>}
      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={save}
          disabled={saving}
          className="w-[92px] rounded-lg bg-raised py-1.5 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-50"
        >
          {saving ? <Loader2 size={13} className="mx-auto animate-spin" /> : "Save"}
        </button>
        <button
          onClick={onClose}
          className="rounded-lg px-3 py-1.5 text-[13px] text-ink-secondary hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export function PluginsPanel() {
  const { dispatch } = useStore();
  const [cards, setCards] = useState<ToolkitCard[] | null>(null);
  const [source, setSource] = useState<"api" | "curated">("curated");
  const [configured, setConfigured] = useState(true);
  const [status, setStatus] = useState<Record<string, { connected: boolean }>>({});
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  // multibot (F7): otwarty formularz konektora — null = zamknięty,
  // locked = edycja istniejącego (id nie do zmiany)
  const [draft, setDraft] = useState<CustomDraft | null>(null);

  const refreshStatus = useCallback((slugs: string[]) => {
    if (!slugs.length) return Promise.resolve();
    setRefreshing(true);
    return api(`/api/connectors?services=${slugs.join(",")}`)
      .then((r) => setStatus(r.services ?? {}))
      .catch(() => {})
      .finally(() => setRefreshing(false));
  }, []);

  // multibot (F7): katalog przeładowuje się też po zapisie/usunięciu
  // własnego konektora, stąd useCallback zamiast gołego efektu. O status
  // pytamy tylko karty Composio — /api/connectors zna wyłącznie ich slugi.
  const loadCatalog = useCallback(() => {
    return api("/api/connectors/catalog")
      .then((r) => {
        setCards(r.cards ?? []);
        setSource(r.source ?? "curated");
        setConfigured(Boolean(r.configured));
        const composio = (r.cards ?? []).filter((c: ToolkitCard) => c.source !== "custom");
        if (r.configured) void refreshStatus(composio.map((c: ToolkitCard) => c.slug).slice(0, 40));
      })
      .catch((e) => setError(e.message));
  }, [refreshStatus]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const connect = (slug: string) => {
    setBusySlug(slug);
    setError(null);
    api(`/api/connectors/${slug}/authorize`, { method: "POST" })
      .then(({ url }) => {
        window.open(url);
        // the user finishes OAuth in the browser; poll a few times to catch it
        let tries = 0;
        const timer = setInterval(() => {
          void refreshStatus([slug]);
          if (++tries >= 6 || status[slug]?.connected) clearInterval(timer);
        }, 5000);
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusySlug(null));
  };

  const disconnect = (slug: string) => {
    setBusySlug(slug);
    api(`/api/connectors/${slug}`, { method: "DELETE" })
      .then(() => refreshStatus([slug]))
      .catch((e) => setError(e.message))
      .finally(() => setBusySlug(null));
  };

  // multibot (F7): własne konektory usuwa harness, nie Composio — osobna
  // trasa /custom/ i pełne przeładowanie katalogu (statusów tu nie ma).
  const removeCustom = (id: string) => {
    setBusySlug(id);
    setError(null);
    api(`/api/connectors/custom/${id}`, { method: "DELETE" })
      .then(() => loadCatalog())
      .catch((e) => setError(e.message))
      .finally(() => setBusySlug(null));
  };

  const visible = (cards ?? []).filter(
    (c) => !search || `${c.label} ${c.slug} ${c.blurb}`.toLowerCase().includes(search.toLowerCase()),
  );
  // multibot (F7): Composio renderuje się jak dotąd, własne konektory idą
  // do sekcji "Custom connectors" na dole listy
  const composioCards = visible.filter((c) => c.source !== "custom");
  const customCards = visible.filter((c) => c.source === "custom");

  return (
    <div
      // Na mobile modal przykrywa cały ekran (fixed, wyższy niż drawer/scrim),
      // by nie kolidować z otwartym drawerem; na szerokim ekranie zostaje
      // absolute wewnątrz głównego obszaru (nie przykrywa paska bocznego).
      className="plugins-overlay fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-3 md:absolute md:inset-0 md:z-20"
      onClick={() => dispatch({ type: "togglePlugins", open: false })}
    >
      <div
        className="animate-pop-in flex max-h-[85%] w-full max-w-[560px] flex-col rounded-2xl border border-hairline/50 bg-panel p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="text-[17px] font-semibold text-ink">Connected apps</div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => refreshStatus(composioCards.map((c) => c.slug).slice(0, 40))}
              className="rounded-md p-1 text-ink-secondary hover:bg-raised hover:text-ink"
              title="Refresh connection status"
            >
              <RefreshCw size={15} className={cn(refreshing && "animate-spin")} />
            </button>
            <button
              onClick={() => dispatch({ type: "togglePlugins", open: false })}
              className="rounded-md p-1 text-ink-secondary hover:bg-raised hover:text-ink"
            >
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="mt-1 text-[13px] text-ink-secondary">
          Apps your bots can use through Composio Connect.
        </div>

        {!configured && (
          <div className="mt-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[13px] text-warning">
            No Composio Connect key yet —{" "}
            <button
              className="underline"
              onClick={() => {
                dispatch({ type: "togglePlugins", open: false });
                dispatch({ type: "toggleAppSettings", open: true });
              }}
            >
              add one in App Settings
            </button>{" "}
            to connect apps.
          </div>
        )}
        {configured && source === "curated" && (
          <div className="mt-3 text-[12px] text-ink-secondary">
            Showing a curated set.{" "}
            <button
              className="underline hover:text-ink"
              onClick={() => {
                dispatch({ type: "togglePlugins", open: false });
                dispatch({ type: "toggleAppSettings", open: true });
              }}
            >
              Add a Composio API key
            </button>{" "}
            to browse the full catalog.
          </div>
        )}
        {error && <div className="mt-2 text-[12px] text-danger">{error}</div>}

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search apps"
          className="mt-3 w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none"
        />

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-xl border border-hairline/40">
          {cards === null ? (
            <div className="flex items-center justify-center gap-2 py-8 text-[13px] text-ink-secondary">
              <Loader2 size={14} className="animate-spin" /> Loading catalog…
            </div>
          ) : (
            composioCards.map((card, i) => {
              const connected = status[card.slug]?.connected;
              const busy = busySlug === card.slug;
              return (
                <div
                  key={card.slug}
                  className={cn(
                    "flex items-center gap-3 bg-card px-4 py-3",
                    i > 0 && "border-t border-hairline/40",
                  )}
                >
                  <ServiceIcon card={card} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-[14px] font-medium text-ink">
                      {card.label}
                      {connected && <span className="size-1.5 rounded-full bg-success" />}
                    </div>
                    <div className="truncate text-[12px] text-ink-secondary">{card.blurb}</div>
                  </div>
                  <button
                    disabled={!configured || busy}
                    onClick={() => (connected ? disconnect(card.slug) : connect(card.slug))}
                    className={cn(
                      "w-[92px] rounded-lg py-1.5 text-[13px] disabled:opacity-50",
                      connected
                        ? "bg-raised text-ink-secondary hover:text-danger"
                        : "bg-raised text-ink hover:bg-raised-hover",
                    )}
                  >
                    {busy ? (
                      <Loader2 size={13} className="mx-auto animate-spin" />
                    ) : connected ? (
                      "Disconnect"
                    ) : (
                      "Connect"
                    )}
                  </button>
                </div>
              );
            })
          )}
          {cards !== null && composioCards.length === 0 && (
            <div className="py-8 text-center text-[13px] text-ink-secondary">No apps match.</div>
          )}

          {/* multibot (F7): sekcja własnych serwerów MCP pod katalogiem
              Composio. Trasy /api/connectors/custom/* to harness, nie
              Composio — działają bez klucza, więc nic tu nie jest
              gate'owane przez `configured`. Kropki statusu też nie ma:
              /api/connectors zna tylko slugi Composio. */}
          {cards !== null && (
            <div className="border-t border-hairline/40 bg-card">
              <div className="flex items-center justify-between px-4 pb-1 pt-3">
                <div>
                  <div className="text-[13px] font-semibold text-ink">Custom connectors</div>
                  <div className="text-[12px] text-ink-secondary">
                    Your own MCP servers — stdio, HTTP or SSE.
                  </div>
                </div>
                <button
                  onClick={() => setDraft({ id: "", name: "", type: "stdio", locked: false })}
                  className="rounded-lg bg-raised px-3 py-1.5 text-[13px] text-ink hover:bg-raised-hover"
                >
                  Add connector
                </button>
              </div>
              {customCards.map((card) => {
                const busy = busySlug === card.slug;
                return (
                  <div
                    key={card.slug}
                    className="flex items-center gap-3 border-t border-hairline/40 px-4 py-3"
                  >
                    <ServiceIcon card={card} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] font-medium text-ink">{card.label}</div>
                      <div className="truncate text-[12px] text-ink-secondary">{card.blurb}</div>
                    </div>
                    <button
                      disabled={busy}
                      onClick={() =>
                        setDraft({
                          id: card.slug,
                          name: card.label,
                          type: typeFromBlurb(card.blurb),
                          locked: true,
                        })
                      }
                      className="rounded-lg bg-raised px-3 py-1.5 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-50"
                    >
                      Edit
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => removeCustom(card.slug)}
                      className="rounded-lg bg-raised px-3 py-1.5 text-[13px] text-ink-secondary hover:text-danger disabled:opacity-50"
                    >
                      {busy ? <Loader2 size={13} className="mx-auto animate-spin" /> : "Remove"}
                    </button>
                  </div>
                );
              })}
              {draft && (
                <ConnectorForm
                  key={draft.locked ? draft.id : "new"}
                  draft={draft}
                  onClose={() => setDraft(null)}
                  onSaved={() => {
                    setDraft(null);
                    void loadCatalog();
                  }}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
