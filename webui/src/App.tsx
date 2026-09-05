import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { StoreProvider, useStore } from "@/state/store";
import { Onboarding } from "@/components/Onboarding";
import { emailGateDone, initAnalytics } from "@/lib/analytics";
// multibot: trzecia kopia tej samej linii (Onboarding.tsx, Sidebar.tsx) —
// zostaje lokalnie, bo wspólny moduł na jedno wyrażenie to więcej pliku niż
// treści. ponytail: wyciągnąć do `src/lib/`, gdyby doszła czwarta.
const isElectron = navigator.userAgent.includes("Electron");
import { Sidebar } from "@/components/Sidebar";
import { ChatView } from "@/components/ChatView";
import { SettingsPanel } from "@/components/SettingsPanel";
import { PluginsPanel } from "@/components/PluginsPanel";
import { ComputerPanel } from "@/components/ComputerPanel";
import { AppSettingsPanel } from "@/components/AppSettingsPanel";
import { TeamMapPanel } from "@/components/TeamMapPanel";
import { InspectorPanel } from "@/components/InspectorPanel";
// multibot: F6 — panel rutyn bota
import { RoutinesPanel } from "@/components/RoutinesPanel";
// multibot: F8 — panel skilli bota
import { SkillsPanel } from "@/components/SkillsPanel";
// multibot: F9-FE — pokój grupowy
import { GroupPanel } from "@/components/GroupPanel";
import { GroupMembersPanel } from "@/components/GroupMembersPanel";
import { RoomPanel } from "@/components/RoomPanel";
import { RoomsPanel } from "@/components/RoomsPanel";
import { UpdateBanner } from "@/components/UpdateBanner";
// multibot: Cmd/Ctrl+K paleta komend
import { CmdK } from "@/components/CmdK";
import { authEventName, authFetch, clearAuthToken, getAuthToken, setAuthToken, setV2AuthToken } from "@/lib/auth";
import { useLanguage } from "@/lib/language";

