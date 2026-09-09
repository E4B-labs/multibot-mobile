import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { StoreProvider, useStore } from "@/state/store";
import { Onboarding } from "@/components/Onboarding";
import { initAnalytics } from "@/lib/analytics";
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
import { authEventName, clearAuthToken, getAuthToken, refreshAccessToken } from "@/lib/auth";
import { registerPushViaShell, shellPost } from "@/lib/shell";
import { useLanguage } from "@/lib/language";
import { openBotPicker } from "@/lib/mobileNavigation";

function Shell() {
  const { state, dispatch } = useStore();
  const nativeBackState = useRef(state);
  nativeBackState.current = state;
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
    if (bot) shellPost({ type: "bot.selected", botId: bot.id });
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
  // Android back is a two-step app navigation: chat -> bot picker -> phone
  // desktop. The native shell asks the page first, so normal back never
  // deletes the saved host or returns to sign-in.
  useEffect(() => {
    const onNativeBack = (event: Event) => {
      const currentState = nativeBackState.current;
      const requestId = (event as CustomEvent<{ requestId?: unknown }>).detail?.requestId;
      const reply = (handled: boolean) => shellPost({
        type: "native.back.result",
        requestId: typeof requestId === "string" ? requestId : undefined,
        handled,
      });

      // Close an open palette/dialog or app panel before changing the drawer
      // level. This keeps Back behaving like screen navigation inside the UI.
      if (document.querySelector('[role="dialog"]')) {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        reply(true);
        return;
      }
      const closePanel = currentState.appSettingsOpen
        ? () => {
            openBotPicker();
            dispatch({ type: "toggleAppSettings", open: false });
          }
        : currentState.pluginsOpen
          ? () => dispatch({ type: "togglePlugins", open: false })
          : currentState.computerOpen
            ? () => dispatch({ type: "toggleComputer", open: false })
            : currentState.inspectorOpen
              ? () => dispatch({ type: "toggleInspector", open: false })
              : currentState.skillsOpen
                ? () => dispatch({ type: "toggleSkills", open: false })
                : currentState.routinesOpen
                  ? () => dispatch({ type: "toggleRoutines", open: false })
                  : currentState.teamMapOpen
                    ? () => dispatch({ type: "toggleTeamMap", open: false })
                    : currentState.roomsOpen
                      ? () => dispatch({ type: "toggleRooms", open: false })
                      : currentState.roomOpen
                        ? () => dispatch({ type: "toggleRoom", room: null })
                        : currentState.groupOpen
                          ? () => {
                              openBotPicker();
                              dispatch({ type: "toggleGroup", group: null });
                            }
                          : currentState.settingsOpen
                            ? () => {
                                openBotPicker();
                                dispatch({ type: "toggleSettings", open: false });
                              }
                            : null;
      if (closePanel) {
        closePanel();
        reply(true);
        return;
      }
      const opened = document.body.classList.contains("mb-drawer-open");
      reply(!opened);
      if (!opened) document.body.classList.add("mb-drawer-open");
    };
    window.addEventListener("mb:native-back", onNativeBack);
    return () => window.removeEventListener("mb:native-back", onNativeBack);
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
      {/* multibot: live team map (port z upstreamu) — globalny overlay */}
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
  // Onboarding IS the sign-in screen now (src/components/Onboarding.tsx): the
  // first thing every device shows is "set up a server" or "sign in to one",
  // and reaching the app at all means a profile on some server accepted us.
  // Nothing local — no token, no analytics gate — decides that any more.
  //
  // Ciasteczko sesji (`mb_v2_session`) siedzi w HttpOnly i żyje dłużej niż
  // 15-minutowy token dostępu, więc pusty localStorage to jeszcze nie
  // wylogowanie: tryb prywatny, wyczyszczone dane albo jedno błędne 401 i
  // token znika, choć serwer nadal nas zna. Zanim pokażemy formularz, prosimy
  // sesję o nowy token — jedno wołanie, które przy okazji od razu go daje.
  const [authenticated, setAuthenticated] = useState(() => Boolean(getAuthToken()));
  const [checkingSession, setCheckingSession] = useState(() => !getAuthToken());
  useEffect(() => {
    initAnalytics();
    const onAuthRequired = () => {
      clearAuthToken();
      setAuthenticated(false);
    };
    window.addEventListener(authEventName(), onAuthRequired);
    if (checkingSession) void refreshAccessToken().then((result) => {
      if (result === "ok") setAuthenticated(true);
      setCheckingSession(false);
    });
    return () => window.removeEventListener(authEventName(), onAuthRequired);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sonda sesji leci raz, przy montowaniu
  }, []);
  // Push na telefonie: powłoka mobilna przestała rejestrować go sama (PR #30 w
  // multibot-mobile). Ona ma zgodę systemową i token Expo, my mamy sesję, która
  // mówi, CZYJE to urządzenie — więc pytamy ją o token i sami go zgłaszamy.
  // Raz na start aplikacji: to jedna wiadomość, a przy okazji ponawia
  // rejestrację, którą serwer odrzucił, i łapie token obrócony przez system.
  useEffect(() => {
    if (!authenticated) return;
    void registerPushViaShell();
  }, [authenticated]);
  // Pusty ekran, a nie mignięcie formularzem, gdy sesja właśnie się potwierdza.
  if (checkingSession) return null;
  if (!authenticated) return <Onboarding onDone={() => setAuthenticated(true)} />;
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
