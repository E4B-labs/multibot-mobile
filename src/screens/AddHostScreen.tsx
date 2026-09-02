import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";

import { newHostId, normalizeHostUrl, type Host } from "../lib/host-logic";
import { saveHost } from "../lib/hosts";
import { claimPairing, pairingCredential, parseQrPayload } from "../lib/pair";

interface Props {
  initialUrl?: string;
  onDone: (host: Host) => void;
  onCancel: () => void;
}

type Step = "address" | "scan" | "pairing";

export default function AddHostScreen({ initialUrl, onDone, onCancel }: Props) {
  const [step, setStep] = useState<Step>("address");
  const [permission, requestPermission] = useCameraPermissions();
  const [scanLocked, setScanLocked] = useState(false);
  const [url, setUrl] = useState(initialUrl ?? "");
  const [code, setCode] = useState("");
  const [token, setToken] = useState("");
  const [name, setName] = useState("My phone");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function finish(rawUrl: string, tokenValue: string | null, authMode: "v2" | "legacy" | null = null) {
    const trimmedToken = tokenValue?.trim() ?? "";
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
      await saveHost(host, trimmedToken || null, authMode);
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
      // Bare URL QR, no pairing code — drop it into the address step.
      setUrl(payload.url);
      setStep("address");
      setScanLocked(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await claimPairing(payload.url, payload.code, name.trim() || "My phone");
      const credential = pairingCredential(result);
      await finish(payload.url, credential.token, credential.mode);
    } catch (e) {
      // Trasy parowania (/api/pair/start, /api/pair/claim) już działają po
      // stronie serwera — nieudane claimowanie to zły/wygasły kod, nie brak
      // backendu. Cofamy do ręcznego wpisania tokena, zamiast zablokować przepływ.
      setUrl(payload.url);
      setError(e instanceof Error ? e.message : "Pairing failed");
      setStep("pairing");
    } finally {
      setBusy(false);
      setScanLocked(false);
    }
  }

  async function handleContinue() {
    await finish(url, null);
  }

  async function handleConnect() {
    if (code.trim()) {
      setBusy(true);
      setError(null);
      try {
        const normalized = normalizeHostUrl(url);
        const result = await claimPairing(normalized, code.trim(), name.trim() || "My phone");
        const credential = pairingCredential(result);
        await finish(normalized, credential.token, credential.mode);
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
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      {step === "address" && (
        <View>
          <Text style={styles.eyebrow}>MULTIBOT / CONNECT</Text>
          <Text style={styles.title}>Connect to a host</Text>
          <Text style={styles.intro}>First enter the host address. The next step will ask for your profile and server password.</Text>
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
            autoFocus={!initialUrl}
          />
          {error && <Text style={styles.error}>{error}</Text>}
          <Pressable
            style={[styles.primaryButton, busy && styles.primaryDisabled]}
            disabled={busy || !url.trim()}
            onPress={() => void handleContinue()}
          >
            {busy ? <ActivityIndicator color="#070707" /> : <Text style={styles.primaryButtonText}>Continue</Text>}
          </Pressable>
          <Pressable style={styles.linkButton} onPress={() => setStep("scan")}>
            <Text style={styles.linkText}>Scan QR instead</Text>
          </Pressable>
          <Pressable style={styles.linkButton} onPress={() => setStep("pairing")}>
            <Text style={styles.linkText}>Use pairing code or access token</Text>
          </Pressable>
          <Pressable style={styles.cancelButton} onPress={onCancel}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </Pressable>
        </View>
      )}

      {step === "scan" ? (
        <View style={styles.scanWrap}>
          <Text style={styles.eyebrow}>MULTIBOT / CONNECT</Text>
          <Text style={styles.title}>Scan host QR</Text>
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
          <Pressable style={styles.linkButton} onPress={() => setStep("address")}>
            <Text style={styles.linkText}>Enter host address</Text>
          </Pressable>
          <Pressable style={styles.linkButton} onPress={() => setStep("pairing")}>
            <Text style={styles.linkText}>Use pairing code or access token</Text>
          </Pressable>
          <Pressable style={styles.cancelButton} onPress={onCancel}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </Pressable>
        </View>
      ) : step === "pairing" ? (
        <View style={styles.manualWrap}>
          <Text style={styles.eyebrow}>MULTIBOT / CONNECT</Text>
          <Text style={styles.title}>Pair with a host</Text>
          <Text style={styles.intro}>Use this only when the host showed you a QR code, pairing code, or access token.</Text>
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
          <Text style={styles.label}>Access token (optional)</Text>
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
          <Text style={styles.hint}>Leave the token empty to sign in inside the shared MultiBot screen.</Text>
          <Text style={styles.label}>Device name</Text>
          <TextInput style={styles.input} value={name} onChangeText={setName} placeholderTextColor="#fcfcfc55" />
          {error && <Text style={styles.error}>{error}</Text>}
          <Pressable
            style={[styles.primaryButton, busy && styles.primaryDisabled]}
            disabled={busy || !url.trim()}
            onPress={() => void handleConnect()}
          >
            {busy ? <ActivityIndicator color="#070707" /> : <Text style={styles.primaryButtonText}>Connect</Text>}
          </Pressable>
          <Pressable style={styles.linkButton} onPress={() => setStep("address")}>
            <Text style={styles.linkText}>Back to host address</Text>
          </Pressable>
        </View>
      ) : null}
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
  scanWrap: { gap: 12 },
  scanPrompt: { gap: 12 },
  camera: { height: 260, borderRadius: 12, overflow: "hidden" },
  scanSpinner: { position: "absolute", top: 120, left: "50%", marginLeft: -10 },
  linkButton: { alignItems: "center", justifyContent: "center", minHeight: 44 },
  linkText: { color: "#fcfcfc99", fontSize: 14 },
  manualWrap: { gap: 4 },
  dim: { color: "#fcfcfc99", fontSize: 15 },
  label: { color: "#fcfcfc99", fontSize: 13, marginTop: 8 },
  hint: { color: "#fcfcfc55", fontSize: 12, lineHeight: 17, marginTop: 1 },
  input: { color: "#fcfcfc", backgroundColor: "#151515", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  error: { color: "#ff8080", fontSize: 13, marginTop: 8 },
  primaryButton: { alignItems: "center", backgroundColor: "#fcfcfc", borderRadius: 10, marginTop: 16, minHeight: 44, justifyContent: "center", paddingHorizontal: 14 },
  primaryDisabled: { opacity: 0.5 },
  primaryButtonText: { color: "#070707", fontSize: 16, fontWeight: "700" },
  cancelButton: { alignItems: "center", justifyContent: "center", marginTop: 12, minHeight: 44 },
  cancelButtonText: { color: "#fcfcfc99", fontSize: 14 },
});
