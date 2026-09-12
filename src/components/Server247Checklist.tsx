import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, AppState, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as IntentLauncher from "expo-intent-launcher";
import { ownAppIgnoresBatteryOptimizations } from "../lib/tls";

const SELF_PACKAGE = "com.multibot2.mobile";
const ADB_COMMAND = "adb shell settings put global settings_enable_monitor_phantom_procs false";

type Props = { onClose?: () => void; embedded?: boolean };

async function openIntent(action: string, options: Record<string, string> = {}): Promise<void> {
  await IntentLauncher.startActivityAsync(action, options);
}

export default function Server247Checklist({ onClose, embedded = true }: Props) {
  const [ownBattery, setOwnBattery] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(() => {
    try {
      setOwnBattery(Platform.OS === "android" ? ownAppIgnoresBatteryOptimizations() : true);
    } catch {
      setOwnBattery(null);
    }
  }, []);

  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener("change", (state) => state === "active" && refresh());
    return () => sub.remove();
  }, [refresh]);

  const run = useCallback(async (id: string, action: () => Promise<void>, fallback?: () => Promise<void>) => {
    setBusy(id);
    setNotice(null);
    try {
      await action();
    } catch (error) {
      if (fallback) {
        try {
          await fallback();
          return;
        } catch {
          // Fall through to one actionable message.
        }
      }
      setNotice(error instanceof Error ? error.message : "Nie można otworzyć ustawienia.");
    } finally {
      setBusy(null);
    }
  }, []);

  const copyAdb = () => {
    void Clipboard.setStringAsync(ADB_COMMAND);
    setNotice("Polecenie ADB skopiowane. Uruchom je na komputerze z podłączonym telefonem.");
  };

  const button = (id: string, label: string, action: () => Promise<void>, fallback?: () => Promise<void>) => (
    <Pressable accessibilityRole="button" disabled={busy !== null} style={styles.button} onPress={() => void run(id, action, fallback)}>
      {busy === id ? <ActivityIndicator color="#fcfcfc" /> : <Text style={styles.buttonText}>{label}</Text>}
    </Pressable>
  );

  return (
    <View style={[styles.panel, embedded ? null : styles.overlayPanel]}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>Serwer 24/7</Text>
          <Text style={styles.intro}>Android może usypiać Termux, Tailscale albo ten APK. Ustaw każdy punkt raz.</Text>
        </View>
        {onClose ? <Pressable accessibilityLabel="Zamknij checklistę" onPress={onClose} style={styles.close}><Text style={styles.closeText}>×</Text></Pressable> : null}
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.section}>Aplikacje</Text>
        <View style={styles.row}>
          <Text style={styles.rowText}>{ownBattery === true ? "✓" : "!"} MultiBot Mobile — bateria</Text>
          {button("self", "Ustaw", () => openIntent("android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS", { data: `package:${SELF_PACKAGE}` }))}
        </View>
        <Text style={styles.status}>{ownBattery === true ? "Wykryto: optymalizacja wyłączona." : ownBattery === false ? "Wykryto: optymalizacja nadal włączona." : "Stan niewykrywalny w tym buildzie — sprawdź ręcznie."}</Text>
        <View style={styles.row}>
          <Text style={styles.rowText}>! Termux — bateria</Text>
          {button("termux-battery", "Ustaw", () => openIntent("android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS", { data: "package:com.termux" }))}
        </View>
        <View style={styles.row}>
          <Text style={styles.rowText}>! Tailscale — bateria</Text>
          {button("tailscale-battery", "Ustaw", () => openIntent("android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS", { data: "package:com.tailscale.ipn" }))}
        </View>
        <Text style={styles.hint}>Dla Termux i Tailscale Android nie udostępnia bezpiecznego odczytu z obcej aplikacji — potwierdź ręcznie.</Text>
        {button("battery-list", "Otwórz listę wyjątków baterii", () => openIntent("android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS"))}
        {button("samsung", "Samsung: Aplikacje nigdy nieusypiane", () => openIntent("android.intent.action.MAIN", { packageName: "com.samsung.android.lool", category: "android.intent.category.LAUNCHER" }), () => openIntent("android.intent.action.MAIN", { packageName: "com.samsung.android.sm", category: "android.intent.category.LAUNCHER" }))}

        <Text style={styles.section}>Sieć</Text>
        <Text style={styles.hint}>Tailscale → Settings → Always-on VPN. Wyłącz oszczędzanie Wi‑Fi przy zgaszonym ekranie.</Text>
        {button("vpn", "Otwórz ustawienia VPN", () => openIntent("android.settings.VPN_SETTINGS"))}
        {button("wifi", "Otwórz zaawansowane Wi‑Fi", () => openIntent("android.settings.WIFI_IP_SETTINGS"), () => openIntent("android.settings.WIFI_SETTINGS"))}

        <Text style={styles.section}>Po restarcie telefonu</Text>
        <Text style={styles.hint}>Otwórz Termux:Boot raz. Wyłącz Samsung → Konserwacja urządzenia → Automatyczny restart. Zostaw wakelock Termuxa aktywny.</Text>
        {button("termux", "Otwórz Termux", () => openIntent("android.intent.action.MAIN", { packageName: "com.termux", category: "android.intent.category.LAUNCHER" }))}

        <Text style={styles.section}>Android 12+ — jednorazowo przez ADB</Text>
        <Text selectable style={styles.command}>{ADB_COMMAND}</Text>
        <Pressable accessibilityRole="button" style={styles.button} onPress={copyAdb}><Text style={styles.buttonText}>Kopiuj polecenie ADB</Text></Pressable>
        <Text style={styles.hint}>Polecenie wyłącza phantom process killer. Wymaga Opcji programisty + Debugowania USB. Nie wymaga roota.</Text>
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: "#070707", flex: 1 },
  overlayPanel: { borderColor: "#333", borderWidth: 1, borderRadius: 14, margin: 14, overflow: "hidden" },
  header: { alignItems: "flex-start", borderBottomColor: "#242424", borderBottomWidth: 1, flexDirection: "row", padding: 18 },
  headerCopy: { flex: 1 },
  title: { color: "#fcfcfc", fontSize: 24, fontWeight: "800" },
  intro: { color: "#fcfcfc99", fontSize: 14, lineHeight: 20, marginTop: 6 },
  close: { alignItems: "center", height: 44, justifyContent: "center", width: 44 },
  closeText: { color: "#fcfcfc99", fontSize: 30, lineHeight: 32 },
  content: { gap: 8, padding: 18, paddingBottom: 28 },
  section: { color: "#38d591", fontSize: 13, fontWeight: "800", letterSpacing: 1, marginTop: 14, textTransform: "uppercase" },
  row: { alignItems: "center", backgroundColor: "#151515", borderRadius: 9, flexDirection: "row", gap: 8, justifyContent: "space-between", minHeight: 54, paddingLeft: 12 },
  rowText: { color: "#fcfcfc", flex: 1, fontSize: 14, fontWeight: "600" },
  status: { color: "#fcfcfc99", fontSize: 12, marginLeft: 12 },
  button: { alignItems: "center", alignSelf: "stretch", backgroundColor: "#242424", borderRadius: 9, justifyContent: "center", minHeight: 44, paddingHorizontal: 12 },
  rowButton: { flex: 0 },
  buttonText: { color: "#fcfcfc", fontSize: 14, fontWeight: "700", textAlign: "center" },
  hint: { color: "#fcfcfc66", fontSize: 12, lineHeight: 17 },
  command: { backgroundColor: "#101010", color: "#38d591", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 12, lineHeight: 18, padding: 10 },
  notice: { color: "#38d591", fontSize: 13, lineHeight: 18, marginTop: 8 },
});
