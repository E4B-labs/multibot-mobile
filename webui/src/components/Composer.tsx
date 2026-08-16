import { track } from "@/lib/analytics";
import { useEffect, useMemo, useRef, useState } from "react";
import { Brain, Camera, File as FileIcon, Images, Loader2, Mic, Plus, Square, Wand2, X } from "lucide-react";
import { useStore, type Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import { authFetch } from "@/lib/auth";
import { MausAvatar } from "./Avatar";
import { normalizeState } from "@/lib/mascot";

/** The active @mention query at the caret: the text between an `@` that
 * starts a word and the caret. null = no mention being typed. */
function mentionQueryAt(text: string, caret: number): { start: number; query: string } | null {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf("@");
  if (at === -1) return null;
  if (at > 0 && !/\s/.test(upto[at - 1])) return null; // user@host, not a tag
  const query = upto.slice(at + 1);
  if (query.length > 24 || query.includes("@") || query.includes("\n")) return null;
  return { start: at, query };
}

// multibot: F8 — /slash autocomplete. Skill wysyła się jako ZWYKŁA wiadomość:
// gateway silnika sam rozwiązuje `/nazwa reszta` na treść skilla
// (engine/server/gateway.py → skills.slash_message), więc picker tylko wstawia
// tekst. Zapytanie jest aktywne, dopóki cała treść to jeden token "/..." —
// spacja kończy komendę i zamyka picker (rozłączne z @mention: tam pierwszym
// znakiem tokenu jest "@" po spacji, tu "/" na początku wiadomości).
function slashQuery(text: string): string | null {
  if (!/^\/\S*$/.test(text)) return null;
  return text.slice(1).toLowerCase();
}

/** Wiersze pickera: kształt z GET /api/engine/skills (engine/server/skills.py). */
interface SlashSkill {
  name: string;
  command: string;
  description: string;
}

interface PendingAttachment {
  id: string;
  file: File;
  preview?: string;
  status: "ready" | "uploading" | "error";
}

const fileSize = (size: number) => size >= 1024 * 1024
  ? `${(size / 1024 / 1024).toFixed(1)} MB`
  : `${Math.max(1, Math.round(size / 1024))} KB`;

type ReasoningLevel = "default" | "low" | "medium" | "high" | "xhigh" | "max";
const REASONING_LEVELS: Array<{ id: ReasoningLevel; label: string }> = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "X high" },
  { id: "max", label: "Max" },
];

function reasoningLevels(model: string) {
  // Claude Code does not expose adaptive effort for Haiku; leave provider
  // default intact instead of sending an unsupported value.
  if (model.toLowerCase().includes("haiku")) return [{ id: "default" as const, label: "Default" }];
  return model.startsWith("gpt-5.6-") ? REASONING_LEVELS : REASONING_LEVELS.filter((level) => level.id !== "max");
}

