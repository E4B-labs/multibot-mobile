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
  // TEKSTY WIĄŻĄCE (PLAN-UI.md U23, grupa E): aplikacja mobilna i onboarding
  // webowy muszą pokazywać dokładnie te same zdania. Zmiana tekstu = najpierw
  // PLAN-UI.md, potem kod. Przepisane co do znaku.
  const [serverHelp, setServerHelp] = useState(false);

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
        <View style={styles.onboard}>
          <Text style={styles.onboardIntro}>Zacznij od jednej z dwóch rzeczy.</Text>
          <Pressable style={styles.onboardButton} onPress={() => setServerHelp(true)}>
            <Text style={styles.onboardButtonTitle}>Postaw serwer</Text>
            <Text style={styles.onboardButtonHint}>To urządzenie będzie serwerem. Tutaj mieszkają boty i ich pamięć.</Text>
          </Pressable>
          <Pressable style={styles.onboardButton} onPress={onAdd}>
            <Text style={styles.onboardButtonTitle}>Zaloguj się do serwera</Text>
            <Text style={styles.onboardButtonHint}>Serwer już gdzieś stoi. To urządzenie tylko się do niego łączy.</Text>
          </Pressable>
        </View>
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

      <Modal visible={serverHelp} transparent animationType="fade" onRequestClose={() => setServerHelp(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setServerHelp(false)}>
          <View style={[styles.sheet, styles.helpSheet]}>
            <Text style={styles.sheetTitle}>Postaw serwer</Text>
            <Text style={styles.helpStep}>1. Uruchom MultiBota na komputerze albo telefonie, który ma być serwerem.</Text>
            <Text style={styles.helpStep}>
              2. W ustawieniach serwera wejdź w <Text style={styles.helpBold}>Połącz urządzenie</Text>. Pokaże kod QR.
            </Text>
            <Text style={styles.helpStep}>
              3. Wróć tutaj, wybierz <Text style={styles.helpBold}>Zaloguj się do serwera</Text> i zeskanuj ten kod.
            </Text>
            <Pressable style={styles.sheetCancel} onPress={() => setServerHelp(false)}>
              <Text style={styles.sheetCancelText}>Rozumiem</Text>
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
  onboard: { gap: 14, marginTop: 8 },
  onboardIntro: { color: "#fcfcfc99", fontSize: 15, lineHeight: 22 },
  onboardButton: {
    backgroundColor: "#151515",
    borderWidth: 1,
    borderColor: "#2a2a2a",
    borderRadius: 14,
    paddingVertical: 18,
    paddingHorizontal: 16,
  },
  onboardButtonTitle: { color: "#fcfcfc", fontSize: 18, fontWeight: "700" },
  onboardButtonHint: { color: "#fcfcfc99", fontSize: 13, marginTop: 4 },
  helpSheet: { borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  helpStep: { color: "#fcfcfc99", fontSize: 14, lineHeight: 21, marginBottom: 10 },
  helpBold: { color: "#fcfcfc", fontWeight: "700" },
});