function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const polish = useLanguage() === "pl";
  type Mode = "login" | "register" | "host" | "recover" | "legacy";
  type Status = { server?: { configured: boolean; name: string; serverId: string }; session?: boolean };
  const [status, setStatus] = useState<Status | null>(null);
  const [mode, setMode] = useState<Mode>("login");
  const [serverName, setServerName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [serverPassword, setServerPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void fetch("/api/auth/status")
      .then((response) => response.json() as Promise<Status>)
      .then((next) => {
        if (!alive) return;
        setStatus(next);
        if (next.session) onLogin();
        else if (!next.server?.configured) setMode("host");
      })
      .catch(() => setError(polish ? "Nie można odczytać stanu serwera." : "Could not read server status."));
    return () => { alive = false; };
  }, [onLogin, polish]);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === "legacy") {
        if (!token.trim()) return;
        setAuthToken(token, "legacy");
        const response = await authFetch("/api/instances");
        if (!response.ok) throw new Error(response.status === 401 ? (polish ? "Nieprawidłowy token dostępu" : "Invalid access token") : polish ? "Serwer niedostępny" : "Server unavailable");
        onLogin();
        return;
      }
      let response: Response;
      if (mode === "host") {
        if (!status?.server?.configured) {
          response = await authFetch("/api/setup/server", { method: "POST", body: JSON.stringify({ name: serverName, serverPassword }) });
          if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? `Setup failed (${response.status})`);
        }
        setMode("register");
        response = await authFetch("/api/auth/register", { method: "POST", body: JSON.stringify({ username, password, displayName, serverPassword, deviceName: navigator.userAgent.slice(0, 80) }) });
      } else if (mode === "register") {
        response = await authFetch("/api/auth/register", { method: "POST", body: JSON.stringify({ username, password, displayName, serverPassword, deviceName: navigator.userAgent.slice(0, 80) }) });
      } else if (mode === "recover") {
        response = await authFetch("/api/auth/recover", { method: "POST", body: JSON.stringify({ username, recoveryCode, newPassword: password, deviceName: navigator.userAgent.slice(0, 80) }) });
      } else {
        if (!status?.server?.configured) throw new Error(polish ? "Ten host nie jest jeszcze skonfigurowany." : "This host is not configured yet.");
        response = await authFetch("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password, deviceName: navigator.userAgent.slice(0, 80) }) });
      }
      const result = await response.json().catch(() => ({})) as { accessToken?: string; recoveryCode?: string; error?: string };
      if (!response.ok || !result.accessToken) throw new Error(result.error ?? `Authentication failed (${response.status})`);
      setV2AuthToken(result.accessToken);
      if (result.recoveryCode) window.alert(`${polish ? "Zapisz recovery code. Pokażemy go tylko raz:" : "Save recovery code. It is shown once:"}\n\n${result.recoveryCode}`);
      onLogin();
    } catch (e) {
      clearAuthToken();
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const configured = status?.server?.configured ?? false;
  const field = "mt-3 w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2.5 text-[14px] text-ink outline-none focus:border-hairline";
  return (
    <main className="multibot-login flex h-full min-h-screen items-center justify-center overflow-y-auto bg-app px-5 py-6 text-ink">
      <form onSubmit={(event) => { event.preventDefault(); void submit(); }} className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-xl">
        <div className="mb-4 text-[11px] font-bold tracking-[0.18em] text-accent">MULTIBOT / HOST</div>
        <h1 className="text-[18px] font-semibold">{mode === "host" && !configured ? polish ? "Utwórz serwer" : "Create server" : configured ? (polish ? "Zaloguj się do serwera" : "Sign in to server") : polish ? "Konfiguracja hosta" : "Host setup"}</h1>
        <p className="mt-1 text-[13px] text-ink-secondary">{status?.server?.name ?? (polish ? "Bezpieczny wspólny workspace" : "Secure shared workspace")}</p>
        {mode === "host" && !configured && <input value={serverName} onChange={(event) => setServerName(event.target.value)} placeholder={polish ? "Nazwa serwera" : "Server name"} aria-label={polish ? "Nazwa serwera" : "Server name"} className={field} autoFocus />}
        {mode !== "legacy" && <>
          {(mode === "register" || mode === "host") && <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder={polish ? "Nazwa profilu" : "Display name"} aria-label="Display name" className={field} />}
          <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Username" aria-label="Username" autoComplete="username" className={field} autoFocus={mode === "login" || mode === "recover"} />
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === "recover" ? polish ? "Nowe hasło profilu" : "New profile password" : polish ? "Hasło profilu" : "Profile password"} aria-label="Profile password" autoComplete={mode === "login" ? "current-password" : "new-password"} className={field} />
          {(mode === "host" || mode === "register") && <input type="password" value={serverPassword} onChange={(event) => setServerPassword(event.target.value)} placeholder={polish ? "Hasło serwera" : "Server password"} aria-label="Server password" autoComplete="off" className={field} />}
          {mode === "recover" && <input value={recoveryCode} onChange={(event) => setRecoveryCode(event.target.value)} placeholder={polish ? "Jednorazowy recovery code" : "One-time recovery code"} aria-label="Recovery code" autoComplete="one-time-code" className={field} />}
        </>}
        {mode === "legacy" && <input autoFocus type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder={polish ? "Stary token migracyjny" : "Legacy migration token"} aria-label={polish ? "Stary token migracyjny" : "Legacy migration token"} autoComplete="current-password" className={field} />}
        <button type="submit" disabled={busy} className="mt-3 w-full rounded-lg bg-accent py-2.5 text-[13px] font-medium text-white disabled:opacity-50">{busy ? (polish ? "Praca…" : "Working…") : mode === "host" ? polish ? "Utwórz serwer i profil" : "Create server and profile" : mode === "register" ? polish ? "Utwórz profil" : "Create profile" : mode === "recover" ? polish ? "Odzyskaj konto" : "Recover account" : mode === "legacy" ? polish ? "Użyj starego tokenu" : "Use legacy token" : polish ? "Zaloguj się" : "Sign in"}</button>
        {configured && mode !== "legacy" && <div className="mt-4 flex flex-wrap gap-2 text-[12px] text-ink-secondary"><button type="button" onClick={() => setMode(mode === "login" ? "register" : "login")} className="hover:text-ink">{mode === "login" ? polish ? "Utwórz profil" : "Create profile" : polish ? "Mam już profil" : "I have an account"}</button><button type="button" onClick={() => setMode("recover")} className="hover:text-ink">{polish ? "Odzyskaj" : "Recover"}</button></div>}
        <button type="button" onClick={() => setMode(mode === "legacy" ? "login" : "legacy")} className="mt-4 text-[12px] text-ink-secondary hover:text-ink">{mode === "legacy" ? polish ? "Nowe logowanie" : "New sign-in" : polish ? "Mam stary token" : "I have a legacy token"}</button>
        {error && <div role="alert" className="mt-3 text-[12px] text-danger">{error}</div>}
      </form>
    </main>
  );
}