export function Composer({ bot }: { bot: Bot }) {
  const { state, dispatch } = useStore();
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [attachOpen, setAttachOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [caret, setCaret] = useState(0);
  const [highlight, setHighlight] = useState(0);
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const [reasoning, setReasoning] = useState<ReasoningLevel>("low");
  const [dismissedAt, setDismissedAt] = useState<number | null>(null); // Esc'd this @
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const photosRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const previewUrls = useRef(new Set<string>());
  // what was typed before the mic went on — partials append after it
  const baseText = useRef("");

  // multibot: Web Speech API dictation — works in any Chrome, including plain
  // vite on Windows. The Electron bridge keeps priority when present (packaged
  // macOS: webkitSpeechRecognition exists there but its recognition service
  // fails without a Google key); Web Speech covers every browser without the
  // bridge. Final results append after baseText; interim results show live in
  // the input. Recognition language follows navigator.language. Second mic
  // click / Esc stops.
  const WebSpeech: (new () => any) | undefined =
    (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
  // multibot: G5 — microphone APIs require secure context; localhost remains
  // the browser exception, plain LAN HTTP must explain limitation clearly.
  const secureContext = window.isSecureContext || ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  const webSpeechActive = !!WebSpeech && !window.ogb && secureContext;
  const webRec = useRef<any>(null);
  useEffect(() => {
    if (!recording || !webSpeechActive) return;
    setSpeechError(null);
    const rec: any = new WebSpeech();
    webRec.current = rec;
    rec.lang = navigator.language || "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) {
          const t = String(r[0]?.transcript ?? "").trim();
          if (t) baseText.current = baseText.current ? `${baseText.current} ${t}` : t;
        } else {
          interim += r[0]?.transcript ?? "";
        }
      }
      const shown = interim.trim()
        ? baseText.current
          ? `${baseText.current} ${interim.trim()}`
          : interim.trim()
        : baseText.current;
      setText(shown);
    };
    rec.onerror = (e: any) => {
      if (e?.error === "not-allowed" || e?.error === "service-not-allowed") {
        setSpeechError("Dictation needs microphone access — allow it for this site.");
      } else if (e?.error && e.error !== "aborted" && e.error !== "no-speech") {
        setSpeechError(`Dictation failed: ${e.error}`);
      }
      setRecording(false);
    };
    rec.onend = () => setRecording(false);
    rec.start();
    return () => {
      webRec.current = null;
      rec.onresult = rec.onerror = rec.onend = null;
      try {
        rec.stop();
      } catch {
        /* already stopped */
      }
    };
  }, [recording, WebSpeech]);

  // ── @mention picker (tag another bot; the agent reaches it via ask_bot) ──
  const mention = mentionQueryAt(text, caret);
  const candidates = useMemo(() => {
    if (!mention || mention.start === dismissedAt) return [];
    const peers = state.bots.filter((b) => b.id !== bot.id && !b.hidden);
    const q = mention.query.trim().toLowerCase();
    // "@Scout " — the full name plus a space — is a COMPLETED tag, not a
    // search: keep the picker closed so Enter sends instead of re-picking
    if (mention.query.endsWith(" ") && peers.some((b) => b.name.toLowerCase() === q)) return [];
    return peers.filter((b) => !q || b.name.toLowerCase().includes(q)).slice(0, 6);
  }, [mention, dismissedAt, state.bots, bot.id]);
  const pickerOpen = candidates.length > 0;

  useEffect(() => setHighlight(0), [mention?.start, mention?.query]);

  // multibot: F8 — picker skilli po "/": mechanika 1:1 z @mention (strzałki,
  // Enter/Tab wstawia, Esc chowa do następnej zmiany tekstu). Listę bierzemy
  // leniwie przy pierwszym "/" — tylko dla botów na driverze slafy; silnik
  // offline = brak listy = brak pickera, wiadomość idzie jak zwykły tekst.
  const slafyDriver =
    state.instances.find((i) => i.instanceId === bot.modelSelection.instanceId)?.driverKind ===
    "slafy";
  const [slashSkills, setSlashSkills] = useState<SlashSkill[] | null>(null);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const [slashHighlight, setSlashHighlight] = useState(0);
  // `/model` belongs to harness, so it works for every provider. Skill
  // commands remain engine-backed and only load for local engine bots.
  const slashQ = slashQuery(text);
  const engineSlashQ = slafyDriver ? slashQ : null;
  useEffect(() => {
    if (engineSlashQ === null || slashSkills !== null) return;
    let alive = true;
    authFetch("/api/engine/skills")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((ss: SlashSkill[]) => alive && setSlashSkills(ss))
      .catch(() => alive && setSlashSkills([]));
    return () => {
      alive = false;
    };
  }, [engineSlashQ, slashSkills]);
  const slashCandidates = useMemo(() => {
    if (slashQ === null || slashDismissed) return [];
    const modelCommand: SlashSkill = { name: "model", command: "/model", description: "Switch provider and model" };
    const commands = [modelCommand, ...(slafyDriver && slashSkills ? slashSkills : [])];
    return commands.filter((s) => !slashQ || s.name.toLowerCase().includes(slashQ)).slice(0, 6);
  }, [slashQ, slashDismissed, slashSkills, slafyDriver]);
  const slashOpen = slashCandidates.length > 0;
  useEffect(() => setSlashHighlight(0), [slashQ]);

  const pickSlash = (skill: SlashSkill) => {
    const next = `${skill.command} `;
    setText(next);
    setCaret(next.length);
    setSlashDismissed(true); // wybór kończy komendę — następny Enter wysyła
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(next.length, next.length);
    });
  };

  const pickMention = (peer: Bot) => {
    if (!mention) return;
    const after = text.slice(caret);
    const next = `${text.slice(0, mention.start)}@${peer.name} ${after}`;
    setText(next);
    const newCaret = mention.start + peer.name.length + 2;
    setCaret(newCaret);
    // picking completes this tag — close the popup so the next Enter sends
    setDismissedAt(mention.start);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(newCaret, newCaret);
    });
  };

  const availableReasoning = reasoningLevels(bot.modelSelection.model);
  useEffect(() => {
    setReasoning((current) => availableReasoning.some((item) => item.id === current) ? current : availableReasoning[0].id);
    setReasoningOpen(false);
  }, [bot.modelSelection.model]);

  useEffect(() => {
    if (!attachOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAttachOpen(false);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [attachOpen]);

  useEffect(() => () => {
    for (const url of previewUrls.current) URL.revokeObjectURL(url);
  }, []);

  const addFiles = (list: FileList | null) => {
    if (!list?.length) return;
    setAttachmentError(null);
    const incoming = [...list];
    if (attachments.length + incoming.length > 10) {
      setAttachmentError("Maximum 10 attachments per message.");
      return;
    }
    const tooLarge = incoming.find((file) => file.size > (file.type.startsWith("image/") ? 8 : 25) * 1024 * 1024);
    if (tooLarge) {
      setAttachmentError(`${tooLarge.name} exceeds ${tooLarge.type.startsWith("image/") ? 8 : 25} MB limit.`);
      return;
    }
    setAttachments((current) => [...current, ...incoming.map((file) => {
      const preview = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
      if (preview) previewUrls.current.add(preview);
      return { id: crypto.randomUUID(), file, preview, status: "ready" as const };
    })]);
    setAttachOpen(false);
  };

  const removeAttachment = (id: string) => setAttachments((current) => current.filter((item) => {
    if (item.id === id && item.preview) {
      URL.revokeObjectURL(item.preview);
      previewUrls.current.delete(item.preview);
    }
    return item.id !== id;
  }));

  const send = async () => {
    if ((!text.trim() && !attachments.length) || bot.busy || uploading) return;
    setUploading(true);
    setAttachmentError(null);
    try {
      const attachmentIds = await Promise.all(attachments.map(async (item) => {
        setAttachments((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, status: "uploading" } : candidate));
        const response = await authFetch(`/api/bots/${bot.id}/attachments`, {
          method: "POST",
          headers: {
            "content-type": item.file.type || "application/octet-stream",
            "x-file-name": encodeURIComponent(item.file.name),
          },
          body: item.file,
        });
        if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? `Upload failed (HTTP ${response.status})`);
        return String((await response.json()).id);
      }));
      dispatch({
        type: "send",
        botId: bot.id,
        text: text.trim(),
        attachmentIds,
        ...(reasoning !== "default" ? { reasoning } : {}),
      });
      track("message_sent", { driver: bot.modelSelection?.instanceId });
      setText("");
      for (const item of attachments) if (item.preview) URL.revokeObjectURL(item.preview);
      previewUrls.current.clear();
      setAttachments([]);
    } catch (error) {
      setAttachments((current) => current.map((item) => item.status === "uploading" ? { ...item, status: "error" } : item));
      setAttachmentError(error instanceof Error ? error.message : String(error));
    } finally {
      setUploading(false);
    }
  };

  // native dictation: partials stream into the input while the Swift
  // helper runs; the final transcript stays in the box, ready to edit/send
  useEffect(() => {
    if (!recording) return;
    // multibot: Web Speech owns this recording when the bridge is absent
    if (webSpeechActive) return;
    const bridge = window.ogb;
    if (!bridge) {
      setRecording(false);
      return;
    }
    setSpeechError(null);
    const offTranscript = bridge.onSpeechTranscript((line) => {
      if (typeof line.text === "string") {
        const base = baseText.current;
        setText(base ? `${base} ${line.text}` : line.text);
      }
    });
    const offEnd = bridge.onSpeechEnd(({ code }) => {
      setRecording(false);
      if (code === 1) {
        setSpeechError(
          "Dictation needs Microphone + Speech Recognition access — System Settings → Privacy & Security.",
        );
      }
    });
    void bridge.speechStart();
    return () => {
      offTranscript();
      offEnd();
      void bridge.speechStop();
    };
  }, [recording]);

  const toggleMic = () => {
    if (!secureContext && !window.ogb) {
      setSpeechError("Dictation is unavailable over plain HTTP. Open this app on localhost or HTTPS (for example Tailscale).");
      return;
    }
    // multibot: bridge first (packaged app), Web Speech in plain browsers
    if (webSpeechActive) {
      baseText.current = text.trim();
      setRecording((r) => !r);
      return;
    }
    if (!window.ogb) {
      setSpeechError("Voice input needs the desktop app — run pnpm dev:desktop.");
      return;
    }
    baseText.current = text.trim();
    setRecording((r) => !r);
  };

  return (
    <div className="sticky bottom-0 z-20 bg-app px-5 pb-5 pt-2">
      {!secureContext && !window.ogb && (
        <div className="mx-auto mb-2 max-w-[900px] rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[12px] text-warning">
          Dictation needs a secure context: use HTTPS or localhost. Plain HTTP on a LAN cannot access the microphone.
        </div>
      )}
      {speechError && (
        <div className="mx-auto mb-2 max-w-[900px] rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[12px] text-warning">
          {speechError}
        </div>
      )}
      {attachmentError && (
        <div className="mx-auto mb-2 max-w-[900px] rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">
          {attachmentError}
        </div>
      )}
      <div className="relative mx-auto max-w-[900px]">
        <input ref={cameraRef} hidden type="file" accept="image/*" capture="environment" onChange={(event) => { addFiles(event.target.files); event.target.value = ""; }} />
        <input ref={photosRef} hidden type="file" accept="image/*" multiple onChange={(event) => { addFiles(event.target.files); event.target.value = ""; }} />
        <input ref={filesRef} hidden type="file" multiple onChange={(event) => { addFiles(event.target.files); event.target.value = ""; }} />
        {/* multibot: F8 — picker skilli po "/", ten sam dropdown co @mention */}
        {slashOpen && (
          <div className="absolute bottom-full left-10 z-20 mb-2 w-72 overflow-hidden rounded-xl border border-hairline/40 bg-raised shadow-lg">
            {slashCandidates.map((skill, i) => (
              <button
                key={skill.name}
                onClick={() => pickSlash(skill)}
                onMouseEnter={() => setSlashHighlight(i)}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-2 text-left",
                  i === slashHighlight ? "bg-raised-hover" : "",
                )}
              >
                <span className="flex size-6 shrink-0 items-center justify-center text-ink-secondary">
                  <Wand2 size={15} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium text-ink">{skill.command}</span>
                  {skill.description && (
                    <span className="block truncate text-xs text-ink-secondary">{skill.description}</span>
                  )}
                </span>
              </button>
            ))}
          </div>
        )}
        {pickerOpen && (
          <div className="absolute bottom-full left-10 z-20 mb-2 w-72 overflow-hidden rounded-xl border border-hairline/40 bg-raised shadow-lg">
            {candidates.map((peer, i) => (
              <button
                key={peer.id}
                onClick={() => pickMention(peer)}
                onMouseEnter={() => setHighlight(i)}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-2 text-left",
                  i === highlight ? "bg-raised-hover" : "",
                )}
              >
                <MausAvatar color={peer.color} shape={peer.mascotShape} state={normalizeState(peer.mascotExpression) ?? "happy"} size={24} />
                <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink">{peer.name}</span>
                <span className="shrink-0 text-xs text-ink-secondary">Agent</span>
              </button>
            ))}
          </div>
        )}
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2" aria-label="Attachments ready to send">
            {attachments.map((item) => (
              <div key={item.id} className="flex max-w-64 items-center gap-2 rounded-xl border border-hairline/40 bg-raised px-2 py-1.5 text-xs text-ink">
                {item.preview ? <img src={item.preview} alt="" className="size-9 rounded-lg object-cover" /> : <FileIcon size={18} className="shrink-0 text-ink-secondary" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{item.file.name}</span>
                  <span className="text-ink-secondary">{fileSize(item.file.size)}</span>
                </span>
                {item.status === "uploading" ? <Loader2 size={14} className="animate-spin text-ink-secondary" /> : (
                  <button type="button" onClick={() => removeAttachment(item.id)} aria-label={`Remove ${item.file.name}`} className="rounded-full p-1 text-ink-secondary hover:bg-raised-hover hover:text-ink">
                    <X size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {attachOpen && (
          <div id="attachment-menu" className="absolute bottom-full left-0 z-30 mb-2 min-w-44 overflow-hidden rounded-xl border border-hairline/40 bg-card p-1 shadow-xl" role="menu">
            {[
              { label: "Camera", icon: Camera, action: () => cameraRef.current?.click() },
              { label: "Photos", icon: Images, action: () => photosRef.current?.click() },
              { label: "Files", icon: FileIcon, action: () => filesRef.current?.click() },
            ].map(({ label, icon: Icon, action }) => (
              <button key={label} type="button" role="menuitem" onClick={action} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-ink hover:bg-raised">
                <Icon size={16} className="text-ink-secondary" /> {label}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 rounded-full border border-hairline/40 bg-raised/60 py-2 pl-2 pr-2">
        <button
          type="button"
          onClick={() => setAttachOpen((open) => !open)}
          aria-expanded={attachOpen}
          aria-haspopup="menu"
          aria-controls="attachment-menu"
          disabled={bot.busy || uploading}
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-raised hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          title="Attach"
        >
          <Plus size={20} />
        </button>
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setCaret(e.target.selectionStart ?? e.target.value.length);
            setDismissedAt(null);
            setSlashDismissed(false); // multibot: F8 — Esc chowa picker tylko do następnej zmiany
          }}
          onKeyUp={(e) => setCaret((e.target as HTMLInputElement).selectionStart ?? 0)}
          onClick={(e) => setCaret((e.target as HTMLInputElement).selectionStart ?? 0)}
          onKeyDown={(e) => {
            // multibot: F8 — nawigacja pickera skilli; rozłączny z @mention
            // (slash tylko, gdy cała treść to "/token"), więc bez kolizji gałęzi
            if (slashOpen) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const delta = e.key === "ArrowDown" ? 1 : -1;
                setSlashHighlight((h) => (h + delta + slashCandidates.length) % slashCandidates.length);
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                pickSlash(slashCandidates[slashHighlight]);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setSlashDismissed(true);
                return;
              }
            }
            if (pickerOpen) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const delta = e.key === "ArrowDown" ? 1 : -1;
                setHighlight((h) => (h + delta + candidates.length) % candidates.length);
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                pickMention(candidates[highlight]);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setDismissedAt(mention?.start ?? null);
                return;
              }
            }
            if (e.key === "Enter") void send();
            if (e.key === "Escape" && attachOpen) setAttachOpen(false);
            if (e.key === "Escape" && recording) setRecording(false);
          }}
          placeholder={
            recording ? "Listening…" : bot.busy ? `${bot.name} is working…` : `Message ${bot.name}`
          }
          className="w-full bg-transparent text-[15px] text-ink placeholder:text-ink-secondary focus:outline-none"
        />
        <div className="relative shrink-0">
          <button
            onClick={() => setReasoningOpen((open) => !open)}
            aria-expanded={reasoningOpen}
            aria-label="Reasoning effort"
            className="flex h-8 items-center gap-1 rounded-full px-2 text-[11px] font-medium text-ink-secondary hover:bg-raised hover:text-ink"
            title={`Reasoning: ${availableReasoning.find((item) => item.id === reasoning)?.label ?? "Default"}`}
          >
            <Brain size={15} />
            <span>{availableReasoning.find((item) => item.id === reasoning)?.label ?? "Default"}</span>
          </button>
          {reasoningOpen && (
            <div className="absolute bottom-full right-0 z-30 mb-2 min-w-32 overflow-hidden rounded-xl border border-hairline/40 bg-card p-1 shadow-xl">
              {availableReasoning.map((item) => (
                <button
                  key={item.id}
                  onClick={() => { setReasoning(item.id); setReasoningOpen(false); }}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-left text-[12px] text-ink",
                    reasoning === item.id ? "bg-raised" : "hover:bg-raised/60",
                  )}
                >
                  {item.label}
                  {reasoning === item.id && <span className="text-accent">✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        {bot.busy ? (
          <button
            onClick={() => dispatch({ type: "interrupt", botId: bot.id })}
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-raised hover:text-ink"
            title="Stop"
          >
            <Square size={14} className="fill-current" />
          </button>
        ) : (
          <button
            onClick={toggleMic}
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-full",
              recording
                ? "animate-pulse bg-danger/20 text-danger"
                : "text-ink-secondary hover:bg-raised hover:text-ink",
            )}
            title={recording ? "Stop dictation (Esc)" : "Dictate"}
          >
            <Mic size={18} />
          </button>
        )}
        </div>
      </div>
    </div>
  );
}
