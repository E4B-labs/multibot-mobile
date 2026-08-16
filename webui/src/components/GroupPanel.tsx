// multibot: F9-FE — pokój grupowy jako pełny panel rozmowy, taki sam slot jak
// zwykły agent. UI gada wyłącznie z przelotką harnessu
// (`server/engine/proxy.ts`: `/api/engine/<rest>` → `/api/<rest>` silnika):
//   POST /api/engine/groups/<gid>/chat {message} → {turns: [{bot_id, reply}],
//     owner} (engine/server/app.py + groups.py; tury sekwencyjne, render po
//     powrocie requestu — event WS `group` celowo nieużywany).
//
// ŹRÓDŁO HISTORII (decyzja): wypowiedź grupowa idzie zwykłym `gateway.chat`
// BEZ żadnego markera grupy (groups.py `run`), więc w GET /api/bots/<id>/messages
// nie da się odróżnić tury pokoju od tury 1:1 tego samego bota — "filtr po
// prefiksie" nie istnieje. Uczciwym źródłem są odpowiedzi POST /chat z tej
// sesji apki; pełne odpowiedzi i tak lądują w czacie każdego bota pokoju przez
// attach-sync (D4), co panel mówi wprost w pustym stanie.
// ponytail: transkrypt w module-level Map (życie = sesja apki, przeżywa
// zamknięcie/otwarcie panelu); upgrade = transkrypt grupy po stronie silnika,
// gdy pokój ma pamiętać po restarcie apki.
import { useEffect, useState } from "react";
import { Loader2, Send, Users } from "lucide-react";
import { useStore, formatTime, type EngineGroup } from "@/state/store";
import { ChatMarkdown } from "./ChatMarkdown";
import { MausAvatar } from "./Avatar";
import { DrawerToggle } from "./DrawerToggle";
import { stateForBot } from "@/lib/mascot";
import { cn } from "@/lib/cn";
import { authFetch } from "@/lib/auth";
import { useLanguage } from "@/lib/language";

