import { useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { buildCsv, buildEofyPack, buildMarkdown, download, fetchExportData } from "../lib/exporter";

type Period = "month" | "3months" | "fy" | "all";
const PERIODS: { key: Period; label: string; hint: string }[] = [
  { key: "month", label: "This month", hint: "Current calendar month" },
  { key: "3months", label: "Last 3 months", hint: "Rolling 90 days" },
  { key: "fy", label: "This financial year", hint: "From 1 July" },
  { key: "all", label: "Everything", hint: "All imported history" },
];

function range(p: Period): { from: string; to: string } {
  const now = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const to = iso(new Date(now.getTime() + 86400000)); // tomorrow, exclusive
  if (p === "month") return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to };
  if (p === "3months") return { from: iso(new Date(now.getTime() - 90 * 86400000)), to };
  if (p === "fy") {
    const fyStart = now.getMonth() >= 6 ? new Date(now.getFullYear(), 6, 1) : new Date(now.getFullYear() - 1, 6, 1);
    return { from: iso(fyStart), to };
  }
  return { from: "2000-01-01", to };
}

export default function ExportScreen() {
  const [period, setPeriod] = useState<Period>("fy");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const run = async (format: "csv" | "md" | "copy") => {
    setBusy(true);
    setStatus(null);
    try {
      const { from, to } = range(period);
      const data = await fetchExportData(from, to);
      const stamp = new Date().toISOString().slice(0, 10);
      if (format === "csv") {
        download(`sideeye-${stamp}.csv`, buildCsv(data), "text/csv");
        setStatus(`CSV downloaded — ${data.txns.length} transactions.`);
      } else if (format === "md") {
        download(`sideeye-${stamp}.md`, buildMarkdown(data), "text/markdown");
        setStatus(`Markdown downloaded — ${data.txns.length} transactions.`);
      } else {
        if (Platform.OS === "web" && navigator.clipboard) {
          await navigator.clipboard.writeText(buildMarkdown(data));
          setStatus(`Copied to clipboard — paste straight into any AI chat.`);
        } else setStatus("Clipboard not available here.");
      }
    } catch (e) {
      setStatus("Export failed. Poke Claude about it.");
    }
    setBusy(false);
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Export</Text>
      <Text style={styles.sub}>
        CSV for spreadsheets. Markdown is structured for AI — paste it into any model and ask away.
      </Text>

      <Text style={styles.section}>Period</Text>
      {PERIODS.map((p) => (
        <Pressable key={p.key} onPress={() => setPeriod(p.key)}
          style={({ pressed }) => [styles.option, period === p.key && styles.optionActive, pressed && styles.pressed]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.optionLabel, period === p.key && styles.optionLabelActive]}>{p.label}</Text>
            <Text style={styles.optionHint}>{p.hint}</Text>
          </View>
          {period === p.key && <Text style={styles.tick}>✓</Text>}
        </Pressable>
      ))}

      <Text style={styles.section}>Format</Text>
      <View style={styles.btnRow}>
        <Pressable disabled={busy} onPress={() => run("csv")}
          style={({ pressed }) => [styles.btn, pressed && styles.pressed]}>
          <Text style={styles.btnText}>⬇ CSV</Text>
        </Pressable>
        <Pressable disabled={busy} onPress={() => run("md")}
          style={({ pressed }) => [styles.btn, pressed && styles.pressed]}>
          <Text style={styles.btnText}>⬇ Markdown</Text>
        </Pressable>
      </View>
      <Pressable disabled={busy} onPress={() => run("copy")}
        style={({ pressed }) => [styles.btn, styles.btnPrimary, pressed && styles.pressed]}>
        <Text style={styles.btnText}>📋 Copy Markdown for AI</Text>
      </Pressable>

      <Text style={styles.section}>Tax time</Text>
      <Pressable disabled={busy} onPress={async () => {
        setBusy(true); setStatus(null);
        try {
          const now = new Date();
          const fyEnd = now.getMonth() >= 6 ? now.getFullYear() + 1 : now.getFullYear();
          const { md, count } = await buildEofyPack(fyEnd);
          download(`sideeye-eofy-FY${fyEnd}.md`, md, "text/markdown");
          setStatus(`EOFY pack downloaded — ${count} tax-flagged transaction(s).`);
        } catch { setStatus("EOFY export failed. Poke Claude."); }
        setBusy(false);
      }} style={({ pressed }) => [styles.btn, styles.btnTax, pressed && styles.pressed]}>
        <Text style={styles.btnText}>🧾 EOFY deduction pack</Text>
      </Pressable>
      <Text style={styles.taxHint}>Current financial year's tax-flagged transactions, grouped by category with notes and receipt status — ready for your accountant or myTax.</Text>

      {busy && <ActivityIndicator style={{ marginTop: 20 }} />}
      {status && <Text style={styles.status}>{status}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#14161f" },
  content: { padding: 20, paddingTop: 56, paddingBottom: 48 },
  title: { color: "#fff", fontSize: 24, fontWeight: "800" },
  sub: { color: "#8b90a5", fontSize: 13, marginTop: 6 },
  section: { color: "#fff", fontSize: 15, fontWeight: "700", marginTop: 24, marginBottom: 8 },
  option: {
    flexDirection: "row", alignItems: "center", backgroundColor: "#1c1f2e",
    borderRadius: 12, padding: 14, marginBottom: 8,
  },
  optionActive: { borderWidth: 1, borderColor: "#7c83ff" },
  optionLabel: { color: "#e8e9f0", fontSize: 14, fontWeight: "600" },
  optionLabelActive: { color: "#fff" },
  optionHint: { color: "#565b73", fontSize: 12, marginTop: 2 },
  tick: { color: "#7c83ff", fontSize: 18, fontWeight: "800" },
  btnRow: { flexDirection: "row", gap: 10, marginBottom: 10 },
  btn: { flex: 1, backgroundColor: "#232636", borderRadius: 10, paddingVertical: 14, alignItems: "center" },
  btnPrimary: { backgroundColor: "#7c83ff" },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  pressed: { opacity: 0.55, transform: [{ scale: 0.97 }] },
  status: { color: "#51cf66", textAlign: "center", marginTop: 18, fontSize: 13 },
  btnTax: { backgroundColor: "#946b00" },
  taxHint: { color: "#565b73", fontSize: 11, marginTop: 8 },
});
