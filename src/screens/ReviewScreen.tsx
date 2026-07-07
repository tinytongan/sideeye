import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { supabase } from "../lib/supabase";
import { categoriseAndLearn } from "../lib/learn";
import { centsToAud, type Category } from "../lib/types";
import { MASCOTS, say, type SnarkLevel } from "../personality/copy";

interface QueueTxn {
  id: string;
  posted_at: string;
  description: string;
  amount_cents: number;
}

export default function ReviewScreen({ snark = "wombat" as SnarkLevel }) {
  const [queue, setQueue] = useState<QueueTxn[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [txnRes, catRes] = await Promise.all([
      supabase
        .from("transactions")
        .select("id, posted_at, description, amount_cents")
        .eq("needs_review", true)
        .order("amount_cents", { ascending: true }) // biggest spends first
        .limit(100),
      supabase.from("categories").select("*").order("sort"),
    ]);
    setQueue((txnRes.data ?? []) as QueueTxn[]);
    setCats((catRes.data ?? []) as Category[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const current = queue[0];

  const choose = async (cat: Category) => {
    if (!current) return;
    const cleared = await categoriseAndLearn(current.id, current.description, cat.id);
    const others = cleared > 0 ? ` +${cleared} similar cleared` : "";
    setToast(`${cat.emoji ?? ""} ${cat.name}${others}`);
    setTimeout(() => setToast(null), 2000);
    setQueue((q) => q.filter((t) => t.id !== current.id && !(cleared > 0 && false)));
    if (cleared > 0) load(); // refresh — the rule may have cleared queued items
  };

  const skip = () => setQueue((q) => [...q.slice(1), q[0]]);

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

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
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
        {options.map((c) => (
          <Pressable key={c.id} style={styles.chip} onPress={() => choose(c)}>
            <Text style={styles.chipText}>{c.emoji} {c.name}</Text>
          </Pressable>
        ))}
      </View>

      <Pressable style={styles.skip} onPress={skip}>
        <Text style={styles.skipText}>Skip for now</Text>
      </Pressable>

      {toast && (
        <View style={styles.toast}><Text style={styles.toastText}>{toast}</Text></View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#14161f" },
  content: { padding: 20, paddingTop: 56, paddingBottom: 48 },
  counter: { color: "#8b90a5", textAlign: "center", fontSize: 13 },
  card: { backgroundColor: "#1c1f2e", borderRadius: 16, padding: 20, marginTop: 14, alignItems: "center" },
  date: { color: "#8b90a5", fontSize: 13 },
  desc: { color: "#fff", fontSize: 17, fontWeight: "600", textAlign: "center", marginTop: 8 },
  amount: { color: "#ff6b6b", fontSize: 30, fontWeight: "800", marginTop: 10 },
  income: { color: "#51cf66" },
  prompt: { color: "#fff", fontSize: 15, fontWeight: "700", marginTop: 24, marginBottom: 10 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { backgroundColor: "#232636", borderRadius: 18, paddingVertical: 8, paddingHorizontal: 12 },
  chipText: { color: "#e8e9f0", fontSize: 13 },
  skip: { alignSelf: "center", marginTop: 24, padding: 10 },
  skipText: { color: "#565b73", fontSize: 14 },
  toast: { position: "absolute", bottom: 30, alignSelf: "center", backgroundColor: "#3d4260", borderRadius: 20, paddingVertical: 8, paddingHorizontal: 16 },
  toastText: { color: "#fff", fontSize: 13 },
  doneWrap: { flex: 1, backgroundColor: "#14161f", alignItems: "center", justifyContent: "center", padding: 32 },
  doneEmoji: { fontSize: 64 },
  doneText: { color: "#e8e9f0", fontSize: 17, textAlign: "center", marginTop: 16, fontStyle: "italic" },
  doneSub: { color: "#565b73", marginTop: 8 },
});
