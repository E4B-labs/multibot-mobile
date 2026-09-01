import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { formatLastUsed, type Host } from "../lib/host-logic";

interface Props {
  hosts: Host[];
  activeHostId?: string;
  onAdd: () => void;
  onSelect: (host: Host) => void;
  onRename: (hostId: string, name: string) => Promise<void>;
  onRemove: (hostId: string) => Promise<void>;
}

export default function HostManagerScreen({ hosts, activeHostId, onAdd, onSelect, onRename, onRemove }: Props) {
  const [editing, setEditing] = useState<Host | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const startRename = (host: Host) => {
    setEditing(host);
    setName(host.name);
  };

  const saveRename = async () => {
    if (!editing || !name.trim() || busy) return;
    setBusy(true);
    try {
      await onRename(editing.id, name);
      setEditing(null);
    } catch (error) {
      Alert.alert("Couldn't rename host", error instanceof Error ? error.message : "Try again.");
    } finally {
      setBusy(false);
    }
  };

  const confirmRemove = (host: Host) => {
    Alert.alert(
      "Remove host?",
      `Remove ${host.name} from this phone? Its saved credential will also be deleted.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: () => void onRemove(host.id).catch((error: unknown) => Alert.alert("Couldn't remove host", error instanceof Error ? error.message : "Try again.")) },
      ],
    );
  };

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.headingRow}>
          <View style={styles.headingCopy}>
            <Text style={styles.eyebrow}>MULTIBOT</Text>
            <Text style={styles.title}>Your hosts</Text>
            <Text style={styles.subtitle}>The last host you use opens automatically next time.</Text>
          </View>
          <View style={styles.signal} />
        </View>

        <Pressable accessibilityRole="button" onPress={onAdd} style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}>
          <Text style={styles.addIcon}>＋</Text>
          <View>
            <Text style={styles.addTitle}>Add another host</Text>
            <Text style={styles.addSubtitle}>Scan a QR code or enter an address</Text>
          </View>
        </Pressable>

        <Text style={styles.sectionLabel}>{hosts.length ? "Saved hosts" : "No hosts yet"}</Text>
        {hosts.length ? hosts.map((host) => {
          const active = host.id === activeHostId;
          return (
            <View key={host.id} style={[styles.card, active && styles.cardActive]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open ${host.name}`}
                onPress={() => onSelect(host)}
                style={({ pressed }) => [styles.cardMain, pressed && styles.pressed]}
              >
                <View style={[styles.statusDot, active && styles.statusDotActive]} />
                <View style={styles.cardCopy}>
                  <View style={styles.nameRow}>
                    <Text style={styles.hostName} numberOfLines={1}>{host.name}</Text>
                    {active && <Text style={styles.activeLabel}>ACTIVE</Text>}
                  </View>
                  <Text style={styles.hostUrl} numberOfLines={1}>{host.url}</Text>
                  <Text style={styles.lastUsed}>Last used {formatLastUsed(host.lastUsedAt)}</Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
              <View style={styles.actions}>
                {!active && <Pressable accessibilityRole="button" onPress={() => onSelect(host)} style={styles.actionButton}><Text style={styles.actionText}>Use</Text></Pressable>}
                <Pressable accessibilityRole="button" onPress={() => startRename(host)} style={styles.actionButton}><Text style={styles.actionText}>Rename</Text></Pressable>
                <Pressable accessibilityRole="button" onPress={() => confirmRemove(host)} style={[styles.actionButton, styles.removeButton]}><Text style={styles.removeText}>Remove</Text></Pressable>
              </View>
            </View>
          );
        }) : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Connect your first host</Text>
            <Text style={styles.emptyBody}>Your bots and workspace stay on the host. This phone only keeps a secure connection to it.</Text>
          </View>
        )}
      </ScrollView>

      {editing && (
        <View style={styles.dialogBackdrop}>
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>Rename host</Text>
            <TextInput
              autoFocus
              value={name}
              onChangeText={setName}
              onSubmitEditing={() => void saveRename()}
              style={styles.input}
              placeholder="Host name"
              placeholderTextColor="#fcfcfc55"
              returnKeyType="done"
            />
            <View style={styles.dialogActions}>
              <Pressable accessibilityRole="button" onPress={() => setEditing(null)} style={styles.dialogSecondary}><Text style={styles.dialogSecondaryText}>Cancel</Text></Pressable>
              <Pressable accessibilityRole="button" disabled={!name.trim() || busy} onPress={() => void saveRename()} style={[styles.dialogPrimary, (!name.trim() || busy) && styles.disabled]}><Text style={styles.dialogPrimaryText}>Save</Text></Pressable>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#070707" },
  content: { padding: 20, paddingBottom: 36, gap: 12 },
  headingRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: 8 },
  headingCopy: { flex: 1, paddingRight: 16 },
  eyebrow: { color: "#38d591", fontSize: 11, fontWeight: "800", letterSpacing: 1.8 },
  title: { color: "#fcfcfc", fontSize: 30, fontWeight: "800", letterSpacing: -0.6, marginTop: 5 },
  subtitle: { color: "#fcfcfc99", fontSize: 14, lineHeight: 20, marginTop: 6 },
  signal: { backgroundColor: "#38d591", borderRadius: 99, height: 10, marginTop: 7, shadowColor: "#38d591", shadowOpacity: 0.7, shadowRadius: 10, width: 10 },
  addButton: { alignItems: "center", backgroundColor: "#38d591", borderRadius: 14, flexDirection: "row", minHeight: 64, paddingHorizontal: 16 },
  addIcon: { color: "#07110c", fontSize: 31, fontWeight: "300", marginRight: 12, marginTop: -2 },
  addTitle: { color: "#07110c", fontSize: 15, fontWeight: "800" },
  addSubtitle: { color: "#07110caa", fontSize: 12, marginTop: 3 },
  sectionLabel: { color: "#fcfcfc66", fontSize: 11, fontWeight: "700", letterSpacing: 1.3, marginTop: 15, textTransform: "uppercase" },
  card: { backgroundColor: "#111111", borderColor: "#252525", borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  cardActive: { borderColor: "#38d59188" },
  cardMain: { alignItems: "center", flexDirection: "row", minHeight: 82, paddingHorizontal: 14, paddingVertical: 13 },
  statusDot: { backgroundColor: "#3a3a3a", borderRadius: 99, height: 9, marginRight: 12, width: 9 },
  statusDotActive: { backgroundColor: "#38d591", shadowColor: "#38d591", shadowOpacity: 0.8, shadowRadius: 7 },
  cardCopy: { flex: 1, minWidth: 0 },
  nameRow: { alignItems: "center", flexDirection: "row", gap: 8 },
  hostName: { color: "#fcfcfc", flexShrink: 1, fontSize: 15, fontWeight: "700" },
  activeLabel: { color: "#38d591", fontSize: 9, fontWeight: "800", letterSpacing: 0.8 },
  hostUrl: { color: "#fcfcfc88", fontSize: 12, marginTop: 4 },
  lastUsed: { color: "#fcfcfc55", fontSize: 11, marginTop: 5 },
  chevron: { color: "#fcfcfc55", fontSize: 25, marginLeft: 8 },
  actions: { borderTopColor: "#202020", borderTopWidth: 1, flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: 10, paddingVertical: 6 },
  actionButton: { justifyContent: "center", minHeight: 38, paddingHorizontal: 11 },
  actionText: { color: "#fcfcfccc", fontSize: 12, fontWeight: "700" },
  removeButton: { marginLeft: 2 },
  removeText: { color: "#ff8989", fontSize: 12, fontWeight: "700" },
  emptyCard: { backgroundColor: "#111111", borderColor: "#202020", borderRadius: 14, borderWidth: 1, padding: 16 },
  emptyTitle: { color: "#fcfcfc", fontSize: 15, fontWeight: "700" },
  emptyBody: { color: "#fcfcfc88", fontSize: 13, lineHeight: 19, marginTop: 6 },
  dialogBackdrop: { ...StyleSheet.absoluteFillObject, alignItems: "center", backgroundColor: "#000000bb", justifyContent: "center", padding: 20 },
  dialog: { backgroundColor: "#171717", borderColor: "#303030", borderRadius: 16, borderWidth: 1, padding: 18, width: "100%" },
  dialogTitle: { color: "#fcfcfc", fontSize: 18, fontWeight: "800" },
  input: { backgroundColor: "#0d0d0d", borderColor: "#303030", borderRadius: 9, borderWidth: 1, color: "#fcfcfc", fontSize: 15, marginTop: 14, paddingHorizontal: 12, paddingVertical: 11 },
  dialogActions: { flexDirection: "row", gap: 9, marginTop: 14 },
  dialogSecondary: { alignItems: "center", backgroundColor: "#2a2a2a", borderRadius: 9, flex: 1, justifyContent: "center", minHeight: 46 },
  dialogSecondaryText: { color: "#fcfcfccc", fontSize: 14, fontWeight: "700" },
  dialogPrimary: { alignItems: "center", backgroundColor: "#38d591", borderRadius: 9, flex: 1, justifyContent: "center", minHeight: 46 },
  dialogPrimaryText: { color: "#07110c", fontSize: 14, fontWeight: "800" },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.8 },
});
