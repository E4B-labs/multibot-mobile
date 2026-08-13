// multibot: mini serwer node:http udający silnik slafy. Odpowiednik fake CLI
// z pozostałych testów driverów — tam fake'iem jest proces, tu serwer HTTP,
// bo slafy jest driverem HTTP.
//
// Wystawia dokładnie tyle, ile driver i przelotka dotykają: /health, GET+POST
// /api/bots, POST /api/bots/:id/chat?stream=1 (SSE), historię wiadomości,
// providera, uwagę (D7) i kanał WS `/api/ws`. Scenariusz tury wybiera `mode`.
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { Duplex } from "node:stream";

export type FakeEngineMode =
  | "happy" // working → 3 delty → usage → done
  | "error" // done nigdy nie przychodzi, silnik zgłasza event `error`
  | "kill"; // gniazdo ginie po dwóch deltach — silnik ubity w połowie tury

export interface EngineMessage {
  role: string;
  content: string;
  ts?: string;
}

export interface FakeEngine {
  url: string;
  /** id botów utworzonych przez POST /api/bots, w kolejności. */
  createdBots: string[];
  /** ciała żądań czatu: `{ botId, message }`. */
  chats: Array<{ botId: string; message: string }>;
  /** ostatnio ustawiony provider (BYOK), bez klucza. */
  provider: { provider?: string; model?: string; base_url?: string; has_key: boolean };
  /** historia wątku bota — to, co silnik oddaje na GET /api/bots/:id/messages. */
  history: Record<string, EngineMessage[]>;
  /** stan uwagi (D7) czytany przy podłączeniu klienta WS. */
  attention: Record<string, string | null>;
  mode: FakeEngineMode;
  /** liczba żywych klientów `/api/ws`. */
  wsClients(): number;
  /** wypchnij event na wszystkie klienty WS (jak `_broadcast` silnika). */
  push(event: unknown): void;
  close(): Promise<void>;
}

const frame = (event: string, payload: unknown) => `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;

/** Ramka tekstowa serwer→klient: bez maski, bez fragmentacji (RFC 6455). */
function wsTextFrame(text: string): Buffer {
  const payload = Buffer.from(text, "utf8");
  if (payload.length < 126) return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  const header = Buffer.alloc(4);
  header[0] = 0x81;
  header[1] = 126;
  header.writeUInt16BE(payload.length, 2);
  return Buffer.concat([header, payload]);
}

export async function startFakeEngine(mode: FakeEngineMode = "happy"): Promise<FakeEngine> {
  const sockets = new Set<Duplex>();
  const state: FakeEngine = {
    url: "",
    createdBots: [],
    chats: [],
    provider: { has_key: false },
    history: {},
    attention: {},
    mode,
    wsClients: () => sockets.size,
    push: (event) => {
      const frame = wsTextFrame(JSON.stringify(event));
      for (const s of sockets) s.write(frame);
    },
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

    // Wyłącznie dla testu przelotki: dwie ramki SSE rozdzielone w czasie —
    // proxy, które buforuje, oddałoby je jednym kawałkiem.
    if (method === "GET" && path === "/api/slow-stream") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      res.write(frame("a", { n: 1 }));
      setTimeout(() => {
        res.write(frame("b", { n: 2 }));
        res.end();
      }, 80);
      return;
    }

    if (method === "POST" && path === "/api/bots") {
      const body = await readBody(req);
      if (state.createdBots.includes(body.id)) return json(409, { detail: "exists" });
      state.createdBots.push(body.id);
      return json(201, { id: body.id, name: body.name });
    }
    if (method === "GET" && path === "/api/bots") {
      return json(200, state.createdBots.map((id) => ({ id, name: id })));
    }

    const messages = path.match(/^\/api\/bots\/([^/]+)\/messages$/);
    if (messages && method === "GET") {
      const botId = decodeURIComponent(messages[1]);
      if (!state.createdBots.includes(botId)) return json(404, { detail: "no such bot" });
      return json(200, state.history[botId] ?? []);
    }

    const attention = path.match(/^\/api\/bots\/([^/]+)\/attention$/);
    if (attention && method === "GET") {
      const botId = decodeURIComponent(attention[1]);
      if (!state.createdBots.includes(botId)) return json(404, { detail: "no such bot" });
      return json(200, { reason: state.attention[botId] ?? null });
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
      // silnik dopisuje turę do własnej historii — stąd czyta attach-sync (D4)
      (state.history[botId] ??= []).push(
        { role: "user", content: body.message },
        { role: "assistant", content: "Hello, world" },
      );
      res.write(frame("done", { reply: "Hello, world", session_id: `slafy-${botId}`, finish_reason: "stop" }));
      return res.end();
    }

    return json(404, { detail: "not found" });
  });

  // Kanał eventów: handshake RFC 6455 i echo bajtów z powrotem — echo wystarczy,
  // by test przepustowy udowodnił, że pipe harnessu jest przezroczysty w obie
  // strony, a `push()` udaje `_broadcast` silnika.
  server.on("upgrade", (req, socket: Duplex) => {
    const key = req.headers["sec-websocket-key"];
    if (!key || new URL(req.url ?? "/", "http://127.0.0.1").pathname !== "/api/ws") return socket.destroy();
    const accept = createHash("sha1")
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    sockets.add(socket);
    socket.on("data", (chunk) => socket.write(chunk));
    socket.on("error", () => sockets.delete(socket));
    socket.on("close", () => sockets.delete(socket));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  state.url = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  state.close = () =>
    new Promise<void>((resolve) => {
      for (const s of sockets) s.destroy(); // gniazda po upgrade nie należą już do serwera
      sockets.clear();
      server.closeAllConnections?.();
      server.close(() => resolve());
    });
  return state;
}
