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

type Segment = "scan" | "manual";

export default function AddHostScreen({ onDone, onCancel }: Props) {
  const [segment, setSegment] = useState<Segment>("scan");
  const [permission, requestPermission] = useCameraPermissions();
  const [scanLocked, setScanLocked] = useState(false);
  const [url, setUrl] = useState("");
  const [code, setCode] = useState("");
  const [token, setToken] = useState("");
  const [name, setName] = useState("My phone");
  // multibot: profil użytkownika (workspace #62) — podpisuje wiadomości i
  // pokazuje, kto pracuje w workspace. Zapisywany best-effort po połączeniu.
  const [profileName, setProfileName] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
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
      // multibot: workspace #62 — zapisz profil użytkownika, jeśli podano.
      // Best-effort: nie blokujemy połączenia, gdyby endpoint nie odpowiedział.
      if (profileName.trim() || profileEmail.trim()) {
        try {
          await fetch(normalized + "/api/config", {
            method: "PUT",
            headers: { "content-type": "application/json", Authorization: "Bearer " + trimmedToken },
            body: JSON.stringify({ profile: { name: profileName.trim(), email: profileEmail.trim().toLowerCase() } }),
          });
        } catch {
          // profil zostanie dopełniony w webui, gdy host odpowie
        }
      }
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
      setScanLocked(false);
      return;
    }
    if (!payload.code) {
      // Bare URL QR, no pairing code — drop it into the manual form.
      setUrl(payload.url);
      setSegment("manual");
      setScanLocked(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await claimPairing(payload.url, payload.code, name.trim() || "My phone");
      await finish(payload.url, result.token);
    } catch (e) {
      // Trasy parowania (/api/pair/start, /api/pair/claim) już działają po
      // stronie serwera — nieudane claimowanie to zły/wygasły kod, nie brak
      // backendu. Cofamy do ręcznego wpisania tokena, zamiast zablokować przepływ.
      setUrl(payload.url);
      setError(e instanceof Error ? e.message : "Pairing failed");
      setSegment("manual");
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

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Add a host</Text>

      <View style={styles.segment}>
        <Pressable
          style={[styles.segmentButton, segment === "scan" && styles.segmentActive]}
          onPress={() => setSegment("scan")}
        >
          <Text style={[styles.segmentText, segment === "scan" && styles.segmentTextActive]}>Scan QR</Text>
        </Pressable>
        <Pressable
          style={[styles.segmentButton, segment === "manual" && styles.segmentActive]}
          onPress={() => setSegment("manual")}
        >
          <Text style={[styles.segmentText, segment === "manual" && styles.segmentTextActive]}>Manual</Text>
        </Pressable>
      </View>

      {segment === "scan" ? (
        <View style={styles.scanWrap}>
          {!permission ? (
            <ActivityIndicator color="#fcfcfc" />
          ) : !permission.granted ? (
            <View style={styles.scanPrompt}>
              <Text style={styles.dim}>MultiBot needs camera access to scan the pairing QR code.</Text>
              <Pressable style={styles.primaryButton} onPress={() => void requestPermission()}>
                <Text style={styles.primaryButtonText}>Grant camera access</Text>
              </Pressable>
            </View>
          ) : (
            <CameraView
              style={styles.camera}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={busy ? undefined : handleScan}
            />
          )}
          {busy && <ActivityIndicator style={styles.scanSpinner} color="#fcfcfc" />}
          <Pressable style={styles.linkButton} onPress={() => setSegment("manual")}>
            <Text style={styles.linkText}>Enter address &amp; token manually</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.manualWrap}>
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
        </View>
      )}

      <Text style={styles.label}>Device name</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} placeholderTextColor="#fcfcfc55" />

      {/* multibot: workspace #62 — profil użytkownika */}
      <Text style={styles.label}>Your name (shared workspace)</Text>
      <TextInput
        style={styles.input}
        value={profileName}
        onChangeText={setProfileName}
        placeholder="Jane Doe"
        placeholderTextColor="#fcfcfc55"
        autoCapitalize="words"
        autoCorrect={false}
      />
      <Text style={styles.label}>Your email (shared workspace)</Text>
      <TextInput
        style={styles.input}
        value={profileEmail}
        onChangeText={setProfileEmail}
        placeholder="jane@example.com"
        placeholderTextColor="#fcfcfc55"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
      />

      {error && <Text style={styles.error}>{error}</Text>}

      <Pressable
        style={[styles.primaryButton, busy && styles.primaryDisabled]}
        disabled={busy || !url.trim() || (segment === "manual" && !code.trim() && !token.trim())}
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
  title: { color: "#fcfcfc", fontSize: 24, fontWeight: "700", marginBottom: 8 },
  segment: { flexDirection: "row", backgroundColor: "#151515", borderRadius: 10, padding: 4 },
  segmentButton: { flex: 1, paddingVertical: 10, alignItems: "center", borderRadius: 8 },
  segmentActive: { backgroundColor: "#fcfcfc" },
  segmentText: { color: "#fcfcfc99", fontSize: 15, fontWeight: "600" },
  segmentTextActive: { color: "#070707" },
  scanWrap: { gap: 12 },
  scanPrompt: { gap: 12 },
  camera: { height: 260, borderRadius: 12, overflow: "hidden" },
  scanSpinner: { position: "absolute", top: 120, left: "50%", marginLeft: -10 },
  linkButton: { alignItems: "center" },
  linkText: { color: "#fcfcfc99", fontSize: 14 },
  manualWrap: { gap: 4 },
  dim: { color: "#fcfcfc99", fontSize: 15 },
  label: { color: "#fcfcfc99", fontSize: 13, marginTop: 8 },
  input: { color: "#fcfcfc", backgroundColor: "#151515", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  error: { color: "#ff8080", fontSize: 13, marginTop: 8 },
  primaryButton: { marginTop: 16, backgroundColor: "#fcfcfc", borderRadius: 10, paddingVertical: 14, alignItems: "center" },
  primaryDisabled: { opacity: 0.5 },
  primaryButtonText: { color: "#070707", fontSize: 16, fontWeight: "700" },
  cancelButton: { marginTop: 12, paddingVertical: 10, alignItems: "center" },
  cancelButtonText: { color: "#fcfcfc99", fontSize: 14 },
});
