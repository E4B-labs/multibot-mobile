// Model picker: an instance rail + model list, backed by /api/instances.
// Routing is by exact instanceId only — an entry is never inferred from a
// driver kind, and unavailable instances render disabled with the reason.
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, KeyRound, Loader2, Search } from "lucide-react";
import { useStore, type Bot, type InstanceInfo } from "@/state/store";
import { ProviderMark } from "./ProviderIcons";
import { ApiKeyRow } from "./ApiKeys";
import { cn } from "@/lib/cn";
import { useLanguage } from "@/lib/language";
import { groupOpenCodeModels, isFreeModel, modelLabel } from "@/lib/opencodeModels";

// Nagłówkowa pigułka nigdy nie pokazuje surowego id: gdy katalog nie podał
// `name` (fallbacki go nie mają), zostaje czytelny człon po ukośniku.
function instanceModelLabel(instance: InstanceInfo | undefined, model: string): string {
  return modelLabel(model, instance?.models.options.find((o) => o.id === model)?.label);
}

const matchesModel = (option: { id: string; label: string }, query: string) => {
  if (!query) return true;
  const haystack = `${option.label} ${option.id}`.toLocaleLowerCase();
  return haystack.includes(query);
};

export function ModelPicker({ bot, className }: { bot: Bot; className?: string }) {
  const { state, dispatch } = useStore();
  const polish = useLanguage() === "pl";
  const [open, setOpen] = useState(false);
  const [railId, setRailId] = useState<string | null>(null);
  const [pendingGoModel, setPendingGoModel] = useState<string | null>(null);
  const [expandedOpenCodeGroups, setExpandedOpenCodeGroups] = useState({ go: true, zen: true });
  const [modelQuery, setModelQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  const selection = bot.modelSelection;
  const active = state.instances.find((i) => i.instanceId === selection.instanceId);
  const visibleInstances = state.instances;
  const railInstance =
    visibleInstances.find((i) => i.instanceId === (railId ?? selection.instanceId)) ?? visibleInstances[0];
  const activeLabel = active
    ? `${active.displayName} · ${instanceModelLabel(active, selection.model)}`
    : instanceModelLabel(active, selection.model);
  const opencodeKeyMissing = state.config?.opencode?.configured !== true;
  const normalizedModelQuery = modelQuery.trim().toLocaleLowerCase();
  const filteredOptions = railInstance?.models.options.filter((option) => matchesModel(option, normalizedModelQuery)) ?? [];
  const filteredOpenCodeGroups = railInstance
    ? groupOpenCodeModels(railInstance.models.options)
      .map((group) => ({ ...group, options: group.options.filter((option) => matchesModel(option, normalizedModelQuery)) }))
      .filter((group) => group.options.length > 0)
    : [];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (instance: InstanceInfo, model: string) => {
    if (instance.instanceId === "opencode" && model.startsWith("opencode-go/") && opencodeKeyMissing) {
      setPendingGoModel(model);
      setExpandedOpenCodeGroups((current) => ({ ...current, go: true }));
      return;
    }
    dispatch({ type: "setModel", botId: bot.id, selection: { instanceId: instance.instanceId, model } });
    setPendingGoModel(null);
    setOpen(false);
  };

  const badge = (text: string) => (
    <span className="shrink-0 rounded bg-inset px-1 py-px text-[10px] text-ink-secondary">{text}</span>
  );

  // Jeden kształt wiersza dla obu gałęzi (OpenCode w grupach i reszta), żeby
  // odznaki i powód niedostępności nie rozjechały się między nimi.
  const modelRow = (
    instance: InstanceInfo,
    option: { id: string; label: string },
    opts: { indent?: boolean; needsKey?: boolean } = {},
  ) => {
    const current = selection.instanceId === instance.instanceId && selection.model === option.id;
    const disabled = instance.snapshot.state !== "available";
    const keyHint = polish ? "wymaga wspólnego klucza OpenCode Go" : "needs the shared OpenCode Go key";
    return (
      <button
        key={option.id}
        disabled={disabled}
        // Powód siedzi na całym wierszu, nie tylko na ikonce — 12 px kłódki to
        // za mały cel dla myszy i nic dla klawiatury.
        title={disabled ? (instance.snapshot.reason ?? undefined) : opts.needsKey ? keyHint : undefined}
        onClick={() => pick(instance, option.id)}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-[13px]",
          opts.indent && "pl-6",
          disabled ? "cursor-not-allowed text-ink-secondary/50" : "text-ink hover:bg-raised/60",
          // brak klucza nie blokuje wiersza, tylko go przygasza — klik otwiera pole klucza
          !disabled && opts.needsKey && "opacity-60",
          current && "bg-raised",
        )}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate">{modelLabel(option.id, option.label)}</span>
          {option.id === instance.models.default && badge(polish ? "domyślny" : "default")}
          {isFreeModel(option.id) && badge(polish ? "darmowy" : "free")}
          {opts.needsKey && (
            <span className="shrink-0 text-ink-secondary" role="img" aria-label={keyHint} title={keyHint}>
              <KeyRound size={12} aria-hidden />
            </span>
          )}
        </span>
        {current && <Check size={14} className="shrink-0 text-accent" />}
      </button>
    );
  };

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        onClick={() => {
          setRailId(selection.instanceId);
          setOpen((o) => {
            setModelQuery("");
            if (o) setPendingGoModel(null);
            return !o;
          });
        }}
        className="flex items-center gap-1.5 rounded-full border border-hairline/40 bg-raised/60 py-2.5 pl-2 pr-2.5 text-[14px] text-ink hover:bg-raised sm:py-1"
        title={activeLabel || selection.model}
      >
        {active && <ProviderMark driverKind={active.driverKind} size={18} />}
        {/* Na wąskim ekranie nazwa modelu wypychała pigułkę poza nagłówek —
            zostaje sam znak dostawcy, pełna nazwa wraca od `sm`. */}
        <span className="hidden max-w-[190px] truncate sm:inline">
          {activeLabel}
        </span>
        <ChevronDown size={16} className="text-ink-secondary" />
      </button>

      {open && (
        <div
          data-model-picker-content
          className="z-30 flex flex-col overflow-hidden border border-hairline/50 bg-card shadow-2xl shadow-black/50 fixed inset-x-0 bottom-0 h-[60vh] min-h-0 rounded-t-2xl pb-[var(--safe-bottom)] sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-full sm:mt-2 sm:h-auto sm:max-h-[70vh] sm:flex-row sm:rounded-xl sm:pb-0 sm:w-[320px]"
        >
          {/* instance rail — na telefonie poziomy pasek u góry (wszystkie ikony
              widoczne, przewijanie w poziomie), na desktopie pionowy z lewej */}
          <div className="flex shrink-0 flex-row gap-1 overflow-x-auto border-b border-hairline/40 bg-panel p-2 sm:flex-col sm:overflow-y-auto sm:border-b-0 sm:border-r">
            {visibleInstances.map((instance) => {
              const unavailable = instance.snapshot.state !== "available";
              const onRail = instance.instanceId === railInstance?.instanceId;
              return (
                <button
                  key={instance.instanceId}
                  onClick={() => {
                    setRailId(instance.instanceId);
                    setModelQuery("");
                    setPendingGoModel(null);
                  }}
                  title={
                    unavailable
                      ? `${instance.displayName} — ${instance.snapshot.reason ?? "unavailable"}`
                      : instance.displayName
                  }
                  className={cn(
                    "flex size-9 items-center justify-center rounded-lg",
                    onRail ? "bg-raised" : "hover:bg-raised/60",
                    unavailable && "opacity-40",
                  )}
                >
                  <ProviderMark driverKind={instance.driverKind} size={18} />
                </button>
              );
            })}
          </div>

          {/* model list for the rail-selected instance */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col p-2">
            {railInstance ? (
              <>
                <div className="shrink-0 px-2 pb-1 pt-1">
                  <div className="text-[13px] font-semibold text-ink">{railInstance.displayName}</div>
                  <div className="truncate text-[11px] text-ink-secondary">
                    {railInstance.snapshot.state === "available"
                      ? railInstance.models.updatedAt
                        ? `${polish ? "modele zaktualizowane" : "models updated"} · ${new Date(railInstance.models.updatedAt).toLocaleString()}`
                        : (railInstance.snapshot.version ?? "ready")
                      : (railInstance.snapshot.reason ?? "unavailable")}
                  </div>
                </div>
                <div className="shrink-0 px-2 pb-2 pt-1">
                  <div className="relative">
                    <Search size={14} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-secondary" />
                    <input
                      value={modelQuery}
                      onChange={(event) => setModelQuery(event.target.value)}
                      aria-label={polish ? "Szukaj modelu" : "Search models"}
                      placeholder={polish ? "Szukaj modeli" : "Search models"}
                      className="h-8 w-full rounded-lg border border-hairline/40 bg-inset pl-7 pr-2 text-[12px] text-ink outline-none placeholder:text-ink-secondary focus:border-accent"
                    />
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                {railInstance.instanceId === "opencode" ? (
                  <>
                    {filteredOpenCodeGroups.map((group) => (
                      <div key={group.id} className="mt-1">
                        <button
                          type="button"
                          aria-expanded={expandedOpenCodeGroups[group.id]}
                          onClick={() => setExpandedOpenCodeGroups((current) => ({ ...current, [group.id]: !current[group.id] }))}
                          className="flex w-full items-center gap-1 rounded-lg px-2 py-1.5 text-left text-[12px] font-medium text-ink-secondary hover:bg-raised/60"
                        >
                          <ChevronRight size={13} className={cn("transition-transform", expandedOpenCodeGroups[group.id] && "rotate-90")} />
                          <span>{group.label}</span>
                          <span className="ml-auto text-[10px]">
                            {group.options.length} {polish ? "modeli" : "models"}
                          </span>
                        </button>
                        {expandedOpenCodeGroups[group.id] && group.options.map((option) =>
                          modelRow(railInstance, option, {
                            indent: true,
                            needsKey: group.id === "go" && opencodeKeyMissing,
                          }))}
                      </div>
                    ))}
                    {filteredOpenCodeGroups.length === 0 && (
                      <div className="px-2 py-4 text-center text-[12px] text-ink-secondary">
                        {polish ? "Brak pasujących modeli." : "No matching models."}
                      </div>
                    )}
                    {pendingGoModel && (
                      <div className="mx-2 mt-2 rounded-lg border border-hairline/40 bg-inset p-3">
                        <div className="mb-2 text-[12px] text-ink-secondary">
                          {polish ? "Ten model wymaga wspólnego klucza OpenCode Go." : "This model needs the shared OpenCode Go key."}
                        </div>
                        <ApiKeyRow
                          section="opencode"
                          label="OpenCode Go API key"
                          placeholder="Wklej klucz OpenCode Go"
                          onSaved={(configured) => {
                            if (!configured || !pendingGoModel) return;
                            dispatch({ type: "setModel", botId: bot.id, selection: { instanceId: "opencode", model: pendingGoModel } });
                            setPendingGoModel(null);
                            setOpen(false);
                          }}
                        />
                      </div>
                    )}
                  </>
                ) : filteredOptions.length > 0 ? filteredOptions.map((option) => modelRow(railInstance, option)) : (
                  <div className="px-2 py-4 text-center text-[12px] text-ink-secondary">
                    {polish ? "Brak pasujących modeli." : "No matching models."}
                  </div>
                )}
                </div>
              </>
            ) : (
              <div className="flex items-center gap-2 px-2 py-3 text-[13px] text-ink-secondary">
                <Loader2 size={14} className="animate-spin" /> {polish ? "Ładowanie modeli…" : "Loading models…"}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
