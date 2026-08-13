// multibot (G2): one access token protects the whole harness. HTTP uses a
// bearer header; browser WebSocket carries it as a subprotocol and the proxy
// strips it before the request reaches the engine.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { saveConfig } from "./config.js";
export const newAccessToken = () => randomBytes(32).toString("hex");
export function ensureAccessToken(cfg) {
    const existing = cfg.auth?.token?.trim();
    if (existing)
        return { token: existing, created: false };
    const token = newAccessToken();
    cfg.auth = { token };
    saveConfig({ auth: cfg.auth });
    return { token, created: true };
}
export function rotateAccessToken(cfg) {
    const token = newAccessToken();
    cfg.auth = { token };
    saveConfig({ auth: cfg.auth });
    return token;
}
/** Hash first: timingSafeEqual always sees equal-size buffers, including for
 * malformed attacker input. */
export function tokenMatches(actual, expected) {
    if (typeof actual !== "string")
        return false;
    const digest = (value) => createHash("sha256").update(value, "utf8").digest();
    return timingSafeEqual(digest(actual), digest(expected));
}
function requestToken(req) {
    const authorization = req.headers.authorization;
    if (authorization?.startsWith("Bearer "))
        return authorization.slice(7);
    const header = req.headers["x-multibot-token"];
    if (typeof header === "string")
        return header;
    // Browser WebSocket cannot set Authorization. Frontend offers two
    // subprotocols: stable marker + token. Proxy selects only the marker.
    const protocols = String(req.headers["sec-websocket-protocol"] ?? "")
        .split(",")
        .map((value) => value.trim());
    const marker = protocols.indexOf("multibot-auth");
    if (marker !== -1 && protocols[marker + 1])
        return protocols[marker + 1];
    return null;
}
function unauthorized(res) {
    res.writeHead(401, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify({ error: "unauthorized" }));
}
function rejectUpgrade(socket) {
    socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
}
/** Mount last: wraps both the app request handler and every upgrade handler,
 * including the engine event and per-bot computer sockets. */
export function mountAuth(server, getToken) {
    const sessions = new Set();
    const tracked = new WeakSet();
    const track = (socket) => {
        sessions.add(socket);
        if (tracked.has(socket))
            return;
        tracked.add(socket);
        socket.once("close", () => sessions.delete(socket));
    };
    const requests = server.listeners("request");
    server.removeAllListeners("request");
    server.on("request", (req, res) => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        const publicRoute = (req.method === "GET" && url.pathname === "/api/health") ||
            (req.method === "POST" && /^\/webhooks\/[^/]+$/.test(url.pathname)) ||
            ((req.method === "GET" || req.method === "HEAD") &&
                !url.pathname.startsWith("/api/") &&
                !url.pathname.startsWith("/webhooks/"));
        // Internal peer calls carry their own per-boot COMMS_TOKEN and are checked
        // again by the route itself. Requiring the user token would leak it into
        // spawned agent environments.
        const internallyAuthenticated = url.pathname.startsWith("/api/internal/");
        if (!publicRoute && !internallyAuthenticated && !tokenMatches(requestToken(req), getToken())) {
            return unauthorized(res);
        }
        if (!publicRoute && !internallyAuthenticated)
            track(req.socket);
        for (const handler of requests)
            handler(req, res);
    });
    const upgrades = server.listeners("upgrade");
    server.removeAllListeners("upgrade");
    server.on("upgrade", (req, socket, head) => {
        if (!tokenMatches(requestToken(req), getToken()))
            return rejectUpgrade(socket);
        track(socket);
        const protocols = String(req.headers["sec-websocket-protocol"] ?? "")
            .split(",")
            .map((value) => value.trim());
        if (protocols.includes("multibot-auth"))
            req.headers["sec-websocket-protocol"] = "multibot-auth";
        for (const handler of upgrades)
            handler(req, socket, head);
    });
    return {
        /** Token rotation closes SSE/WS and idle authenticated keep-alives. Keep the
         * rotating request alive long enough to return the new token. */
        revokeSessions(except) {
            for (const socket of sessions)
                if (socket !== except)
                    socket.destroy();
        },
    };
}
