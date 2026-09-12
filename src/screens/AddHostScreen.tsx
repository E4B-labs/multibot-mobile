import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import * as IntentLauncher from "expo-intent-launcher";

import { isOnionHost, newHostId, normalizeHostUrl, rememberedEntryOf, type Host } from "../lib/host-logic";
import { forgetRemembered, readRemembered, rememberServer, saveHost, type RememberedEntry } from "../lib/hosts";
import { joinErrorField, joinErrorMessage, loginErrorMessage, type JoinErrorCode, type JoinField, type LoginErrorCode } from "../lib/join";
import { installTermux } from "../lib/mobile-release";
import { forgetServer, joinHost, LOCAL_SERVER_URL, probeLocalServer, signInRemembered } from "../lib/tls";
import Server247Checklist from "../components/Server247Checklist";

interface Props {
  onDone: (host: Host, fragment?: string) => void;
}

type Mode = "choice" | "termux" | "signin";

// One paste is unavoidable with stock Termux: it has no deep link and no intent
// for the first command (RUN_COMMAND needs allow-external-apps=true inside
// Termux's own private directory, which no other app can write). The installer
// sets that flag, so restarts later can go through an intent.
const SETUP_COMMAND = "curl -fsSL https://raw.githubusercontent.com/E4B-labs/multibot-desktop/main/scripts/install-termux.sh | sh";

const LOCAL_PROBE_INTERVAL_MS = 3_000;

