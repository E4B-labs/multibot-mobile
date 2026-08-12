# Recon `hermes-agent/web/` pod UI fazy 2 (2026-08-12)

Werdykt: **świeży Vite + wyciągnięcie ~6 plików, NIE fork całości.**
Powody: (1) messengera w dashboardzie nie ma — `ChatPage.tsx` (1688 linii) to terminal
xterm.js nad PTY, composera brak, więc rdzeń Grok-Botowego UI i tak jest nowym kodem;
(2) fork nie jest samowystarczalny — `@hermes/shared` = `file:../apps/shared` poza
`web/`, `outDir` celuje w `../hermes_cli/web_dist`, auth działa tylko dzięki
wstrzykiwaniu tokenu przez serwer Pythona hermesa; (3) design system
`@nous-research/ui@0.18.2` jest publiczny na npm — świeży Vite dostaje identyczny
wygląd jednym `npm i` + `index.css` + fonty, a fork kupuje ~51k linii do skasowania.

## Start fazy 2 (plan ~1 dzień)

```
npm create vite@latest -- --template react-ts
npm i @nous-research/ui@0.18.2 tailwindcss@4 @tailwindcss/vite lucide-react \
      clsx tailwind-merge class-variance-authority react-router
```
**PINUJ `@nous-research/ui@0.18.2`** — `latest` 1.5.2 = skok major, breaking.

Skopiować z `G:\Projects\hermes-agent\web\`:
- `src/index.css` — cała konfiguracja Tailwind v4 żyje tu (`@theme inline`), tokeny
  `--foreground/--midground/--background` + `color-mix`; usunąć bloki JetBrains
  Mono/xterm. Paleta default „Hermes Teal": tło `#041c1c`, midground `#ffe6cb`.
  Tylko dark; 8 presetów motywów w `src/themes/presets.ts` (opcjonalnie zabrać).
- `public/fonts/` — Collapse, Mondwest, Rules (woff2); `fonts.css` przed `globals.css`.
- `src/lib/utils.ts` — `cn()`.
- **`src/components/Markdown.tsx` (383 linie) — najcenniejszy plik**: lekki parser MD
  bez zależności + migający kursor streamingu (`streaming` prop). Braki: tabele,
  syntax highlighting, sanitizacja HTML.
- `src/lib/chatImagePaste.ts` (+ testy) — paste obrazków do composera.
- `src/components/ChatSessionList.tsx` (260 linii) — szkielet listy botów/czatów
  (rename/delete/select).
- `src/lib/events-reconnect.ts` (+ `.test.ts`) — czysta arytmetyka backoffu WS
  (1s→30s, max 15, kody 4401/4403 terminalne). Wzorzec testów: `ChatSidebar.test.tsx`
  (455 linii, `FakeWebSocket`).
- opcjonalnie: `SlashPopover.tsx` + `lib/slashExec.ts` (slash commands),
  `hooks/useModalBehavior.ts`, `components/AutoField.tsx` (schema-driven form).

Wzorce do PRZEPISANIA (nie kopiowania): layout sidebar+content z `App.tsx`
(grid + collapse + mobile drawer), `fetchJSON` z `lib/api.ts` (wziąć ~50 linii z 2618),
trzymanie WS z `ChatSidebar.tsx`.

## Fakty o stacku

- Vite 8.2.0, TS 6.0.3, React 19.2.7, react-router 8.3.0 (pakiet `react-router`),
  Tailwind 4.3.3 przez `@tailwindcss/vite` (BEZ tailwind.config), lucide-react,
  cva/clsx/tailwind-merge, motion 12.42, gsap 3.15.
- State: zero bibliotek — React Context (`ProfileProvider`, `PageHeaderProvider`,
  themes/context 615 linii).
- Backend: goły `fetch`, `lib/api.ts` 2618 linii ręcznych wrapperów; proxy dev
  `/api` → `http://127.0.0.1:9119` (`ws: true`).
- Brak PWA plugina/manifestu/service workera — PWA robimy sami (vite-plugin-pwa).
- Auth wzorzec: serwer wstrzykuje `window.__HERMES_SESSION_TOKEN__` do index.html;
  REST header `X-Hermes-Session-Token`; WS `?token=` (loopback) / ticket (gated);
  po 401 jednorazowy reload (`dashboard-auth-reload.ts`). Nasz serwer: prostszy
  własny wariant.
- README web/ NIEAKTUALNY (twierdzi hand-rolled shadcn w `src/components/ui/` —
  katalog nie istnieje; komponenty z pakietu `@nous-research/ui`).

## Realtime (faza 3)

Tylko WebSocket, zero SSE. Najważniejsze: `/api/ws` = **JSON-RPC newline-delimited**
(`lib/gatewayClient.ts` + `apps/shared/src/json-rpc-gateway.ts`):
```ts
const gw = new GatewayClient()
await gw.connect()
const { session_id } = await gw.request<{ session_id: string }>("session.create")
gw.on("message.delta", (ev) => console.log(ev.payload?.text))
await gw.request("prompt.submit", { session_id, text: "hi" })
```
Zabrać logikę RPC (`JsonRpcGatewayClient`), przepisać warstwę połączenia (sprzężona
z auth hermesa). Drugi socket `/api/events?channel=…` = pasywny broadcast.

## Reużywalne komponenty messenger-UI (mapa)

- Bąbelki wiadomości: wyciąć ~150 linii renderowania transkryptu z
  `pages/SessionsPage.tsx` (~linie 300–430, `ROLE_STYLES` per rola, tool_calls).
  Brak wirtualizacji/auto-scroll/streamingu — dopisać.
- Modale: `ConfirmDialog`, `ModelPickerDialog` (680 linii, fuzzy search),
  `OAuthLoginModal` — cienkie wrappery na `@nous-research/ui/ui/components/dialog`.
- Toast: z pakietu DS (`use-toast`), per-komponent, bez globalnego providera.
- Do napisania od zera: composer (autosize + send + attachments), streamowana lista
  wiadomości z auto-scroll, typing indicator, sidebar botów z avatarami, prawy panel
  konfiguracji bota, virtual scroll.
