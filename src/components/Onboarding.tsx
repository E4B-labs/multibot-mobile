import { useEffect, useState } from "react";
import { Check, AlertTriangle, Loader2, Mic } from "lucide-react";
import { MausAvatar } from "./Avatar";
import { identifyEmail, setEmailGateDone, track } from "@/lib/analytics";
import { authFetch } from "@/lib/auth";

type CliTool = {
  id: string;
  displayName: string;
  detected: boolean;
  reason?: string;
  version?: string;
  installCommand?: string | null;
};

type DeviceInfo = {
  hostname?: string;
  platform?: string;
  arch?: string;
  ramBytes?: number;
  memoryGb?: number;
  python?: boolean;
  pythonVersion?: string | null;
  docker?: boolean;
  dockerVersion?: string | null;
  engineInstalled?: boolean;
};

type Progress = { id?: string; step?: string; message?: string; done?: boolean; error?: string };
const isElectron = navigator.userAgent.includes("Electron");
const inputClass = "w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2.5 text-[14px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none";

function StatusRow({ ok, warn, title, detail, action }: { ok: boolean; warn?: boolean; title: string; detail: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-xl bg-card p-3.5">
      <span className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full ${ok ? "bg-[#00c97222] text-[#38d591]" : warn ? "bg-[#ff980022] text-[#ff9800]" : "bg-raised text-ink-secondary"}`}>
        {ok ? <Check size={14} /> : <AlertTriangle size={13} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-medium text-ink">{title}</div>
        <div className="mt-0.5 text-[12.5px] leading-relaxed text-ink-secondary">{detail}</div>
      </div>
      {action}
    </div>
  );
}

function ProgressBox({ progress, onClose }: { progress: Progress | null; onClose?: () => void }) {
  if (!progress) return null;
  return (
    <div className="mt-3 rounded-xl bg-inset p-3 text-[12.5px] text-ink-secondary">
      <div className="flex items-center gap-2">
        {!progress.done && !progress.error && <Loader2 size={14} className="animate-spin" />}
        <span>{progress.error ?? progress.message ?? progress.step ?? (progress.done ? "Done" : "Working…")}</span>
        {progress.done && onClose && <button onClick={onClose} className="ml-auto text-ink hover:text-accent">Hide</button>}
      </div>
    </div>
  );
}

async function readProgress(path: string, onProgress: (value: Progress) => void): Promise<void> {
  const response = await authFetch(path, { headers: { accept: "text/event-stream" } });
  if (!response.ok || !response.body) throw new Error(`Progress unavailable (${response.status})`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) return;
    buffer += decoder.decode(chunk.value, { stream: true });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() ?? "";
    for (const event of events) {
      const data = event.split(/\r?\n/).find((line) => line.startsWith("data:"))?.slice(5).trim();
      if (!data) continue;
      try { onProgress(JSON.parse(data) as Progress); } catch { /* ignore keepalive */ }
    }
  }
}

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [serverWanted, setServerWanted] = useState<boolean | null>(null);
  const [provision, setProvision] = useState<Progress | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [cli, setCli] = useState<CliTool[] | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [cliProgress, setCliProgress] = useState<Progress | null>(null);
  const [modelName, setModelName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [modelError, setModelError] = useState<string | null>(null);
  const [perms, setPerms] = useState<{ mic: string } | null>(null);
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());

  useEffect(() => {
    track("onboarding_step", { step });
    if (step === 0 && !device) {
      authFetch("/api/device")
        .then((response) => response.json())
        .then(setDevice)
        .catch((error) => setDeviceError(error instanceof Error ? error.message : String(error)));
    }
    if (step === 2 && !cli) {
      authFetch("/api/cli-tools")
        .then((response) => response.json())
        .then((body) => setCli(body.tools ?? []))
        .catch(() => setCli([]));
    }
    if (step === 4 && isElectron) {
      const poll = () => window.ogb?.permStatus?.().then(setPerms).catch(() => {});
      poll();
      const timer = setInterval(poll, 2000);
      return () => clearInterval(timer);
    }
  }, [step, device, cli]);

  const startProvision = async () => {
    setProvision({ message: "Starting server setup…" });
    try {
      const response = await authFetch("/api/provision", { method: "POST", body: JSON.stringify({ server: true }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `Setup failed (${response.status})`);
      const id = body.id ?? body.jobId ?? body.progressId;
      if (id) await readProgress(`/api/progress/${encodeURIComponent(id)}`, setProvision);
      else setProvision({ done: true, message: "Server setup started." });
    } catch (error) {
      setProvision({ error: error instanceof Error ? error.message : String(error) });
    }
  };

  const saveProfile = () => {
    identifyEmail(email.trim().toLowerCase());
    void authFetch("/api/config", { method: "PUT", body: JSON.stringify({ profile: { name: name.trim(), email: email.trim().toLowerCase() } }) });
    setStep(2);
  };

  const installCli = async (id: string) => {
    setInstalling(id);
    setCliProgress({ message: `Installing ${id}…` });
    try {
      const response = await authFetch(`/api/cli-tools/${encodeURIComponent(id)}/install`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `Install failed (${response.status})`);
      const job = body.id ?? body.jobId ?? body.progressId;
      if (job) await readProgress(`/api/progress/${encodeURIComponent(job)}`, setCliProgress);
      else setCliProgress({ done: true, message: "Installation started." });
      const refreshed = await authFetch("/api/cli-tools").then((response) => response.json());
      setCli(refreshed.tools ?? []);
    } catch (error) {
      setCliProgress({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      setInstalling(null);
    }
  };

  const saveCustomModel = async () => {
    if (!modelName.trim() || !baseUrl.trim() || !model.trim() || !apiKey.trim()) return;
    setModelError(null);
    try {
      const id = modelName.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^[-_]+/, "").slice(0, 64) || "custom-model";
      const response = await authFetch(`/api/models/custom/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify({ displayName: modelName.trim(), baseUrl: baseUrl.trim(), model: model.trim(), apiKey: apiKey.trim() }),
      });
      if (!response.ok) throw new Error((await response.json()).error ?? `Save failed (${response.status})`);
      setApiKey("");
      setModelError(null);
    } catch (error) {
      setModelError(error instanceof Error ? error.message : String(error));
    }
  };

  const finish = () => {
    track("onboarding_completed", { engines_available: cli?.filter((item) => item.detected).length ?? -1, mic: perms?.mic ?? "n/a" });
    setEmailGateDone("submitted");
    onDone();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-app py-6">
      <div className="flex w-[460px] flex-col rounded-2xl border border-hairline/40 bg-panel p-8">
        {step === 0 && <div className="flex flex-col">
          <MausAvatar color="green" state="happy" size={72} />
          <h1 className="mt-4 text-[20px] font-semibold text-ink">Set up this device</h1>
          <p className="mt-1.5 text-[14px] leading-relaxed text-ink-secondary">We scan this device so setup matches its capabilities.</p>
          {device ? <div className="mt-4 rounded-xl bg-card p-3.5 text-[13px] text-ink-secondary">
            <div className="font-medium text-ink">{device.hostname ?? "This device"}</div>
            <div className="mt-1">{device.platform ?? "Unknown platform"} · {device.arch ?? "unknown architecture"}{device.memoryGb ? ` · ${device.memoryGb} GB RAM` : ""}</div>
            <div className="mt-1">Python {device.pythonVersion ?? (device.python ? "available" : "not found")} · Docker {device.dockerVersion ?? (device.docker ? "available" : "not found")}</div>
          </div> : <div className="mt-5 flex items-center gap-2 text-ink-secondary"><Loader2 size={16} className="animate-spin" /> Scanning device…</div>}
          {deviceError && <div className="mt-3 text-[12px] text-danger">{deviceError}</div>}
          <div className="mt-5 text-[14px] font-medium text-ink">Keep a bot server running here 24/7?</div>
          <div className="mt-3 flex gap-2">
            <button onClick={() => { setServerWanted(true); void startProvision(); }} className="flex-1 rounded-lg bg-accent py-2.5 text-[14px] font-medium text-white">Yes, set it up</button>
            <button onClick={() => { setServerWanted(false); setStep(1); }} className="flex-1 rounded-lg bg-raised py-2.5 text-[14px] text-ink">Not now</button>
          </div>
          {serverWanted && <ProgressBox progress={provision} />}
          {serverWanted && provision && !provision.done && <button onClick={() => setStep(1)} className="mt-3 text-[12px] text-ink-secondary hover:text-ink">Continue in background</button>}
          {serverWanted && provision?.done && <button onClick={() => setStep(1)} className="mt-3 w-full rounded-lg bg-raised py-2.5 text-[14px] text-ink">Continue</button>}
        </div>}

        {step === 1 && <div className="flex flex-col">
          <h1 className="text-[18px] font-semibold text-ink">About you</h1>
          <p className="mt-1 text-[13.5px] text-ink-secondary">Choose how we should address you.</p>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className={`mt-5 ${inputClass}`} />
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && valid && saveProfile()} placeholder="you@example.com" className={`mt-3 ${inputClass}`} />
          <button onClick={saveProfile} disabled={!valid} className="mt-3 w-full rounded-lg bg-accent py-2.5 text-[15px] font-medium text-white disabled:opacity-40">Continue</button>
          <button onClick={() => setStep(2)} className="mt-3 text-[12px] text-ink-secondary hover:text-ink">Maybe later</button>
        </div>}

        {step === 2 && <div className="flex flex-col">
          <h1 className="text-[18px] font-semibold text-ink">Command-line tools</h1>
          <p className="mt-1 text-[13.5px] text-ink-secondary">Detected tools can run bots here. Missing tools can be installed from this screen.</p>
          {!cli ? <div className="flex items-center gap-2 py-6 text-ink-secondary"><Loader2 size={16} className="animate-spin" /> Checking…</div> : <div className="mt-4 flex flex-col gap-2.5">
            {cli.length ? cli.map((item) => <StatusRow key={item.id} ok={item.detected} warn title={item.displayName} detail={item.detected ? item.version ?? "Installed. Sign in from its terminal." : item.reason ?? "Not found."} action={!item.detected && item.installCommand ? <button onClick={() => void installCli(item.id)} disabled={installing !== null} title={item.installCommand} className="shrink-0 rounded-lg bg-raised px-3 py-1.5 text-[12px] text-ink disabled:opacity-50">{installing === item.id ? "Installing…" : "Install"}</button> : undefined} />) : <div className="rounded-xl bg-card p-3.5 text-[13px] text-ink-secondary">No tools detected yet.</div>}
          </div>}
          <ProgressBox progress={cliProgress} />
          <button onClick={() => setStep(3)} className="mt-5 w-full rounded-lg bg-accent py-2.5 text-[15px] font-medium text-white">Continue</button>
        </div>}

        {step === 3 && <div className="flex flex-col">
          <h1 className="text-[18px] font-semibold text-ink">Add a custom model</h1>
          <p className="mt-1 text-[13.5px] text-ink-secondary">Optional. Use any OpenAI-compatible endpoint, including a local model.</p>
          <input autoFocus value={modelName} onChange={(e) => setModelName(e.target.value)} placeholder="Name" className={`mt-4 ${inputClass}`} />
          <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="Base URL · https://…/v1" className={`mt-2 ${inputClass}`} />
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Model id" className={`mt-2 ${inputClass}`} />
          <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="API key" autoComplete="off" className={`mt-2 ${inputClass}`} />
          <button onClick={() => void saveCustomModel()} disabled={!modelName.trim() || !baseUrl.trim() || !model.trim() || !apiKey.trim()} className="mt-3 w-full rounded-lg bg-raised py-2.5 text-[14px] text-ink disabled:opacity-40">Save model</button>
          {modelError && <div className="mt-2 text-[12px] text-danger">{modelError}</div>}
          <div className="mt-4 rounded-xl bg-card p-3.5 text-[13px] text-ink-secondary">Need to import an existing profile? Open App Settings after onboarding and choose <span className="text-ink">Import existing profile</span>.</div>
          <button onClick={() => setStep(isElectron ? 4 : 5)} className="mt-5 w-full rounded-lg bg-accent py-2.5 text-[15px] font-medium text-white">Continue</button>
          <button onClick={() => setStep(isElectron ? 4 : 5)} className="mt-3 text-[12px] text-ink-secondary hover:text-ink">Skip for now</button>
        </div>}

        {step === 4 && <div className="flex flex-col">
          <h1 className="text-[18px] font-semibold text-ink">Permissions</h1>
          <p className="mt-1 text-[13.5px] text-ink-secondary">Optional, and only used when you ask for the feature.</p>
          <div className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-card p-3.5"><div className="flex items-start gap-3"><Mic size={18} className="mt-0.5 shrink-0 text-ink-secondary" /><div><div className="text-[14px] font-medium text-ink">Microphone & speech</div><div className="mt-0.5 text-[12.5px] text-ink-secondary">Voice dictation into the composer.</div></div></div>{perms?.mic === "granted" ? <Check size={16} className="text-[#38d591]" /> : <button onClick={() => window.ogb?.permRequestMic?.().then(() => window.ogb?.permStatus?.().then(setPerms))} className="rounded-lg bg-raised px-3 py-1.5 text-[13px] text-ink">Enable</button>}</div>
          <button onClick={finish} className="mt-5 w-full rounded-lg bg-accent py-2.5 text-[15px] font-medium text-white">Start using Multibot</button>
          <button onClick={finish} className="mt-3 text-[12px] text-ink-secondary hover:text-ink">Skip for now</button>
        </div>}
        {step === 5 && <div className="flex flex-col"><h1 className="text-[18px] font-semibold text-ink">Ready</h1><p className="mt-2 text-[13.5px] text-ink-secondary">Your workspace is ready.</p><button onClick={finish} className="mt-5 w-full rounded-lg bg-accent py-2.5 text-[15px] font-medium text-white">Start using Multibot</button></div>}
      </div>
    </div>
  );
}
