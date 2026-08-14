import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import type { Host } from "../lib/host-logic";

interface Props {
  hosts: Host[];
  loading: boolean;
  onOpen: (host: Host) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
}

export default function HostListScreen({ hosts, loading, onOpen, onAdd, onRemove }: Props) {
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
            <Pressable style={styles.row} onPress={() => onOpen(item)} onLongPress={() => onRemove(item.id)}>
              <Text style={styles.rowName}>{item.name}</Text>
              <Text style={styles.rowUrl}>{item.url}</Text>
              <Text style={styles.rowHint}>Tap to open · hold to remove</Text>
            </Pressable>
          )}
        />
      )}
      <Pressable style={styles.addButton} onPress={onAdd}>
        <Text style={styles.addButtonText}>+ Add host</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20 },
  title: { color: "#fcfcfc", fontSize: 28, fontWeight: "700", marginBottom: 16 },
  dim: { color: "#fcfcfc99", fontSize: 15 },
  row: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#1c1c1c" },
  rowName: { color: "#fcfcfc", fontSize: 17, fontWeight: "600" },
  rowUrl: { color: "#fcfcfc99", fontSize: 13, marginTop: 2 },
  rowHint: { color: "#fcfcfc55", fontSize: 11, marginTop: 4 },
  addButton: { marginTop: 16, backgroundColor: "#fcfcfc", borderRadius: 10, paddingVertical: 14, alignItems: "center" },
  addButtonText: { color: "#070707", fontSize: 16, fontWeight: "700" },
});
