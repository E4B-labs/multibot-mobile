import { useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { type Host, formatLastUsed } from "../lib/host-logic";

interface Props {
  hosts: Host[];
  loading: boolean;
  onOpen: (host: Host) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onRename: (id: string, name: string) => void;
}

export default function HostListScreen({ hosts, loading, onOpen, onAdd, onRemove, onRename }: Props) {
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<Host | null>(null);
  const [renameValue, setRenameValue] = useState("");

  function startRename(host: Host) {
    setMenuFor(null);
    setRenaming(host);
    setRenameValue(host.name);
  }

  function commitRename() {
    if (renaming && renameValue.trim()) onRename(renaming.id, renameValue.trim());
    setRenaming(null);
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>MultiBot</Text>
      {loading ? (
        <Text style={styles.dim}>Loading hosts…</Text>
      ) : hosts.length === 0 ? (
        <Text style={styles.dim}>No hosts paired yet. Add one to get started.</Text>
      ) : (
        <FlatList
          data={hosts}
          keyExtractor={(h) => h.id}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Pressable style={styles.cardMain} onPress={() => onOpen(item)}>
                <Text style={styles.rowName}>{item.name}</Text>
                <Text style={styles.rowUrl}>{item.url}</Text>
                <Text style={styles.rowHint}>Last used: {formatLastUsed(item.lastUsedAt)}</Text>
              </Pressable>
              <Pressable style={styles.menuButton} onPress={() => setMenuFor(item.id)}>
                <Text style={styles.menuButtonText}>⋮</Text>
              </Pressable>
            </View>
          )}
        />
      )}
      <Pressable style={styles.addButton} onPress={onAdd}>
        <Text style={styles.addButtonText}>+ Add host</Text>
      </Pressable>

      <Modal visible={menuFor !== null} transparent animationType="fade" onRequestClose={() => setMenuFor(null)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setMenuFor(null)}>
          <View style={styles.sheet}>
            <Pressable
              style={styles.sheetRow}
              onPress={() => {
                const host = hosts.find((h) => h.id === menuFor);
                if (host) startRename(host);
              }}
            >
              <Text style={styles.sheetRowText}>Rename</Text>
            </Pressable>
            <Pressable
              style={[styles.sheetRow, styles.sheetDanger]}
              onPress={() => {
                if (menuFor) onRemove(menuFor);
                setMenuFor(null);
              }}
            >
              <Text style={[styles.sheetRowText, styles.sheetDangerText]}>Remove</Text>
            </Pressable>
            <Pressable style={styles.sheetCancel} onPress={() => setMenuFor(null)}>
              <Text style={styles.sheetCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={renaming !== null} transparent animationType="fade" onRequestClose={() => setRenaming(null)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setRenaming(null)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Rename host</Text>
            <TextInput
              style={styles.input}
              value={renameValue}
              onChangeText={setRenameValue}
              placeholder="Host name"
              placeholderTextColor="#fcfcfc55"
              autoFocus
            />
            <Pressable
              style={[styles.sheetRow, !renameValue.trim() && styles.sheetDisabled]}
              disabled={!renameValue.trim()}
              onPress={commitRename}
            >
              <Text style={styles.sheetRowText}>Save</Text>
            </Pressable>
            <Pressable style={styles.sheetCancel} onPress={() => setRenaming(null)}>
              <Text style={styles.sheetCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20 },
  title: { color: "#fcfcfc", fontSize: 28, fontWeight: "700", marginBottom: 16 },
  dim: { color: "#fcfcfc99", fontSize: 15 },
  card: {
    flexDirection: "row",
    alignItems: "stretch",
    backgroundColor: "#151515",
    borderRadius: 12,
    marginBottom: 10,
    overflow: "hidden",
  },
  cardMain: { flex: 1, paddingVertical: 14, paddingHorizontal: 16 },
  rowName: { color: "#fcfcfc", fontSize: 17, fontWeight: "600" },
  rowUrl: { color: "#fcfcfc99", fontSize: 13, marginTop: 2 },
  rowHint: { color: "#fcfcfc55", fontSize: 11, marginTop: 4 },
  menuButton: { paddingHorizontal: 16, justifyContent: "center" },
  menuButtonText: { color: "#fcfcfc99", fontSize: 22, fontWeight: "700" },
  addButton: { marginTop: 16, backgroundColor: "#fcfcfc", borderRadius: 10, paddingVertical: 14, alignItems: "center" },
  addButtonText: { color: "#070707", fontSize: 16, fontWeight: "700" },
  sheetBackdrop: { flex: 1, backgroundColor: "#000000aa", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#151515", padding: 12, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  sheetTitle: { color: "#fcfcfc", fontSize: 16, fontWeight: "700", padding: 8 },
  sheetRow: { paddingVertical: 14, alignItems: "center", borderRadius: 10, backgroundColor: "#1f1f1f", marginBottom: 8 },
  sheetRowText: { color: "#fcfcfc", fontSize: 16, fontWeight: "600" },
  sheetDanger: { backgroundColor: "#2a1515" },
  sheetDangerText: { color: "#ff8080" },
  sheetDisabled: { opacity: 0.4 },
  sheetCancel: { paddingVertical: 14, alignItems: "center" },
  sheetCancelText: { color: "#fcfcfc99", fontSize: 15 },
  input: { color: "#fcfcfc", backgroundColor: "#0f0f0f", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, marginBottom: 8 },
});
