import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Trash2 } from "lucide-react";
import { useStore } from "@/state/store";
import { authFetch } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { AUTO_TIMEZONE } from "@/lib/timezone";
import { TimeZonePicker } from "./TimeZonePicker";
import { DEFAULT_AUTO_VERIFY, type AutoVerifyDecision, type AutoVerifyRule, type AutoVerifySettings } from "@/lib/autoVerifyTypes";

function DecisionSelect({ value, onChange, polish }: { value: AutoVerifyDecision; onChange: (value: AutoVerifyDecision) => void; polish: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open]);
  const labels: Record<AutoVerifyDecision, string> = { allow: polish ? "Zezwalaj automatycznie" : "Allow automatically", ask: polish ? "Najpierw pytaj" : "Ask first" };
  return (
    <div ref={ref} className="relative min-w-0">
      <button type="button" onClick={() => setOpen((current) => !current)} aria-expanded={open} className="flex max-w-full items-center gap-2 rounded-lg border border-hairline/40 bg-inset px-2.5 py-2 text-[13px] text-ink hover:bg-raised/40">
        <span className="truncate">{labels[value]}</span><ChevronDown size={14} className="shrink-0 text-ink-secondary" />
      </button>
      {open && <div role="listbox" className="absolute bottom-full left-0 z-30 mb-1.5 w-56 overflow-hidden rounded-xl border border-hairline/40 bg-card p-1.5 shadow-lg">
        {(["allow", "ask"] as const).map((option) => <button key={option} type="button" role="option" aria-selected={option === value} onClick={() => { onChange(option); setOpen(false); }} className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-[13px] text-ink hover:bg-raised"><span className="flex-1">{labels[option]}</span><Check size={14} className={option === value ? "opacity-100" : "opacity-0"} /></button>)}
      </div>}
    </div>
  );
}

export function BotSettingsCard({ polish }: { polish: boolean }) {
  const { state, dispatch } = useStore();
  const timeZone = state.config?.timeZone ?? AUTO_TIMEZONE;
  const autoVerify = state.config?.autoVerify ?? DEFAULT_AUTO_VERIFY;
  const [draft, setDraft] = useState("");
  const [draftDecision, setDraftDecision] = useState<AutoVerifyDecision>("ask");

  const save = (patch: { timeZone?: string; autoVerify?: AutoVerifySettings }) => {
    void authFetch("/api/config", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) })
      .then((response) => response.json())
      .then((config) => dispatch({ type: "configStatus", config }))
      .catch(() => {});
  };
  const setRules = (rules: AutoVerifyRule[]) => save({ autoVerify: { ...autoVerify, rules } });
  const addRule = () => {
    const when = draft.trim();
    if (!when) return;
    setRules([...autoVerify.rules, { id: `${Date.now().toString(36)}-${autoVerify.rules.length}`, when, decision: draftDecision }]);
    setDraft("");
  };
  const inputClass = "w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[14px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none";
  const toggleAutoVerify = () => save({ autoVerify: { ...autoVerify, enabled: !autoVerify.enabled } });

  return (
    <div className="mt-4 rounded-xl bg-card p-4">
      <div className="text-[15px] font-medium text-ink">Bot</div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="text-[15px] font-medium text-ink">{polish ? "Strefa czasowa" : "Time zone"}</div>
        <TimeZonePicker value={timeZone} onChange={(zone) => save({ timeZone: zone })} polish={polish} />
      </div>
      <div className="mt-4 flex items-start justify-between gap-3 border-t border-hairline/40 pt-4">
        <div className="min-w-0"><div className="text-[15px] font-medium text-ink">{polish ? "Autoweryfikacja" : "Auto-verification"}</div><div className="mt-0.5 text-[13px] text-ink-secondary">{polish ? "MultiBot sprawdza każdą akcję przed jej uruchomieniem i w razie potrzeby najpierw pyta Ciebie." : "MultiBot checks each action before running it and asks you first when needed."}</div></div>
        <div
          role="switch"
          tabIndex={0}
          aria-checked={autoVerify.enabled}
          aria-label={polish ? "Autoweryfikacja" : "Auto-verification"}
          onClick={toggleAutoVerify}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              toggleAutoVerify();
            }
          }}
          className={cn("relative mt-1 shrink-0 cursor-pointer border border-hairline/40 transition-colors", autoVerify.enabled ? "bg-accent" : "bg-raised-hover")}
          style={{ width: 44, height: 26, borderRadius: 13, display: "inline-block" }}
        >
          <span
            className="absolute rounded-full bg-white"
            style={{ width: 20, height: 20, top: 3, left: autoVerify.enabled ? 21 : 3, transition: "left 150ms ease" }}
          />
        </div>
      </div>
      <div className="mt-4 border-t border-hairline/40 pt-4">
        <div className="text-[15px] font-medium text-ink">{polish ? "Reguły Autoweryfikacji" : "Auto-verification rules"}</div>
        <div className="mt-0.5 text-[13px] text-ink-secondary">{polish ? "Dodaj reguły, aby określić, kiedy MultiBot może działać bez pytania." : "Add rules to decide when MultiBot may act without asking."}</div>
        {autoVerify.rules.length > 0 && <div className="mt-3 flex flex-col gap-2">{autoVerify.rules.map((rule) => <div key={rule.id} className="flex items-center justify-between gap-3 rounded-lg bg-inset px-3 py-2"><div className="min-w-0"><div className="truncate text-[13px] font-medium text-ink">{rule.when}</div><div className="truncate text-[11px] text-ink-secondary">{rule.decision === "allow" ? polish ? "Zezwalaj automatycznie" : "Allow automatically" : polish ? "Najpierw pytaj" : "Ask first"}</div></div><button type="button" onClick={() => setRules(autoVerify.rules.filter((item) => item.id !== rule.id))} aria-label={polish ? "Usuń regułę" : "Remove rule"} className="shrink-0 rounded-md p-1.5 text-ink-secondary hover:bg-raised hover:text-danger"><Trash2 size={14} /></button></div>)}</div>}
        <div className="mt-3 text-[13px] text-ink-secondary">{polish ? "Gdy MultiBot chce:" : "When MultiBot wants to:"}</div>
        <input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addRule(); } }} placeholder={polish ? "np. odpowiadaj za mnie na e-maile" : "e.g. reply to emails for me"} className={cn(inputClass, "mt-1.5")} />
        <div className="mt-3 text-[13px] text-ink-secondary">{polish ? "Powinien:" : "It should:"}</div>
        <div className="mt-1.5 flex items-center justify-between gap-2"><DecisionSelect value={draftDecision} onChange={setDraftDecision} polish={polish} /><button type="button" onClick={addRule} disabled={!draft.trim()} className="shrink-0 rounded-lg bg-raised px-3 py-1.5 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-40">{polish ? "Dodaj regułę" : "Add rule"}</button></div>
        <div className="mt-3 text-[13px] text-ink-secondary">{polish ? "Te reguły dotyczą tylko Ciebie." : "These rules apply to you only."}</div>
      </div>
    </div>
  );
}
