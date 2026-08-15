import { request as httpRequest } from "node:http";
import { readPort } from "./hosted-computer.js";
/** `/api/bots/<id>/computer/vnc/<rest>` — the one route this proxy owns. */
export const VNC_ROUTE = /^\/api\/bots\/([\w-]+)\/computer\/vnc(\/.*)?$/;
const HOP_BY_HOP = ["connection", "keep-alive", "transfer-encoding", "upgrade", "proxy-connection"];
export function matchVncRoute(pathname) {
    const m = VNC_ROUTE.exec(pathname);
    if (!m)
        return null;
    // noVNC serves itself from the container root, so the prefix is stripped
    // entirely rather than rewritten.
    return { botId: m[1], rest: m[2] && m[2] !== "/" ? m[2] : "/vnc.html" };
}
const novncPort = () => readPort("novnc");
export async function proxyVncHttp(req, res, rest, search) {
    const port = await novncPort();
    if (port === null) {
        res.writeHead(503, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "computer not running" }));
        return;
    }
    const headers = { ...req.headers };
    for (const h of HOP_BY_HOP)
        delete headers[h];
    // The upstream is a plain container; a stale Host confuses noVNC's asset URLs.
    headers.host = `127.0.0.1:${port}`;
    const upstream = httpRequest({ host: "127.0.0.1", port, method: req.method, path: rest + search, headers }, (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
    });
    upstream.on("error", () => {
        if (!res.headersSent)
            res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "computer unreachable" }));
    });
    req.pipe(upstream);
}
/**
 * websockify upgrade. noVNC speaks a binary WebSocket to the container; we hand
 * the two sockets to each other after replaying the 101 verbatim, so no VNC
 * framing is ever parsed here.
 */
export async function pipeVncWs(req, socket, head, rest, search) {
    const port = await novncPort();
    if (port === null) {
        socket.end("HTTP/1.1 503 Service Unavailable\r\n\r\n");
        return;
    }
    const headers = { ...req.headers, host: `127.0.0.1:${port}` };
    const upstream = httpRequest({ host: "127.0.0.1", port, method: "GET", path: rest + search, headers });
    upstream.on("upgrade", (upRes, upSocket, upHead) => {
        const status = `HTTP/1.1 ${upRes.statusCode} ${upRes.statusMessage}\r\n`;
        const raw = Object.entries(upRes.headers)
            .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}\r\n`)
            .join("");
        socket.write(status + raw + "\r\n");
        if (upHead?.length)
            socket.write(upHead);
        if (head?.length)
            upSocket.write(head);
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
/** Mount the screen proxy's WebSocket half. The HTTP half is dispatched from
 *  the main router in index.ts, which already owns path matching. */
export function mountVncUpgrade(server) {
    server.on("upgrade", (req, socket, head) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        const hit = matchVncRoute(url.pathname);
        if (!hit)
            return;
        void pipeVncWs(req, socket, head, hit.rest, url.search);
    });
}