// Ten sam lokalny helper co RoutinesPanel: silnik zwraca błędy jako `{detail}`
// (FastAPI), przelotka jako `{error}`.
async function api(path: string, init?: RequestInit): Promise<any> {
  const res = await authFetch(path, { headers: { "content-type": "application/json" }, ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = typeof body.detail === "string" ? body.detail : undefined;
    throw new Error(detail ?? body.error ?? `${res.status} ${res.statusText}`);
  }
  return body;
}

/** Mirror of engine `groups.run()` (engine/server/groups.py). */
interface GroupChatOut {
  turns: Array<{ bot_id: string; reply: string }>;
  owner: string;
  messages?: Entry[];
}

/** `from`: "you" albo id bota silnika (`mb-<threadId>`). */
interface Entry {
  from: "you" | string;
  text: string;
  at: number;
}

const transcripts = new Map<string, Entry[]>();

export function GroupPanel({ group }: { group: EngineGroup }) {
  const { state } = useStore();
  const polish = useLanguage() === "pl";
  const [entries, setEntries] = useState<Entry[]>(() => group.messages ?? transcripts.get(group.id) ?? []);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api(`/api/groups/${group.id}`)
      .then((saved: { messages?: Entry[] }) => alive && setEntries(saved.messages ?? []))
      .catch(() => {});
    return () => { alive = false; };
  }, [group.id]);

  // Ten sam wzorzec id co EngineUsage/RoutinesPanel: `mb-<threadId>` z
  // decodeConfig w server/drivers/slafy.ts — odwracalny, więc nazwa bota apki
  // wychodzi z samego id; obcy id zostaje jak jest.
  const nameOf = (engineBotId: string) => {
    if (engineBotId === "you") return "You";
    const direct = state.bots.find((b) => b.id === engineBotId);
    if (direct) return direct.name;
    const threadId = engineBotId.startsWith("mb-") ? engineBotId.slice(3) : engineBotId;
    return state.bots.find((b) => b.threadId === threadId)?.name ?? engineBotId;
  };
  const members = group.bot_ids
    .map((engineBotId) => {
      const threadId = engineBotId.startsWith("mb-") ? engineBotId.slice(3) : engineBotId;
      return state.bots.find((b) => b.threadId === threadId || b.id === engineBotId);
    })
    .filter((bot): bot is (typeof state.bots)[number] => Boolean(bot));

  const push = (added: Entry[]) =>
    setEntries((cur) => {
      const next = [...cur, ...added];
      transcripts.set(group.id, next);
      return next;
    });

  const send = () => {
    const message = text.trim();
    if (!message || busy) return;
    setBusy(true);
    setError(null);
    push([{ from: "you", text: message, at: Date.now() }]);
    setText("");
    api(`/api/groups/${group.id}/chat`, {
      method: "POST",
      body: JSON.stringify({ message }),
    })
      .then((out: GroupChatOut) => out.messages
        ? setEntries(out.messages)
        : push(out.turns.map((t) => ({ from: t.bot_id, text: t.reply, at: Date.now() }))))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  return (
    <main className="animate-panel-in flex h-full min-w-0 flex-1 flex-col bg-app">
      {/* Header — ten sam rytm co zwykły panel agenta. `sticky top-0` keeps the
          bar visible while the room scrolls; `DrawerToggle` (mobile) sits inline
          as the first element, sharing the bar's height. */}
      <div className="chat-header sticky top-0 z-20 bg-app flex items-center px-3 py-4">
        <div className="flex min-w-0 items-center gap-2">
          <DrawerToggle />
          {members.length > 0 ? (
            <div className="flex -space-x-2 shrink-0">
              {members.slice(0, 3).map((bot) => (
                <MausAvatar key={bot.id} color={bot.color} shape={bot.mascotShape} state={stateForBot(bot)} size={36} animated={false} />
              ))}
            </div>
          ) : (
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-raised text-ink-secondary">
              <Users size={20} />
            </span>
          )}
          <div className="min-w-0">
            <div className="truncate text-[16px] font-semibold text-ink">{group.name || (polish ? "Grupa" : "Group")}</div>
            <div className="truncate text-[12px] text-ink-secondary">
              {members.length} {polish ? "botów" : "bots"} · {group.bot_ids.map(nameOf).join(" · ")}
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-3">
        {entries.length === 0 ? (
          <div className="mt-8 flex flex-col items-center gap-2 px-6 text-center text-ink-secondary">
            <Users size={22} />
            <div className="text-[13px] font-medium text-ink">No messages this session</div>
            <span className="text-[12px]">
              A message sent here goes to every bot in the room. Replies also land in each
              member&apos;s own chat, so the full record lives there.
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {entries.map((e, i) =>
              e.from === "you" ? (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-bubble-user px-3.5 py-2 text-[14px] leading-relaxed text-ink">
                    {e.text}
                  </div>
                </div>
              ) : (
                <div key={i} className="flex justify-start">
                  <div className="max-w-[85%] rounded-2xl bg-card px-3.5 py-2 text-[14px] leading-relaxed text-ink">
                    <div className="mb-0.5 flex items-baseline gap-2">
                      <span className="text-[12px] font-medium text-ink-secondary">{nameOf(e.from)}</span>
                      <span className="text-[11px] text-ink-secondary">{formatTime(e.at)}</span>
                    </div>
                    <ChatMarkdown text={e.text} />
                  </div>
                </div>
              ),
            )}
            {busy && (
              <div className="flex items-center gap-2 text-[12px] text-ink-secondary">
                <Loader2 size={12} className="animate-spin" />
                Asking the room…
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="mt-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">
            {error}
          </div>
        )}
      </div>

      {/* Composer — jedna linia; odpowiedzi renderują się po powrocie POST-a.
          `sticky bottom-0` keeps the input pinned above the page scroll. */}
      <div className="sticky bottom-0 z-20 bg-app border-t border-hairline/40 px-4 py-3">
        <div className="flex items-center gap-2">
          <input
            className="w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none"
            placeholder="Message the room"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
          />
          <button
            onClick={send}
            disabled={busy || !text.trim()}
            className={cn(
              "rounded-lg bg-raised p-2 text-ink hover:bg-raised-hover disabled:cursor-not-allowed disabled:opacity-50",
            )}
            title="Send to the room"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
          </button>
        </div>
      </div>
    </main>
  );
}
