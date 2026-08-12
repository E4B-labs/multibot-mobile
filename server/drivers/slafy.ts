// multibot: driver silnika slafy (Python FastAPI, engine/). Jak grok.ts jest to
// driver HTTP, nie CLI — ale różnica jest głębsza niż transport:
//
//   grok.ts jest BEZSTANOWY i co turę odtwarza cały transkrypt z harnessu.
//   Silnik slafy jest STANOWY — każdy bot ma własny profil Hermesa i własną
//   historię w `hermes_state.db`. Dlatego `SendTurnInput.transcript` tu
//   IGNORUJEMY i wysyłamy WYŁĄCZNIE nową turę. Replay podwoiłby historię
//   i policzył ją drugi raz w tokenach (decyzja D4).
//
// Transkrypt harnessu (NDJSON) zostaje jedynym źródłem renderu; silnik trzyma
// swój własny, równoległy stan rozmowy i to jest w porządku — nikt ich nie scala.
import type {
  DriverCreateInput,
  ModelCatalog,
  ProviderDriver,
  ProviderInstance,
  ProviderSnapshot,
  RuntimeEvent,
  RuntimeEventListener,
  SendTurnInput,
} from "../contracts.ts";
import { newEventId, newId } from "../contracts.ts";
import { EngineUnavailableError, ensureEngine } from "../engine/supervisor.ts";
import { appendNative } from "./native.ts";

const DRIVER_KIND = "slafy";

// D5: katalog budowany per-instancja w `create()`, nie współdzielona stała.
// Jedna pozycja i to nie przypadek: model wybiera się w silniku, per bot, przez
// BYOK (`PUT /api/bots/<id>/provider`) — do gatewaya Hermesa leci zawsze
// `model: "hermes-agent"` (engine/server/gateway.py). Silnik nie ma endpointu
// listującego modele, a zmyślanie listy tutaj kłamałoby o tym, co robi picker.
function modelCatalog(): ModelCatalog {
  return { default: "hermes-agent", options: [{ id: "hermes-agent", label: "Hermes Agent (BYOK)" }] };
}

export interface SlafyConfig {
  /** Prefiks id bota w silniku; id = `<prefix><threadId>` (regex silnika: a-z0-9_-). */
  botPrefix: string;
}

function decodeConfig(raw: unknown): SlafyConfig {
  const o = (raw ?? {}) as Record<string, unknown>;
  return { botPrefix: typeof o.botPrefix === "string" ? o.botPrefix : "mb-" };
}

