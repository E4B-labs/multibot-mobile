// G2: one authenticated transport for every browser request.
const TOKEN_KEY = "multibot.auth.token";
const AUTH_REQUIRED = "multibot:auth-required";

export function getAuthToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setAuthToken(token: string): void {
  try {
    const value = token.trim();
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage can be disabled in private browsing */
  }
}

export function clearAuthToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage can be disabled in private browsing */
  }
}

export function authEventName(): string {
  return AUTH_REQUIRED;
}

export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type") && init.body) headers.set("content-type", "application/json");
  const token = getAuthToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(input, { ...init, headers });
  if (response.status === 401) {
    window.dispatchEvent(new Event(AUTH_REQUIRED));
  }
  return response;
}

export function authenticatedEventSource(path: string): {
  onopen: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((event: MessageEvent<string>) => void) | null;
  close: () => void;
} {
  let stopped = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const source = {
    onopen: null as (() => void) | null,
    onerror: null as (() => void) | null,
    onmessage: null as ((event: MessageEvent<string>) => void) | null,
    close: () => {
      stopped = true;
      void reader?.cancel();
    },
  };
  void (async () => {
    let retry = 0;
    while (!stopped) {
      const response = await authFetch(path, { headers: { accept: "text/event-stream" } });
      if (response.status === 401 || !response.ok || !response.body) {
        source.onerror?.();
        return;
      }
      retry = 0;
      source.onopen?.();
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!stopped) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() ?? "";
        for (const event of events) {
          const data = event
            .split(/\r?\n/)
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n");
          if (data) source.onmessage?.(new MessageEvent("message", { data }));
        }
      }
      if (stopped) return;
      source.onerror?.();
      retry = Math.min(retry + 1, 5);
      await new Promise((resolve) => setTimeout(resolve, retry * 1000));
    }
  })().catch(() => source.onerror?.());
  return source;
}

export function authenticatedWebSocket(path: string, protocol = location.protocol): WebSocket {
  const token = getAuthToken();
  const wsProtocol = protocol === "https:" ? "wss:" : "ws:";
  return new WebSocket(`${wsProtocol}//${location.host}${path}`, token ? ["multibot-auth", token] : undefined);
}
