// Last line of defence: a crash anywhere renders a recovery screen
// instead of a white void.
import { Component, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

interface State { error: Error | null }

export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View style={styles.wrap}>
        <Text style={styles.emoji}>🪨</Text>
        <Text style={styles.title}>Well. That broke.</Text>
        <Text style={styles.detail}>{String(this.state.error?.message ?? this.state.error)}</Text>
        <Pressable
          style={({ pressed }) => [styles.btn, pressed && { opacity: 0.6 }]}
          onPress={() => {
            this.setState({ error: null });
            if (typeof window !== "undefined") window.location.reload();
          }}
        >
          <Text style={styles.btnText}>Reload SideEye</Text>
        </Pressable>
        <Text style={styles.hint}>If this keeps happening, tell Claude what you tapped last.</Text>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "#14161f", alignItems: "center", justifyContent: "center", padding: 28 },
  emoji: { fontSize: 56 },
  title: { color: "#fff", fontSize: 22, fontWeight: "800", marginTop: 12 },
  detail: { color: "#8b90a5", fontSize: 12, marginTop: 10, textAlign: "center" },
  btn: { backgroundColor: "#7c83ff", borderRadius: 12, paddingVertical: 14, paddingHorizontal: 32, marginTop: 22 },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  hint: { color: "#565b73", fontSize: 12, marginTop: 14, textAlign: "center" },
});
