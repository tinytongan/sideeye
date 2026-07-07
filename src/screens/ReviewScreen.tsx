import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { supabase } from "../lib/supabase";
import {
  categoriseAndLearn, categoriseOne, merchantSignature,
  undoCategorisation, type CategoriseAction,
} from "../lib/learn";
import { centsToAud, type Category } from "../lib/types";
import { MASCOTS, say, type SnarkLevel } from "../personality/copy";

interface QueueTxn {
  id: string;
  posted_at: string;
  description: string;
  amount_cents: number;
}

interface Toast {
  message: string;
  action: CategoriseAction | null; // present = undoable
}

export default function ReviewScreen({ snark = "wombat" as SnarkLevel }) {
  const [queue, setQueue] = useState<QueueTxn[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [selected, setSelected] = useState<Category | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [txnRes, catRes] = await Promise.all([
      supabase
        .from("transactions")
        .select("id, posted_at, description, amount_cents")
        .eq("needs_review", true)
        .order("amount_cents", { ascending: true })
        .limit(100),
      supabase.from("categories").select("*").order("sort"),
    ]);
    setQueue((txnRes.data ?? []) as QueueTxn[]);
    setCats((catRes.data ?? []) as Category[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const current = queue[0];

  const showToast = (t: Toast) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(t);
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  };

  const apply = async (scope: "one" | "all") => {
    if (!current || !selected || busy) return;
    setBusy(true);
    const action = scope === "one"
      ? await categoriseOne(current.id, selected.id)
      : await categoriseAndLearn(current.id, current.description, selected.id);
    const extra = action.clearedIds.length > 0 ? ` (+${action.clearedIds.length} similar)` : "";
    showToast({ message: `${selected.emoji ?? ""} ${selected.name}${extra}`, action });
    const removed = new Set([current.id, ...action.clearedIds]);
    setQueue((q) => q.filter((t) => !removed.has(t.id)));
    setSelected(null);
    setBusy(false);
  };

  const undo = async () => {
    if (!toast?.action) return;
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setBusy(true);
    await undoCategorisation(toast.action);
    setToast(null);
    await load(); // restore queue from source of truth
    setBusy(false);
  };

  const skip = () => { setSelected(null); setQueue((q) => [...q.slice(1), q[0]]); };

  if (loading) return <ActivityIndicator style={{ marginTop: 80 }} />;

  if (!current) {
    return (
      <View style={styles.doneWrap}>
        <Text style={styles.doneEmoji}>{MASCOTS[snark].emoji}</Text>
        <Text style={styles.doneText}>“{say("review_complete", snark)}”</Text>
        <Text style={styles.doneSub}>Queue empty. Nothing needs your eyes.</Text>
      </View>
    );
  }

  const isIncome = current.amount_cents > 0;
  const options = cats.filter((c) => (isIncome ? c.is_income : !c.is_income));
  const sig = merchantSignature(current.description);

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.counter}>{queue.length} to review</Text>

        <View style={styles.card}>
          <Text style={styles.date}>
            {new Date(current.posted_at).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}
          </Text>
          <Text style={styles.desc}>{current.description}</Text>
          <Text style={[styles.amount, isIncome && styles.income]}>
            {centsToAud(current.amount_cents)}
          </Text>
        </View>

        <Text style={styles.prompt}>What is this?</Text>
        <View style={styles.grid}>
          {options.map((c) => {
            const active = selected?.id === c.id;
            return (
              <Pressable
                key={c.id}
                onPress={() => setSelected(active ? null : c)}
                style={({ pressed }) => [
                  styles.chip,
                  active && styles.chipSelected,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.chipText, active && styles.chipTextSelected]}>
                  {c.emoji} {c.name}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Pressable style={({ pressed }) => [styles.skip, pressed && styles.pressed]} onPress={skip}>
          <Text style={styles.skipText}>Skip for now</Text>
        </Pressable>
        <View style={{ height: 120 }} />
      </ScrollView>

      {/* Scope chooser — appears once a category is picked */}
      {selected && (
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>
            {selected.emoji} {selected.name}
          </Text>
          <View style={styles.sheetRow}>
            <Pressable
              disabled={busy}
              onPress={() => apply("one")}
              style={({ pressed }) => [styles.sheetBtn, pressed && styles.pressed]}
            >
              <Text style={styles.sheetBtnText}>Just this one</Text>
            </Pressable>
            <Pressable
              disabled={busy}
              onPress={() => apply("all")}
              style={({ pressed }) => [styles.sheetBtn, styles.sheetBtnPrimary, pressed && styles.pressed]}
            >
              <Text style={styles.sheetBtnText}>
                All from {sig ?? "this merchant"}
              </Text>
            </Pressable>
          </View>
        </View>
      )}

      {toast && (
        <View style={styles.toast}>
          <Text style={styles.toastText}>{toast.message}</Text>
          {toast.action && (
            <Pressable onPress={undo} disabled={busy} style={({ pressed }) => [pressed && styles.pressed]}>
              <Text style={styles.undoText}>UNDO</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#14161f" },
  content: { padding: 20, paddingTop: 56 },
  counter: { color: "#8b90a5", textAlign: "center", fontSize: 13 },
  card: { backgroundColor: "#1c1f2e", borderRadius: 16, padding: 20, marginTop: 14, alignItems: "center" },
  date: { color: "#8b90a5", fontSize: 13 },
  desc: { color: "#fff", fontSize: 17, fontWeight: "600", textAlign: "center", marginTop: 8 },
  amount: { color: "#ff6b6b", fontSize: 30, fontWeight: "800", marginTop: 10 },
  income: { color: "#51cf66" },
  prompt: { color: "#fff", fontSize: 15, fontWeight: "700", marginTop: 24, marginBottom: 10 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { backgroundColor: "#232636", borderRadius: 18, paddingVertical: 8, paddingHorizontal: 12 },
  chipSelected: { backgroundColor: "#7c83ff" },
  chipText: { color: "#e8e9f0", fontSize: 13 },
  chipTextSelected: { color: "#fff", fontWeight: "700" },
  pressed: { opacity: 0.55, transform: [{ scale: 0.97 }] },
  skip: { alignSelf: "center", marginTop: 24, padding: 10 },
  skipText: { color: "#565b73", fontSize: 14 },
  sheet: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    backgroundColor: "#1c1f2e", borderTopLeftRadius: 18, borderTopRightRadius: 18,
    padding: 18, paddingBottom: 26,
    borderTopWidth: 1, borderTopColor: "#3d4260",
  },
  sheetTitle: { color: "#fff", fontSize: 15, fontWeight: "700", textAlign: "center", marginBottom: 12 },
  sheetRow: { flexDirection: "row", gap: 10 },
  sheetBtn: { flex: 1, backgroundColor: "#232636", borderRadius: 10, paddingVertical: 13, alignItems: "center" },
  sheetBtnPrimary: { backgroundColor: "#7c83ff" },
  sheetBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  toast: {
    position: "absolute", bottom: 24, alignSelf: "center",
    flexDirection: "row", alignItems: "center", gap: 16,
    backgroundColor: "#3d4260", borderRadius: 22, paddingVertical: 10, paddingHorizontal: 18,
  },
  toastText: { color: "#fff", fontSize: 13 },
  undoText: { color: "#ffd43b", fontSize: 13, fontWeight: "800" },
  doneWrap: { flex: 1, backgroundColor: "#14161f", alignItems: "center", justifyContent: "center", padding: 32 },
  doneEmoji: { fontSize: 64 },
  doneText: { color: "#e8e9f0", fontSize: 17, textAlign: "center", marginTop: 16, fontStyle: "italic" },
  doneSub: { color: "#565b73", marginTop: 8 },
});
