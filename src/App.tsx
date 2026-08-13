import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { StoreProvider, useStore } from "@/state/store";
import { Onboarding } from "@/components/Onboarding";
import { emailGateDone, initAnalytics } from "@/lib/analytics";
import { Sidebar } from "@/components/Sidebar";
import { ChatView } from "@/components/ChatView";
import { SettingsPanel } from "@/components/SettingsPanel";
import { PluginsPanel } from "@/components/PluginsPanel";
import { ComputerPanel } from "@/components/ComputerPanel";
import { AppSettingsPanel } from "@/components/AppSettingsPanel";
// multibot: F6 — panel rutyn silnika slafy
import { RoutinesPanel } from "@/components/RoutinesPanel";
// multibot: F8 — panele pamięci i skilli silnika slafy
import { MemoryPanel } from "@/components/MemoryPanel";
import { SkillsPanel } from "@/components/SkillsPanel";
// multibot: F9-FE — pokój grupowy silnika slafy
import { GroupPanel } from "@/components/GroupPanel";
import { UpdateBanner } from "@/components/UpdateBanner";
// multibot: Cmd/Ctrl+K paleta komend
import { CmdK } from "@/components/CmdK";
import { authEventName, authFetch, clearAuthToken, getAuthToken, setAuthToken } from "@/lib/auth";

function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!token.trim() || busy) return;
    setBusy(true);
    setError(null);
    setAuthToken(token);
    try {
      const response = await authFetch("/api/instances");
      if (!response.ok) throw new Error(response.status === 401 ? "Invalid access token" : "Server unavailable");
      onLogin();
    } catch (e) {
      clearAuthToken();
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="flex h-full min-h-screen items-center justify-center bg-app px-5 text-ink">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-xl"
      >
        <h1 className="text-[18px] font-semibold">Sign in</h1>
        <p className="mt-1 text-[13px] text-ink-secondary">Enter access token for this Multibot server.</p>
        <input
          autoFocus
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="Access token"
          autoComplete="current-password"
          className="mt-4 w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2.5 text-[14px] text-ink outline-none focus:border-hairline"
        />
        <button
          type="submit"
          disabled={busy || !token.trim()}
          className="mt-3 w-full rounded-lg bg-accent py-2.5 text-[13px] font-medium text-white disabled:opacity-50"
        >
          {busy ? "Checking…" : "Sign in"}
        </button>
        {error && <div className="mt-2 text-[12px] text-danger">{error}</div>}
      </form>
    </main>
  );
}

function Shell() {
  const { state } = useStore();
  const bot = state.bots.find((b) => b.id === state.selectedId) ?? state.bots[0];
  // multibot: F6 — gate jak w SettingsPanel: rutyny tylko dla botów na driverze slafy
  const slafyBot =
    bot &&
    state.instances.find((i) => i.instanceId === bot.modelSelection.instanceId)?.driverKind ===
      "slafy";
  return (
    <div className="multibot-shell flex h-full flex-col">
      {/* fixed-position popup, bottom-left — outside the layout flow */}
      <UpdateBanner />
      {/* multibot: Cmd/Ctrl+K command palette — fixed overlay, renders null until opened */}
      <CmdK />
      <div className="relative flex min-h-0 flex-1">
      <Sidebar />
      {bot ? (
        <ChatView bot={bot} />
      ) : (
        <main className="flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-3 bg-app text-ink-secondary">
          <Loader2 size={20} className="animate-spin" />
          <div className="text-[14px]">
            {state.connected ? "No bots yet" : "Connecting to the bot server…"}
          </div>
          {!state.connected && (
            <div className="text-[12px]">
              Start it with <code className="rounded bg-raised px-1.5 py-0.5">pnpm dev:server</code>
            </div>
          )}
        </main>
      )}
      {state.settingsOpen && bot && <SettingsPanel bot={bot} />}
      {state.computerOpen && bot && <ComputerPanel bot={bot} />}
      {/* multibot: F6 — klucz per bot.id wymusza remount + świeży GET przy przełączeniu bota */}
      {state.routinesOpen && slafyBot && <RoutinesPanel key={bot.id} bot={bot} />}
      {/* multibot: F8 — pamięć i skille, ten sam gate i ta sama zasada klucza */}
      {state.memoryOpen && slafyBot && <MemoryPanel key={bot.id} bot={bot} />}
      {state.skillsOpen && slafyBot && <SkillsPanel key={bot.id} bot={bot} />}
      {/* multibot: F9-FE — pokój grupowy; otwierany wyłącznie z sekcji Groups
          (widocznej tylko przy botach slafy), klucz per grupę = świeży mount */}
      {state.groupOpen && <GroupPanel key={state.groupOpen.id} group={state.groupOpen} />}
      {state.appSettingsOpen && <AppSettingsPanel />}
      {state.pluginsOpen && <PluginsPanel />}
      </div>
    </div>
  );
}

export default function App() {
  const [gated, setGated] = useState(() => !emailGateDone());
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
  if (!authenticated) return <LoginScreen onLogin={() => setAuthenticated(true)} />;
  return (
    <StoreProvider>
      <Shell />
      {gated && <Onboarding onDone={() => setGated(false)} />}
    </StoreProvider>
  );
}
