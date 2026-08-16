# Propozycja: autoryzacja noVNC tokenem z query (dla Kacpra)

Dotyczy: `clewkord/multibot`, trasa upgrade'u WebSocket
`/api/bots/:id/computer/vnc/websockify` (pewnie `server/hosted-computer.ts`
lub proxy ws pod `server/`).

## Dlaczego
Aplikacja mobilna (Expo WebView) otwiera ekran bota w `<iframe>` z noVNC
(`vnc_lite.html` → `websockify`). noVNC nie potrafi wysłać nagłówka
`Authorization`, więc dziś autoryzacja opiera się na ciasteczku sesyjnym
(HttpOnly), które desktopowa przeglądarka dowozi z `/api/auth/session`.

W WebView React Native słoik ciasteczek JS-owego `fetch` (gdzie morszczy się
sesję) jest **rozdzielony** od słoika loadera WebView (gdzie ładuje się
iframe). Ciasteczko nie dociera do noVNC → websocket dostaje 401 → czarny
ekran. Po stronie mobilnej już jest poprawka: token bearer jest teraz
dokładany do ścieżki websockify jako `?token=<bearer>`
(`webui/src/components/ComputerPanel.tsx`, `computerVncSrc`).

Żeby to zadziałało, serwer musi przyjąć bearer **równorzędnie** z ciasteczkiem
sesyjnym na upgradzie WS.

## Co zmienić
W handlerze upgrade'u websockify, zamiast sprawdzać tylko ciasteczko sesyjne,
dodaj odczyt tokenu z query i zwaliduj go tak samo, jak weryfikujesz
`Authorization: Bearer` w reszcie API.

```ts
// server/hosted-computer.ts (lub tam, gdzie obsługujesz upgrade websockify)
//
// Zwraca token do autoryzacji ekranu bota:
//  - ciasteczko `session` (przeglądarka desktopowa, istniejąca droga)
//  - ?token=<bearer> w query upgrade'u (mobile WebView, nowa droga)
function getComputerScreenToken(req: IncomingMessage): string | null {
  const cookie = req.headers.cookie;
  if (cookie) {
    const m = cookie.match(/(?:^|;\s*)session=([^;]+)/);
    if (m?.[1]) return decodeURIComponent(m[1]);
  }
  try {
    const url = new URL(req.url ?? "", "http://localhost");
    const token = url.searchParams.get("token");
    if (token) return token;
  } catch {
    /* brak url — niezależnie odrzuci dalej */
  }
  return null;
}

// W miejscu, gdzie dziś odrzucasz brak sesji, zamień na:
const token = getComputerScreenToken(req);
if (!token || !(await isValidAccessToken(token))) {
  // odrzuć upgrade (socket.destroy() / 401)
  return;
}
// ...istniejący proxy do websockify kontenera
```

`isValidAccessToken` to ta sama funkcja, której używasz do weryfikacji
`Authorization: Bearer <token>` w pozostałych trasach API — nie wprowadzaj
drugiej ścieżki walidacji.

## Uwagi
- noVNC wysyła `?token=` jako część `path` (`scale=true&path=.../websockify?token=ENC`),
  więc serwer widzi go w `req.url` na upgradzie. Wartość jest
  `encodeURIComponent`-owana po stronie klienta — `URL.searchParams` ją poprawnie
  odkoduje.
- Token w URL ląduje w logach dostępu / reverse proxy. To ten sam token, który
  aplikacja mobilna trzyma w `localStorage` — akceptowalne w tym układzie, ale
  warto go wyciąć z logów, jeśli masz taką możliwość.
- Nie zmienia się nic dla desktopu: tam nadal przychodzi ciasteczko sesyjne i
  przechodzi pierwszą gałęzią.
- Ścieżka `vnc_lite.html` (statyczny noVNC) nie wymaga autoryzacji — weryfikuj
  tylko upgrade WS do `websockify`.