/** Jedna ramka SSE: `event:` (opcjonalnie) + `data:` z JSON-em. */
async function* sseFrames(body: ReadableStream<Uint8Array>, signal: AbortSignal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let sep;
      while ((sep = buf.indexOf("\n\n")) !== -1) {
        const block = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        let name = "";
        let data = "";
        for (const raw of block.split("\n")) {
          const line = raw.replace(/\r$/, "");
          if (line.startsWith("event:")) name = line.slice(6).trim();
          else if (line.startsWith("data:")) data += line.slice(5).trim();
        }
        if (!name || !data) continue;
        try {
          yield { name, payload: JSON.parse(data) as any };
        } catch {
          /* ramka nie-JSON — nic, czego umiemy użyć */
        }
      }
    }
  } finally {
    if (signal.aborted) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export const SlafyDriver: ProviderDriver<SlafyConfig> = {
  driverKind: DRIVER_KIND,
  metadata: { displayName: "Slafy Engine", supportsMultipleInstances: true },
  models: modelCatalog(),
  decodeConfig,
  defaultConfig: () => decodeConfig({}),

  async create(input: DriverCreateInput<SlafyConfig>): Promise<ProviderInstance> {
    const { instanceId, config } = input;
    const listeners = new Set<RuntimeEventListener>();
    const active = new Map<string, { abort: AbortController; turnId: string }>();
    // Bot silnika per WĄTEK, nie per instancja: jedna instancja `slafy` obsługuje
    // całą flotę botów harnessu, a każdy z nich musi mieć własny, stanowy profil.
    // Id jest wyliczane z threadId, więc przeżywa restart bez zapisywania czegokolwiek.
    const ensuredBots = new Set<string>();
    const engineBotId = (threadId: string) => `${config.botPrefix}${threadId}`;

    const emit = (event: RuntimeEvent) => {
      for (const l of [...listeners]) l(event);
    };
    const base = (threadId: string, turnId: string) => ({
      eventId: newEventId(),
      provider: DRIVER_KIND,
      providerInstanceId: instanceId,
      threadId,
      turnId,
      createdAt: new Date().toISOString(),
    });

    /** Bot silnika zakładany leniwie, przy pierwszym użyciu wątku. */
    const ensureBot = async (baseUrl: string, threadId: string) => {
      const botId = engineBotId(threadId);
      if (ensuredBots.has(botId)) return botId;
      const res = await fetch(`${baseUrl}/api/bots`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: botId, name: botId }),
        signal: AbortSignal.timeout(30_000),
      });
      // 409 = bot już jest (restart harnessu, ten sam wątek) — to sukces, nie błąd.
      if (!res.ok && res.status !== 409) {
        throw new Error(`engine POST /api/bots → HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
      ensuredBots.add(botId);
      return botId;
    };

    const sendTurn = async (turn: SendTurnInput) => {
      const { threadId } = turn;
      if (active.has(threadId)) throw new Error("a turn is already running on this thread");
      const baseUrl = await ensureEngine();
      const botId = await ensureBot(baseUrl, threadId);

      const turnId = newId();
      const abort = new AbortController();
      active.set(threadId, { abort, turnId });

      emit({ ...base(threadId, turnId), type: "turn.started" });
      emit({ ...base(threadId, turnId), type: "session.started", sessionId: botId, model: turn.model ?? null });
      appendNative(threadId, { dir: "out", source: "slafy.chat", msg: { botId, message: turn.text } });

      void (async () => {
        // D4: TYLKO nowa tura. `turn.transcript` celowo nieużyte — silnik ma własną historię.
        let done = false;
        let failure: string | null = null;
        // toolCallId → czy już zgłoszony: pierwszy raz to item.started, kolejne to item.updated
        const seenTools = new Set<string>();
        try {
          const res = await fetch(`${baseUrl}/api/bots/${encodeURIComponent(botId)}/chat?stream=1`, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "text/event-stream" },
            body: JSON.stringify({ message: turn.text }),
            signal: abort.signal,
          });
          if (!res.ok || !res.body) {
            throw new Error(`engine chat → HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
          }
          for await (const { name, payload } of sseFrames(res.body, abort.signal)) {
            switch (name) {
              case "delta":
                emit({
                  ...base(threadId, turnId),
                  type: "content.delta",
                  streamKind: "assistant_text",
                  delta: payload.text ?? "",
                });
                break;
              case "working": {
                const tool = payload.tool ?? {};
                const itemId = String(tool.toolCallId ?? tool.name ?? "tool");
                const evt = { ...base(threadId, turnId), itemId, raw: { source: "slafy.working", payload } };
                if (seenTools.has(itemId)) {
                  emit({ ...evt, type: "item.updated", itemType: "tool" });
                } else {
                  seenTools.add(itemId);
                  emit({ ...evt, type: "item.started", itemType: "tool", title: tool.name ?? "tool" });
                }
                break;
              }
              case "usage":
                emit({
                  ...base(threadId, turnId),
                  type: "thread.token-usage.updated",
                  input: payload.input ?? 0,
                  output: payload.output ?? 0,
                });
                break;
              case "done":
                done = true;
                appendNative(threadId, { dir: "in", source: "slafy.chat", msg: payload });
                if (payload.reply?.trim()) {
                  emit({
                    ...base(threadId, turnId),
                    type: "item.completed",
                    itemType: "assistant_text",
                    text: payload.reply,
                  });
                }
                break;
              case "error":
                failure = String(payload.message ?? "engine error");
                break;
            }
          }
          // Strumień skończony bez `done` i bez `error` = silnik padł w połowie tury
          // (kill procesu, zerwane gniazdo). Cisza byłaby najgorszą z opcji: bot
          // zostałby "busy" na zawsze, więc domykamy turę jawnym błędem.
          if (!done && !failure) failure = "engine stream ended before the turn completed";
        } catch (e) {
          failure = (e as Error).name === "AbortError" ? null : (e as Error).message;
        } finally {
          active.delete(threadId);
        }
        const aborted = !done && failure === null;
        if (failure) emit({ ...base(threadId, turnId), type: "runtime.error", message: failure });
        emit({
          ...base(threadId, turnId),
          type: "turn.completed",
          ok: done && !failure,
          stopReason: failure ? "error" : aborted ? "interrupted" : null,
          cost: null,
        });
      })();

      return { turnId };
    };

    const snapshot = async (): Promise<ProviderSnapshot> => {
      try {
        const baseUrl = await ensureEngine();
        return { state: "available", authenticated: true, version: baseUrl };
      } catch (e) {
        // Brak venvu / martwy ENGINE_URL = instancja niedostępna z czytelnym
        // powodem. NIGDY wywrotka: `create()` już przeszło, więc rejestr trzyma
        // żywą instancję, a UI pokazuje, co naprawić.
        const why = e instanceof EngineUnavailableError ? e.message : e instanceof Error ? e.message : String(e);
        return { state: "unavailable", reason: why };
      }
    };

    return {
      instanceId,
      driverKind: DRIVER_KIND,
      displayName: input.displayName,
      enabled: input.enabled,
      // D5: katalog per instancja, `registry.describe()` nietknięte.
      models: modelCatalog(),
      snapshot,
      adapter: {
        provider: DRIVER_KIND,
        capabilities: { sessionModelSwitch: "unsupported" },
        sendTurn,
        // Zrywamy TYLKO nasz strumień — tura po stronie silnika dobiegnie końca
        // (Hermes nie ma anulowania w locie). Odpowiedź wyląduje w historii bota
        // i zobaczy ją następna tura. Prawdziwe przerwanie = osobny endpoint silnika.
        interruptTurn: async (threadId) => active.get(threadId)?.abort.abort(),
        // Approvals (`request.opened`/`respondToRequest`) to faza F4 — silnik ma
        // tryb `manual`, ale nie wystawia jeszcze pytań na tym strumieniu.
        respondToRequest: async () => {},
        hasSession: (threadId) => active.has(threadId),
        stopAll: async () => {
          for (const { abort } of active.values()) abort.abort();
        },
        onEvent: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      dispose: async () => {
        // Silnika NIE ubijamy: chodzi detached, żeby rutyny botów przeżyły
        // zamknięcie aplikacji (patrz server/engine/supervisor.ts).
        for (const { abort } of active.values()) abort.abort();
        listeners.clear();
      },
    };
  },
};
