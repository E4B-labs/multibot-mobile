// multibot: mini serwer node:http udający silnik slafy. Odpowiednik fake CLI
// z pozostałych testów driverów — tam fake'iem jest proces, tu serwer HTTP,
// bo slafy jest driverem HTTP.
//
// Wystawia dokładnie tyle, ile driver dotyka: /health, POST /api/bots,
// POST /api/bots/:id/chat?stream=1 (SSE) i przelotkę providera. Scenariusz
// tury wybiera `mode`.
import { createServer, type Server } from "node:http";

export type FakeEngineMode =
  | "happy" // working → 3 delty → usage → done
  | "error" // done nigdy nie przychodzi, silnik zgłasza event `error`
  | "kill"; // gniazdo ginie po dwóch deltach — silnik ubity w połowie tury

export interface FakeEngine {
  url: string;
  /** id botów utworzonych przez POST /api/bots, w kolejności. */
  createdBots: string[];
  /** ciała żądań czatu: `{ botId, message }`. */
  chats: Array<{ botId: string; message: string }>;
  /** ostatnio ustawiony provider (BYOK), bez klucza. */
  provider: { provider?: string; model?: string; base_url?: string; has_key: boolean };
  mode: FakeEngineMode;
  close(): Promise<void>;
}

const frame = (event: string, payload: unknown) => `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;

export async function startFakeEngine(mode: FakeEngineMode = "happy"): Promise<FakeEngine> {
  const state: FakeEngine = {
    url: "",
    createdBots: [],
    chats: [],
    provider: { has_key: false },
    mode,
    close: async () => {},
  };

  const readBody = (req: import("node:http").IncomingMessage): Promise<any> =>
    new Promise((resolve) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch {
          resolve({});
        }
      });
    });

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const path = url.pathname;
    const method = req.method ?? "GET";
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (method === "GET" && path === "/health") return json(200, { status: "ok" });

    if (method === "POST" && path === "/api/bots") {
      const body = await readBody(req);
      if (state.createdBots.includes(body.id)) return json(409, { detail: "exists" });
      state.createdBots.push(body.id);
      return json(201, { id: body.id, name: body.name });
    }

    const provider = path.match(/^\/api\/bots\/([^/]+)\/provider$/);
    if (provider && method === "GET") return json(200, state.provider);
    if (provider && method === "PUT") {
      const body = await readBody(req);
      state.provider = {
        provider: body.provider,
        model: body.model,
        base_url: body.base_url ?? null,
        has_key: Boolean(body.api_key),
      } as FakeEngine["provider"];
      return json(200, state.provider);
    }

    const chat = path.match(/^\/api\/bots\/([^/]+)\/chat$/);
    if (chat && method === "POST") {
      const botId = decodeURIComponent(chat[1]);
      const body = await readBody(req);
      state.chats.push({ botId, message: body.message });
      if (!state.createdBots.includes(botId)) return json(404, { detail: "no such bot" });
      if (url.searchParams.get("stream") !== "1") {
        return json(200, { reply: "non-stream reply", session_id: `slafy-${botId}` });
      }

      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      if (state.mode === "error") {
        res.write(frame("error", { message: "engine blew up" }));
        return res.end();
      }
      res.write(frame("working", { tool: { toolCallId: "call-1", name: "search", status: "running" } }));
      res.write(frame("delta", { text: "Hello" }));
      res.write(frame("delta", { text: ", " }));
      if (state.mode === "kill") {
        // Silnik ubity w połowie tury: gniazdo ginie BEZ `done` i bez `error`.
        // Zabicie po tiku, nie w tym samym: prawdziwy kill zostawia klientowi to,
        // co już poszło po drucie, a `destroy()` w tej samej pętli wyrzuciłby
        // niewysłany bufor i test nie sprawdzałby tego, o co chodzi.
        setTimeout(() => res.socket?.destroy(), 30);
        return;
      }
      res.write(frame("delta", { text: "world" }));
      res.write(frame("usage", { input: 11, output: 7 }));
      res.write(frame("done", { reply: "Hello, world", session_id: `slafy-${botId}`, finish_reason: "stop" }));
      return res.end();
    }

    return json(404, { detail: "not found" });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  state.url = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  state.close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections?.();
      server.close(() => resolve());
    });
  return state;
}
