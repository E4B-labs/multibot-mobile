// multibot (H4): the bot's screen, proxied.
//
// The container publishes noVNC on a host loopback port, but the client must
// never learn it: everything goes through the harness so one auth gate covers
// the screen too, and so a browser on the phone can reach a desktop it has no
// route to. Shaped after server/engine/proxy.ts — same pipe-don't-buffer rule,
// same 101 rewrite — but the upstream port is resolved per bot on every request
// because docker reassigns it on each container restart.
import { createConnection, type Socket } from "node:net";
import { request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";

import { readPorts } from "./hosted-computer.ts";

/** `/api/bots/<id>/computer/vnc/<rest>` — the one route this proxy owns. */
export const VNC_ROUTE = /^\/api\/bots\/([\w-]+)\/computer\/vnc(\/.*)?$/;

const HOP_BY_HOP = ["connection", "keep-alive", "transfer-encoding", "upgrade", "proxy-connection"];

export function matchVncRoute(pathname: string): { botId: string; rest: string } | null {
  const m = VNC_ROUTE.exec(pathname);
  if (!m) return null;
  // noVNC serves itself from the container root, so the prefix is stripped
  // entirely rather than rewritten.
  return { botId: m[1], rest: m[2] && m[2] !== "/" ? m[2] : "/vnc.html" };
}

async function novncPort(botId: string): Promise<number | null> {
  const ports = await readPorts(botId);
  return ports?.novnc ?? null;
}

export async function proxyVncHttp(req: IncomingMessage, res: ServerResponse, botId: string, rest: string, search: string) {
  const port = await novncPort(botId);
  if (port === null) {
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "computer not running" }));
    return;
  }
  const headers = { ...req.headers };
  for (const h of HOP_BY_HOP) delete headers[h];
  // The upstream is a plain container; a stale Host confuses noVNC's asset URLs.
  headers.host = `127.0.0.1:${port}`;

  const upstream = httpRequest(
    { host: "127.0.0.1", port, method: req.method, path: rest + search, headers },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "computer unreachable" }));
  });
  req.pipe(upstream);
}

/**
 * websockify upgrade. noVNC speaks a binary WebSocket to the container; we hand
 * the two sockets to each other after replaying the 101 verbatim, so no VNC
 * framing is ever parsed here.
 */
export async function pipeVncWs(req: IncomingMessage, socket: Duplex, head: Buffer, botId: string, rest: string, search: string) {
  const port = await novncPort(botId);
  if (port === null) {
    socket.end("HTTP/1.1 503 Service Unavailable\r\n\r\n");
    return;
  }
  const headers = { ...req.headers, host: `127.0.0.1:${port}` };
  const upstream = httpRequest({ host: "127.0.0.1", port, method: "GET", path: rest + search, headers });

  upstream.on("upgrade", (upRes, upSocket: Socket, upHead: Buffer) => {
    const status = `HTTP/1.1 ${upRes.statusCode} ${upRes.statusMessage}\r\n`;
    const raw = Object.entries(upRes.headers)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}\r\n`)
      .join("");
    socket.write(status + raw + "\r\n");
    if (upHead?.length) socket.write(upHead);
    if (head?.length) upSocket.write(head);
    upSocket.pipe(socket);
    socket.pipe(upSocket);
    const drop = () => {
      upSocket.destroy();
      socket.destroy();
    };
    upSocket.on("error", drop);
    socket.on("error", drop);
  });
  // A normal response means the container refused the upgrade.
  upstream.on("response", () => socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"));
  upstream.on("error", () => socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"));
  upstream.end();
}

/**
 * Raw TCP to the container's CDP port, for callers that need to speak the
 * DevTools protocol through the harness. Exported for the engine bridge.
 */
export function connectCdp(port: number): Socket {
  return createConnection({ host: "127.0.0.1", port });
}

/** Mount the screen proxy's WebSocket half. The HTTP half is dispatched from
 *  the main router in index.ts, which already owns path matching. */
export function mountVncUpgrade(server: Server): void {
  server.on("upgrade", (req, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const hit = matchVncRoute(url.pathname);
    if (!hit) return;
    void pipeVncWs(req, socket, head, hit.botId, hit.rest, url.search);
  });
}
