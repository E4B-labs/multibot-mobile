import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";

import { newHostId, normalizeHostUrl, type Host } from "../lib/host-logic";
import { saveHost } from "../lib/hosts";
import { claimPairing, parseQrPayload } from "../lib/pair";

interface Props {
  onDone: (host: Host) => void;
  onCancel: () => void;
}

type Mode = "choose" | "scan" | "manual";

export default function AddHostScreen({ onDone, onCancel }: Props) {
  const [mode, setMode] = useState<Mode>("choose");
  const [permission, requestPermission] = useCameraPermissions();
  const [scanLocked, setScanLocked] = useState(false);
  const [url, setUrl] = useState("");
  const [code, setCode] = useState("");
  const [token, setToken] = useState("");
  const [name, setName] = useState("My phone");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function finish(rawUrl: string, tokenValue: string) {
    const trimmedToken = tokenValue.trim();
    if (!trimmedToken) {
      setError("An access token is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const normalized = normalizeHostUrl(rawUrl);
      const host: Host = {
        id: newHostId(),
        name: name.trim() || normalized,
        url: normalized,
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
      };
      await saveHost(host, trimmedToken);
      onDone(host);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add host");
    } finally {
      setBusy(false);
    }
  }

  async function handleScan({ data }: BarcodeScanningResult) {
    if (scanLocked) return;
    setScanLocked(true);
    const payload = parseQrPayload(data);
    if (!payload) {
      setError("That QR code didn't contain a MultiBot host address.");
      setMode("choose");
      setScanLocked(false);
      return;
    }
    if (!payload.code) {
      // Bare URL QR, no pairing code — fall through to manual token entry.
      setUrl(payload.url);
      setMode("manual");
      setScanLocked(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await claimPairing(payload.url, payload.code, name.trim() || "My phone");
      await finish(payload.url, result.token);
    } catch (e) {
      // Seam: /api/pair/claim isn't wired server-side yet (see pair.ts) —
      // degrade to manual token entry instead of dead-ending the flow.
      setUrl(payload.url);
      setError(e instanceof Error ? e.message : "Pairing failed");
      setMode("manual");
    } finally {
      setBusy(false);
      setScanLocked(false);
    }
  }

  async function handleConnect() {
    if (code.trim()) {
      setBusy(true);
      setError(null);
      try {
        const normalized = normalizeHostUrl(url);
        const result = await claimPairing(normalized, code.trim(), name.trim() || "My phone");
        await finish(normalized, result.token);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Pairing failed — try the access token instead.");
      } finally {
        setBusy(false);
      }
      return;
    }
    await finish(url, token);
  }

  if (mode === "choose") {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Add a host</Text>
        <Pressable style={styles.primaryButton} onPress={() => setMode("scan")}>
          <Text style={styles.primaryButtonText}>Scan QR code</Text>
        </Pressable>
        <Pressable style={styles.secondaryButton} onPress={() => setMode("manual")}>
          <Text style={styles.secondaryButtonText}>Enter address &amp; token manually</Text>
        </Pressable>
        <Pressable style={styles.cancelButton} onPress={onCancel}>
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </Pressable>
        {error && <Text style={styles.error}>{error}</Text>}
      </View>
    );
  }

  if (mode === "scan") {
    if (!permission) return <View style={styles.container} />;
    if (!permission.granted) {
      return (
        <View style={styles.container}>
          <Text style={styles.dim}>MultiBot needs camera access to scan the pairing QR code.</Text>
          <Pressable style={styles.primaryButton} onPress={() => void requestPermission()}>
            <Text style={styles.primaryButtonText}>Grant camera access</Text>
          </Pressable>
          <Pressable style={styles.cancelButton} onPress={() => setMode("choose")}>
            <Text style={styles.cancelButtonText}>Back</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <View style={styles.container}>
        <CameraView
          style={styles.camera}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={busy ? undefined : handleScan}
        />
        {busy && <ActivityIndicator style={styles.overlaySpinner} color="#fcfcfc" />}
        <Pressable style={styles.cancelButton} onPress={() => setMode("choose")}>
          <Text style={styles.cancelButtonText}>Back</Text>
        </Pressable>
      </View>
    );
  }

  // manual
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Connect to host</Text>
      <Text style={styles.label}>Host address</Text>
      <TextInput
        style={styles.input}
        value={url}
        onChangeText={setUrl}
        placeholder="https://your-host.ts.net"
        placeholderTextColor="#fcfcfc55"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />
      <Text style={styles.label}>Device name</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} placeholderTextColor="#fcfcfc55" />
      <Text style={styles.label}>One-time pairing code (if the host showed you a QR/code)</Text>
      <TextInput
        style={styles.input}
        value={code}
        onChangeText={setCode}
        placeholder="6-digit code"
        placeholderTextColor="#fcfcfc55"
        keyboardType="number-pad"
      />
      <Text style={styles.label}>Access token (Settings → Token on that host) — used if no code above</Text>
      <TextInput
        style={styles.input}
        value={token}
        onChangeText={setToken}
        placeholder="paste token"
        placeholderTextColor="#fcfcfc55"
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
      />
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable
        style={styles.primaryButton}
        disabled={busy || !url.trim() || (!code.trim() && !token.trim())}
        onPress={() => void handleConnect()}
      >
        {busy ? <ActivityIndicator color="#070707" /> : <Text style={styles.primaryButtonText}>Connect</Text>}
      </Pressable>
      <Pressable style={styles.cancelButton} onPress={onCancel}>
        <Text style={styles.cancelButtonText}>Cancel</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, gap: 10 },
  camera: { flex: 1, borderRadius: 12, overflow: "hidden" },
  overlaySpinner: { position: "absolute", top: "50%", left: "50%", marginLeft: -10, marginTop: -10 },
  title: { color: "#fcfcfc", fontSize: 24, fontWeight: "700", marginBottom: 8 },
  label: { color: "#fcfcfc99", fontSize: 13, marginTop: 8 },
  input: { color: "#fcfcfc", backgroundColor: "#151515", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  dim: { color: "#fcfcfc99", fontSize: 15, marginBottom: 12 },
  error: { color: "#ff8080", fontSize: 13, marginTop: 8 },
  primaryButton: { marginTop: 16, backgroundColor: "#fcfcfc", borderRadius: 10, paddingVertical: 14, alignItems: "center" },
  primaryButtonText: { color: "#070707", fontSize: 16, fontWeight: "700" },
  secondaryButton: { marginTop: 12, borderWidth: 1, borderColor: "#333", borderRadius: 10, paddingVertical: 14, alignItems: "center" },
  secondaryButtonText: { color: "#fcfcfc", fontSize: 15 },
  cancelButton: { marginTop: 12, paddingVertical: 10, alignItems: "center" },
  cancelButtonText: { color: "#fcfcfc99", fontSize: 14 },
});