function Shell() {
  const { state, dispatch } = useStore();
  const polish = useLanguage() === "pl";
  const bot = state.bots.find((b) => b.id === state.selectedId) ?? state.bots[0];
  useEffect(() => {
    const close = () => dispatch({ type: "toggleInspector", open: false });
    window.addEventListener("mb:inspector:close", close);
    return () => window.removeEventListener("mb:inspector:close", close);
  }, [dispatch]);
  // multibot: tapnięcie w powiadomienie na telefonie ustawia `#bot=<id>` —
  // powłoka mobilna wstrzykuje hash i przy starcie, i przy otwartej aplikacji,
  // więc czytamy go też z `hashchange`.
  useEffect(() => {
    const openFromHash = () => {
      const id = new URLSearchParams(location.hash.slice(1)).get("bot");
      if (id && state.bots.some((b) => b.id === id) && id !== state.selectedId) dispatch({ type: "select", id });
    };
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    return () => window.removeEventListener("hashchange", openFromHash);
  }, [state.bots, state.selectedId, dispatch]);
  // …a powłoka musi wiedzieć, który bot jest na ekranie, żeby nie wyświetlać
  // powiadomienia o bocie, na który użytkownik właśnie patrzy.
  useEffect(() => {
    const rn = (window as unknown as { ReactNativeWebView?: { postMessage(m: string): void } }).ReactNativeWebView;
    if (rn && bot) rn.postMessage(JSON.stringify({ type: "bot.selected", botId: bot.id }));
  }, [bot?.id]);
  // Drawer to panel startowy aplikacji: przy (re)otwarciu apki otwieramy
  // panel boczny (klasa `mb-drawer-open`), nawet gdy Android nie przeładował
  // WebView i stan dokumentu przetrwał w tle.
  useEffect(() => {
    const open = () => document.body.classList.add("mb-drawer-open");
    open();
    const onVis = () => {
      if (document.visibilityState === "visible") open();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);
  return (
    <div className="multibot-shell flex h-full flex-col">
      {/* fixed-position popup, bottom-left — outside the layout flow */}
      <UpdateBanner />
      {/* multibot: Cmd/Ctrl+K command palette — fixed overlay, renders null until opened */}
      <CmdK />
      <div className="relative flex min-h-0 flex-1">
      <Sidebar />
      {state.roomsOpen ? (
        <RoomsPanel />
      ) : state.roomOpen ? (
        <RoomPanel />
      ) : state.groupOpen ? (
        <GroupPanel key={state.groupOpen.id} group={state.groupOpen} />
      ) : bot ? (
        <ChatView bot={bot} />
      ) : (
        <main className="flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-3 bg-app text-ink-secondary">
          <Loader2 size={20} className="animate-spin" />
          <div className="text-[14px]">
            {state.connected ? (polish ? "Brak botów" : "No bots yet") : polish ? "Łączenie z serwerem botów…" : "Connecting to the bot server…"}
          </div>
          {!state.connected && (
            <div className="text-[12px]">
              {polish ? "Uruchom:" : "Start it with"} <code className="rounded bg-raised px-1.5 py-0.5">pnpm dev:server</code>
            </div>
          )}
        </main>
      )}
      {/* multibot (telefon): na desktopie skład grupy stoi obok czatu, tutaj CSS
          rozciąga każdy aside na cały bezpieczny obszar — gdyby renderował się
          zawsze, przykryłby czat grupy, czyli całą funkcję z PR #59. Dlatego
          siedzi w tym samym slocie co ustawienia bota i otwiera go nagłówek. */}
      {state.settingsOpen && state.groupOpen && !state.routinesOpen && <GroupMembersPanel group={state.groupOpen} />}
      {state.settingsOpen && !state.groupOpen && bot && <SettingsPanel bot={bot} />}
      {state.inspectorOpen && bot && <InspectorPanel bot={bot} />}
      {state.computerOpen && bot && <ComputerPanel bot={bot} />}
      {/* multibot: routines are harness-owned and available for every driver. */}
      {state.routinesOpen && bot && <RoutinesPanel key={`${bot.id}-${state.workspaceVersion}`} bot={bot} />}
      {state.skillsOpen && bot && <SkillsPanel key={`${bot.id}-${state.workspaceVersion}`} bot={bot} />}
      {/* multibot: live team map (port z OpenMausBot) — globalny overlay */}
      {state.teamMapOpen && (
        <TeamMapPanel onClose={() => dispatch({ type: "toggleTeamMap", open: false })} />
      )}
      {/* multibot: F9-FE — pokój grupowy; otwierany wyłącznie z sekcji Groups,
          klucz per grupę = świeży mount */}
      {state.appSettingsOpen && <AppSettingsPanel />}
      {state.pluginsOpen && <PluginsPanel />}
      </div>
    </div>
  );
}

export default function App() {
  // multibot: onboarding pokazujemy, dopóki użytkownik go nie domknął. Token w
  // localStorage traktujemy jak dowód konfiguracji TYLKO w przeglądarce: tam
  // musiał go skądś wziąć, więc po deployu i reloadzie gate nie wraca.
  //
  // Pod Electronem token nie dowodzi niczego — spakowana apka wstawia własny
  // przez fragment adresu przy PIERWSZYM starcie. Zliczanie go jako
  // konfiguracji kasowało onboarding, zanim się pokazał, a razem z nim jedyne
  // wejście do konfiguracji serwera (`POST /api/provision` woła wyłącznie
  // Onboarding). Efekt: świeża instalacja desktopowa wchodziła od razu do
  // aplikacji, z pominięciem całego kreatora.
  // …ALE ten wyjątek dotyczy tylko Electrona z LOKALNYM serwerem. W trybie
  // zdalnym (C2) okno ładuje interfejs prosto z cudzego hosta, a token wjeżdża
  // fragmentem adresu — Electron jest wtedy tylko widzem i onboarding „postaw
  // serwer" nie ma sensu; bez tego rozróżnienia panel wyboru wyskakiwał w
  // aplikacji desktopowej przy każdym połączeniu ze zdalnym serwerem.
  // Sam hostname już nie wystarcza: w trybie zdalnym apka podnosi u siebie
  // proxy na 127.0.0.1 i to z niego bierze interfejs (electron/remote-ui.mjs),
  // więc oba tryby wyglądają stąd tak samo i panel „postaw serwer" wracał w
  // trybie zdalnym po aktualizacji. Rozstrzyga flaga, którą proxy wstrzykuje
  // do `index.html` — lokalny harness nigdy jej nie wysyła. Hostname ZOSTAJE
  // jako drugi warunek, bo gdy proxy nie wstanie, main.mjs celowo ładuje
  // interfejs prosto z hosta: flagi wtedy nie ma, ale adres jest zdalny.
  const electronLocal =
    isElectron && !window.__MULTIBOT_REMOTE__ && ["127.0.0.1", "localhost"].includes(window.location.hostname);
  const configured = emailGateDone() || (Boolean(getAuthToken()) && !electronLocal);
  // Mobile completes host setup and authentication before mounting this workspace.
  // Do not cover that authenticated workspace with the desktop setup overlay.
  const [gated, setGated] = useState(() => !configured);
  // Sesja z logowania Google siedzi w ciasteczku HttpOnly, więc `getAuthToken`
  // jej nie widzi — `LoginScreen` sam sprawdza `/api/auth/status` i wpuszcza.
  const [authenticated, setAuthenticated] = useState(() => Boolean(getAuthToken()));
  useEffect(() => {
    initAnalytics();
    const onAuthRequired = () => {
      clearAuthToken();
      setAuthenticated(false);
    };
    window.addEventListener(authEventName(), onAuthRequired);
    return () => window.removeEventListener(authEventName(), onAuthRequired);
  }, []);
  if (!authenticated) return <LoginScreen onLogin={() => { setAuthenticated(true); setGated(false); }} />;
  return (
    <StoreProvider>
      <Shell />
      {gated && <Onboarding onDone={() => setGated(false)} />}
    </StoreProvider>
  );
}