export default function AddHostScreen({ onDone }: Props) {
  const [mode, setMode] = useState<Mode>("choice");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [url, setUrl] = useState("");
  const [serverName, setServerName] = useState("");
  const [serverPassword, setServerPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<{ field: JoinField; code: JoinErrorCode } | null>(null);
  // „Zapamiętaj mnie" domyślnie WŁĄCZONE. Pięć wartości leży w SecureStore
  // (Keychain/Keystore), nigdy w localStorage strony i nigdy w logu.
  const [remember, setRemember] = useState(true);
  const [saved, setSaved] = useState<RememberedEntry | null>(null);
  const [savedError, setSavedError] = useState<string | null>(null);
  const [showChecklist, setShowChecklist] = useState(false);

  // A `.onion` address has to wait for Tor to build a circuit before anything
  // else happens, so the button says so instead of spinning silently for half a
  // minute. Derived from the typed address alone — no native call, no new IPC.
  const overTor = (() => {
    try {
      return isOnionHost(normalizeHostUrl(url));
    } catch {
      return false;
    }
  })();

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Zapamiętany wpis czytamy raz, przy wejściu. Nie ma w nim żadnego hasła —
  // tylko tyle, ile trzeba, żeby napisać na przycisku, kto i gdzie.
  useEffect(() => {
    let alive = true;
    void readRemembered()
      .then((record) => alive && setSaved(rememberedEntryOf(record)))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const openHost = useCallback(
    async (hostUrl: string, name: string, fragment?: string) => {
      const host: Host = {
        id: newHostId(),
        name,
        url: hostUrl,
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
      };
      // Only the address is stored. The server password is a credential of the
      // server, not of this phone, and never touches SecureStore.
      await saveHost(host);
      onDone(host, fragment);
    },
    [onDone],
  );

  // "Set up a server": if the harness is already up on this phone, skip straight
  // into it — the web UI runs the setup screen from there.
  const openLocalIfUp = useCallback(async () => {
    if (!(await probeLocalServer())) return false;
    // The screen may have been left (or unmounted) during the probe; opening a
    // host from under a screen the user already walked away from is a jump they
    // did not ask for.
    if (!mounted.current) return false;
    await openHost(LOCAL_SERVER_URL, "This phone");
    return true;
  }, [openHost]);

  const startSetup = useCallback(async () => {
    setBusy(true);
    setNotice(null);
    try {
      if (!(await openLocalIfUp())) setMode("termux");
    } finally {
      setBusy(false);
    }
  }, [openLocalIfUp]);

  // While the Termux instructions are on screen, keep asking whether the server
  // came up, so the last step of the setup is "nothing".
  const polling = useRef(false);
  useEffect(() => {
    if (mode !== "termux") return;
    let cancelled = false;
    const tick = () => {
      if (cancelled || polling.current) return;
      polling.current = true;
      void openLocalIfUp().finally(() => {
        polling.current = false;
      });
    };
    const timer = setInterval(tick, LOCAL_PROBE_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
      // A probe still in flight when the screen goes away would otherwise leave
      // the guard stuck and kill the poll if this screen ever comes back.
      polling.current = false;
    };
  }, [mode, openLocalIfUp]);

  async function runStep(step: () => Promise<unknown>, failure: string) {
    setBusy(true);
    setNotice(null);
    try {
      await step();
    } catch (e) {
      setNotice(e instanceof Error ? `${failure} ${e.message}` : failure);
    } finally {
      setBusy(false);
    }
  }

  const copyCommand = () =>
    runStep(async () => {
      await Clipboard.setStringAsync(SETUP_COMMAND);
      setNotice("Command copied. In Termux: long-press → Paste → Enter.");
    }, "Could not copy the command.");

  const openTermux = () =>
    runStep(
      () =>
        IntentLauncher.startActivityAsync("android.intent.action.MAIN", {
          packageName: "com.termux",
          category: "android.intent.category.LAUNCHER",
        }),
      "Could not open Termux — install it first.",
    );

  const allowBackground = () =>
    runStep(
      () =>
        IntentLauncher.startActivityAsync("android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS", {
          data: "package:com.termux",
        }),
      "Could not open the battery setting.",
    );

  async function submitSignIn() {
    setBusy(true);
    setError(null);
    try {
      const result = await joinHost(url, serverName, serverPassword);
      if (!result.ok) {
        const code = result.error ?? "failed";
        setError({ field: joinErrorField(code), code });
        return;
      }
      // Połowa serwerowa „zapamiętaj mnie". Drugą (nazwa i hasło profilu)
      // dokłada strona przez most, gdy logowanie profilu się uda. Odznaczony
      // haczyk KASUJE poprzedni wpis: logowanie bez zapamiętania nie ma prawa
      // zostawić starych haseł w SecureStore.
      await rememberServer(
        remember ? { url: result.url!, serverName: serverName.trim(), serverPassword } : null,
      ).catch(() => undefined);
      await openHost(result.url!, serverName.trim() || result.url!, result.fragment);
    } catch {
      // saveHost, SecureStore or anything else throwing must not leave the
      // spinner spinning with no explanation.
      setError({ field: "form", code: "failed" });
    } finally {
      setBusy(false);
    }
  }

  /** Jedno stuknięcie: join i logowanie profilu robi powłoka, a WebView wstaje
   * z gotową sesją we fragmencie. Strona nie widzi po drodze żadnego hasła. */
  async function submitRemembered() {
    setBusy(true);
    setSavedError(null);
    setError(null);
    try {
      const record = await readRemembered();
      if (!record?.username || !record.password) {
        await forgetRemembered().catch(() => undefined);
        setSaved(null);
        return;
      }
      const result = await signInRemembered({
        url: record.url,
        serverName: record.serverName,
        serverPassword: record.serverPassword,
        username: record.username,
        password: record.password,
      });
      if (!result.ok) {
        const code = result.error ?? "failed";
        setSavedError(
          code === "no_such_profile" || code === "wrong_profile_password" || code === "join_grant_invalid"
            ? loginErrorMessage(code as LoginErrorCode)
            : joinErrorMessage(code as JoinErrorCode),
        );
        return;
      }
      await openHost(result.url!, record.serverName || result.url!, result.fragment);
    } catch {
      setSavedError("The saved sign-in did not work. Enter the three values again.");
    } finally {
      setBusy(false);
    }
  }

  async function forgetSaved() {
    await forgetRemembered().catch(() => undefined);
    setSaved(null);
    setSavedError(null);
  }

  async function trustNewCertificate() {
    try {
      forgetServer(normalizeHostUrl(url));
    } catch {
      // An address that doesn't parse has no pin; the retry reports it properly.
    }
    setError(null);
    await submitSignIn();
  }

  const fieldError = (field: JoinField) =>
    error?.field === field ? <Text style={styles.error}>{joinErrorMessage(error.code)}</Text> : null;

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.eyebrow}>MULTIBOT</Text>

        {mode === "choice" && (
          <View style={styles.cards}>
            <Text style={styles.title}>Get started</Text>
            {saved && (
              // Zapamiętany wpis stoi PRZED wyborem: po wylogowaniu to jest ta
              // jedna rzecz, którą użytkownik chce stuknąć.
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Welcome back</Text>
                <Text style={styles.cardBody}>Signed in here before as {saved.username} on {saved.serverName || saved.url}.</Text>
                {savedError ? <Text style={styles.error}>{savedError}</Text> : null}
                <Pressable style={[styles.primaryButton, busy && styles.primaryDisabled]} disabled={busy} onPress={() => void submitRemembered()}>
                  {busy ? <ActivityIndicator color="#070707" /> : <Text style={styles.primaryButtonText}>Sign in as {saved.username}</Text>}
                </Pressable>
                <Pressable style={styles.linkButton} disabled={busy} onPress={() => void forgetSaved()}>
                  <Text style={styles.linkText}>Forget this saved sign-in</Text>
                </Pressable>
              </View>
            )}
            {Platform.OS === "android" ? (
              <Pressable style={styles.card} disabled={busy} onPress={() => void startSetup()}>
                <Text style={styles.cardTitle}>Set up a server</Text>
                <Text style={styles.cardBody}>
                  Run the MultiBot server on this phone. It keeps running in the background and other devices sign in to it.
                </Text>
                {busy ? <ActivityIndicator color="#fcfcfc" style={styles.cardSpinner} /> : null}
              </Pressable>
            ) : (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Set up a server</Text>
                <Text style={styles.cardBody}>
                  iPhone can&apos;t host a server. Set one up on a computer or an Android phone, then sign in here.
                </Text>
              </View>
            )}
            {Platform.OS === "android" ? (
              <Pressable style={styles.card} disabled={busy} onPress={() => { setMode("termux"); setShowChecklist(true); }}>
                <Text style={styles.cardTitle}>Server 24/7</Text>
                <Text style={styles.cardBody}>Open Android recovery checklist for battery, Samsung sleep rules, Tailscale VPN, Wi‑Fi and phantom processes.</Text>
              </Pressable>
            ) : null}
            <Pressable style={styles.card} disabled={busy} onPress={() => setMode("signin")}>
              <Text style={styles.cardTitle}>Sign in to a server</Text>
              <Text style={styles.cardBody}>
                You need the server&apos;s address, its name and its password — the three values it showed at setup.
              </Text>
            </Pressable>
          </View>
        )}

        {mode === "termux" && (
          <View style={styles.steps}>
            <Text style={styles.title}>Set up a server</Text>
            <Text style={styles.intro}>
              The server runs inside Termux. Do these three steps once; this screen notices by itself when the server is up.
            </Text>

            <Text style={styles.step}>1. Install Termux</Text>
            <Pressable style={[styles.primaryButton, busy && styles.primaryDisabled]} disabled={busy} onPress={() => void runStep(installTermux, "Could not download Termux.")}>
              <Text style={styles.primaryButtonText}>Download Termux</Text>
            </Pressable>

            <Text style={styles.step}>2. Paste one command into Termux</Text>
            <Text style={styles.command} selectable>
              {SETUP_COMMAND}
            </Text>
            <Pressable style={styles.secondaryButton} disabled={busy} onPress={() => void copyCommand()}>
              <Text style={styles.secondaryButtonText}>Copy command</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} disabled={busy} onPress={() => void openTermux()}>
              <Text style={styles.secondaryButtonText}>Open Termux</Text>
            </Pressable>
            <Text style={styles.hint}>In Termux: long-press → Paste → Enter.</Text>

            <Text style={styles.step}>3. Let it run in the background</Text>
            <Pressable style={styles.secondaryButton} disabled={busy} onPress={() => void allowBackground()}>
              <Text style={styles.secondaryButtonText}>Allow background battery use</Text>
            </Pressable>
            <Text style={styles.hint}>
              Open Termux:Boot once after installing it, so the server comes back after a restart.
            </Text>
            <Text style={styles.hint}>
              On Android 12 and 13 the phantom process killer stops the server after a while; clearing that needs a one-off adb command from a computer.
            </Text>
            <Pressable style={styles.secondaryButton} disabled={busy} onPress={() => setShowChecklist(true)}>
              <Text style={styles.secondaryButtonText}>Open Server 24/7 checklist</Text>
            </Pressable>

            {busy ? <ActivityIndicator color="#fcfcfc" style={styles.cardSpinner} /> : null}
            {notice ? <Text style={styles.notice}>{notice}</Text> : null}
            <Pressable style={styles.linkButton} onPress={() => setMode("choice")}>
              <Text style={styles.linkText}>Back</Text>
            </Pressable>
            {showChecklist ? (
              <View style={styles.checklistOverlay}>
                <Server247Checklist embedded={false} onClose={() => setShowChecklist(false)} />
              </View>
            ) : null}
          </View>
        )}

        {mode === "signin" && (
          <View>
            <Text style={styles.title}>Sign in to a server</Text>
            <Text style={styles.intro}>Enter the three values the server showed when it was set up.</Text>

            <Text style={styles.label}>Address</Text>
            <TextInput
              style={styles.input}
              value={url}
              onChangeText={setUrl}
              placeholder="192.168.1.42:8799"
              placeholderTextColor="#fcfcfc55"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              autoFocus
            />
            {fieldError("address")}
            {error?.code === "certificate_changed" && (
              <Pressable style={styles.secondaryButton} disabled={busy} onPress={() => void trustNewCertificate()}>
                <Text style={styles.secondaryButtonText}>Trust new certificate</Text>
              </Pressable>
            )}

            <Text style={styles.label}>Server name</Text>
            <TextInput
              style={styles.input}
              value={serverName}
              onChangeText={setServerName}
              placeholder="brave-otter"
              placeholderTextColor="#fcfcfc55"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {fieldError("serverName")}

            <Text style={styles.label}>Server password</Text>
            <View style={styles.passwordRow}>
              <TextInput
                style={[styles.input, styles.passwordInput]}
                value={serverPassword}
                onChangeText={setServerPassword}
                placeholder="7f3k-92xa-qq5m"
                placeholderTextColor="#fcfcfc55"
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry={!showPassword}
              />
              <Pressable
                accessibilityLabel={showPassword ? "Hide password" : "Show password"}
                accessibilityRole="button"
                style={styles.eyeButton}
                onPress={() => setShowPassword((on) => !on)}
              >
                <Text style={styles.eyeText}>{showPassword ? "Hide" : "Show"}</Text>
              </Pressable>
            </View>
            {fieldError("serverPassword")}
            {fieldError("form")}

            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: remember }}
              onPress={() => setRemember((on) => !on)}
              style={styles.rememberRow}
            >
              <View style={[styles.checkbox, remember && styles.checkboxOn]}>
                {remember ? <Text style={styles.checkboxMark}>{"✓"}</Text> : null}
              </View>
              <Text style={styles.rememberText}>Remember me on this phone</Text>
            </Pressable>

            <Pressable
              style={[styles.primaryButton, (busy || !url.trim() || !serverName.trim() || !serverPassword) && styles.primaryDisabled]}
              disabled={busy || !url.trim() || !serverName.trim() || !serverPassword}
              onPress={() => void submitSignIn()}
            >
              {busy ? (
                <View style={styles.buttonRow}>
                  <ActivityIndicator color="#070707" />
                  {overTor ? <Text style={styles.primaryButtonText}>Connecting through Tor (up to 30 s)…</Text> : null}
                </View>
              ) : (
                <Text style={styles.primaryButtonText}>Sign in</Text>
              )}
            </Pressable>
            <Pressable style={styles.linkButton} onPress={() => setMode("choice")}>
              <Text style={styles.linkText}>Back</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flexGrow: 1, padding: 20, paddingBottom: 34, gap: 10 },
  eyebrow: { color: "#38d591", fontSize: 11, fontWeight: "800", letterSpacing: 1.8, marginTop: 4 },
  title: { color: "#fcfcfc", fontSize: 28, fontWeight: "800", letterSpacing: -0.4, marginBottom: 2, marginTop: 2 },
  intro: { color: "#fcfcfc99", fontSize: 14, lineHeight: 20, marginBottom: 6 },
  cards: { gap: 12 },
  card: { backgroundColor: "#151515", borderRadius: 12, borderWidth: 1, borderColor: "#242424", gap: 6, padding: 16 },
  cardTitle: { color: "#fcfcfc", fontSize: 18, fontWeight: "700" },
  cardBody: { color: "#fcfcfc99", fontSize: 14, lineHeight: 20 },
  cardSpinner: { marginTop: 8 },
  steps: { gap: 6 },
  step: { color: "#fcfcfc", fontSize: 15, fontWeight: "700", marginTop: 16 },
  command: { color: "#38d591", backgroundColor: "#101010", borderRadius: 8, fontSize: 12, lineHeight: 18, padding: 10 },
  label: { color: "#fcfcfc99", fontSize: 13, marginTop: 12 },
  hint: { color: "#fcfcfc55", fontSize: 12, lineHeight: 17, marginTop: 4 },
  input: { color: "#fcfcfc", backgroundColor: "#151515", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  passwordRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  passwordInput: { flex: 1 },
  eyeButton: { alignItems: "center", justifyContent: "center", minHeight: 44, paddingHorizontal: 12 },
  eyeText: { color: "#fcfcfc99", fontSize: 14, fontWeight: "600" },
  error: { color: "#ff8080", fontSize: 13, marginTop: 6 },
  rememberRow: { alignItems: "center", flexDirection: "row", gap: 10, marginTop: 14, minHeight: 44 },
  checkbox: { alignItems: "center", borderColor: "#3a3a3a", borderRadius: 5, borderWidth: 1.5, height: 20, justifyContent: "center", width: 20 },
  checkboxOn: { backgroundColor: "#38d591", borderColor: "#38d591" },
  checkboxMark: { color: "#070707", fontSize: 13, fontWeight: "800", lineHeight: 15 },
  rememberText: { color: "#fcfcfc99", fontSize: 14 },
  notice: { color: "#fcfcfc99", fontSize: 13, marginTop: 10 },
  buttonRow: { alignItems: "center", flexDirection: "row", gap: 10 },
  primaryButton: { alignItems: "center", backgroundColor: "#fcfcfc", borderRadius: 10, marginTop: 16, minHeight: 44, justifyContent: "center", paddingHorizontal: 14 },
  primaryDisabled: { opacity: 0.5 },
  primaryButtonText: { color: "#070707", fontSize: 16, fontWeight: "700" },
  secondaryButton: { alignItems: "center", backgroundColor: "#242424", borderRadius: 10, marginTop: 8, minHeight: 44, justifyContent: "center", paddingHorizontal: 14 },
  secondaryButtonText: { color: "#fcfcfc", fontSize: 15, fontWeight: "600" },
  linkButton: { alignItems: "center", justifyContent: "center", marginTop: 14, minHeight: 44 },
  linkText: { color: "#fcfcfc99", fontSize: 14 },
  checklistOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "#070707", zIndex: 40 },
});
