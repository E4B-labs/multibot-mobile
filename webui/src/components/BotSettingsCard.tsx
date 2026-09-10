import { useState } from "react";
import { Check } from "lucide-react";
import { useStore } from "@/state/store";
import { authFetch } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { AUTO_TIMEZONE } from "@/lib/timezone";
import { TimeZonePicker } from "./TimeZonePicker";
import { DEFAULT_AUTO_VERIFY, type AutoVerifySettings } from "@/lib/autoVerifyTypes";
import { Spinner } from "./Loading";

export function BotSettingsCard({ polish }: { polish: boolean }) {
  const { state, dispatch } = useStore();
  const timeZone = state.config?.timeZone ?? AUTO_TIMEZONE;
  const autoVerify = state.config?.autoVerify ?? DEFAULT_AUTO_VERIFY;
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");

  const save = (patch: { timeZone?: string; autoVerify?: AutoVerifySettings }) => {
    setSaveState("saving");
    void authFetch("/api/config", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) })
      .then((response) => response.json())
      .then((config) => {
        dispatch({ type: "configStatus", config });
        setSaveState("saved");
        window.setTimeout(() => setSaveState("idle"), 1500);
      })
      .catch(() => setSaveState("idle"));
  };
  const toggleAutoVerify = () => save({ autoVerify: { ...autoVerify, enabled: !autoVerify.enabled } });

  return (
    <div className="mt-4 rounded-xl bg-card p-4">
      <div className="flex items-center gap-2">
        <div className="text-[15px] font-medium text-ink">Bot</div>
        {saveState === "saving" && <Spinner size={13} className="text-ink-secondary" />}
        {saveState === "saved" && <Check size={14} className="text-ink-secondary" />}
      </div>
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
    </div>
  );
}
