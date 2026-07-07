import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { supabase } from "../lib/supabase";
import { centsToAud } from "../lib/types";
import { MASCOTS, say, type SnarkLevel } from "../personality/copy";

type Mode = "expense" | "income" | "net";

interface CatRow { name: string; emoji: string | null; total_cents: number }
interface MonthTotals { income: number; spend: number }

const monthLabel = (d: Date) =>
  d.toLocaleDateString("en-AU", { month: "long", year: "numeric" });
const iso = (d: Date) => d.toISOString().slice(0, 10);

export default function DashboardScreen() {
  const [month, setMonth] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const [mode, setMode] = useState<Mode>("expense");
  const [cats, setCats] = useState<CatRow[]>([]);
  const [totals, setTotals] = useState<MonthTotals>({ income: 0, spend: 0 });
  const [netWorth, setNetWorth] = useState<number | null>(null);
  const [reviewCount, setReviewCount] = useState(0);
  const [snark, setSnark] = useState<SnarkLevel>("wombat");
  const [loading, setLoading] = useState(true);

  const nextMonth = new Date(month.getFullYear(), month.getMonth() + 1, 1);

  const load = useCallback(async () => {
    setLoading(true);
    const from = iso(month);
    const to = iso(nextMonth);

    const [txnRes, acctRes, reviewRes, settingsRes, catRes] = await Promise.all([
      supabase
        .from("transactions")
        .select("amount_cents, category_id")
        .gte("posted_at", from).lt("posted_at", to),
      supabase.from("accounts").select("balance_cents, include_in_net_worth"),
      supabase
        .from("transactions")
        .select("id", { count: "exact", head: true })
        .eq("needs_review", true),
      supabase.from("settings").select("value").eq("key", "snark_level").maybeSingle(),
      supabase.from("categories").select("id, name, emoji, is_income"),
    ]);

    const catById = new Map((catRes.data ?? []).map((c) => [c.id, c]));
    const transferIds = new Set(
      (catRes.data ?? []).filter((c) => ["Transfers", "Savings Contribution", "Loan Repayment"].includes(c.name)).map((c) => c.id)
    );

    let income = 0, spend = 0;
    const byCat = new Map<string, number>();
    for (const t of txnRes.data ?? []) {
      if (t.category_id && transferIds.has(t.category_id)) continue; // own-money movement
      if (t.amount_cents > 0) income += t.amount_cents;
      else {
        spend += -t.amount_cents;
        const key = t.category_id ?? "uncat";
        byCat.set(key, (byCat.get(key) ?? 0) + -t.amount_cents);
      }
    }
    const rows: CatRow[] = [...byCat.entries()]
      .map(([id, total_cents]) => ({
        name: id === "uncat" ? "Uncategorised" : catById.get(id)?.name ?? "?",
        emoji: id === "uncat" ? "❓" : catById.get(id)?.emoji ?? null,
        total_cents,
      }))
      .sort((a, b) => b.total_cents - a.total_cents);

    const nw = (acctRes.data ?? [])
      .filter((a) => a.include_in_net_worth && a.balance_cents !== null)
      .reduce((s, a) => s + (a.balance_cents ?? 0), 0);

    setTotals({ income, spend });
    setCats(rows);
    setNetWorth(nw);
    setReviewCount(reviewRes.count ?? 0);
    if (settingsRes.data?.value) setSnark(settingsRes.data.value as SnarkLevel);
    setLoading(false);
  }, [month]);

  useEffect(() => { load(); }, [load]);

  const headline = useMemo(() => {
    if (mode === "income") return centsToAud(totals.income);
    if (mode === "expense") return centsToAud(totals.spend);
    return centsToAud(totals.income - totals.spend);
  }, [mode, totals]);

  const commentary = useMemo(() => {
    const worst = cats[0];
    if (!worst) return say("greeting_morning", snark);
    return say("budget_pace_bad", snark, {
      category: worst.name,
      pct_month: Math.round((new Date().getDate() / 30) * 100),
      pct_budget: 100, // placeholder until budgets (Phase 4) land
    });
  }, [cats, snark]);

  const maxCat = cats[0]?.total_cents ?? 1;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {/* Month selector */}
      <View style={styles.row}>
        <Pressable onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
          <Text style={styles.chev}>‹</Text>
        </Pressable>
        <Text style={styles.month}>{monthLabel(month)}</Text>
        <Pressable onPress={() => setMonth(nextMonth)}>
          <Text style={styles.chev}>›</Text>
        </Pressable>
      </View>

      {/* Mode toggle */}
      <View style={styles.toggle}>
        {(["expense", "income", "net"] as Mode[]).map((m) => (
          <Pressable key={m} onPress={() => setMode(m)} style={[styles.toggleBtn, mode === m && styles.toggleActive]}>
            <Text style={[styles.toggleText, mode === m && styles.toggleTextActive]}>
              {m === "expense" ? "Spent" : m === "income" ? "In" : "Net"}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} />
      ) : (
        <>
          <Text style={[styles.headline, mode === "net" && totals.income - totals.spend < 0 && styles.negative]}>
            {headline}
          </Text>
          <Text style={styles.commentary}>
            {MASCOTS[snark].emoji} “{commentary}”
          </Text>

          {/* Net worth */}
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Net worth</Text>
            <Text style={styles.cardValue}>{netWorth !== null ? centsToAud(netWorth) : "—"}</Text>
          </View>

          {/* Review queue nudge */}
          {reviewCount > 0 && (
            <View style={[styles.card, styles.reviewCard]}>
              <Text style={styles.cardLabel}>
                {say("categorise_queue", snark, { count: reviewCount })}
              </Text>
            </View>
          )}

          {/* Category breakdown */}
          <Text style={styles.section}>Where it went</Text>
          {cats.map((c) => (
            <View key={c.name} style={styles.catRow}>
              <Text style={styles.catEmoji}>{c.emoji ?? "·"}</Text>
              <View style={styles.catMid}>
                <Text style={styles.catName}>{c.name}</Text>
                <View style={[styles.bar, { width: `${Math.max(4, (c.total_cents / maxCat) * 100)}%` }]} />
              </View>
              <Text style={styles.catAmt}>{centsToAud(c.total_cents)}</Text>
            </View>
          ))}
          {cats.length === 0 && <Text style={styles.empty}>No spending this month. Suspicious.</Text>}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#14161f" },
  content: { padding: 20, paddingTop: 56, paddingBottom: 48 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  chev: { color: "#7c83ff", fontSize: 32, paddingHorizontal: 16 },
  month: { color: "#fff", fontSize: 20, fontWeight: "700" },
  toggle: { flexDirection: "row", backgroundColor: "#232636", borderRadius: 10, marginTop: 16, padding: 4 },
  toggleBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center" },
  toggleActive: { backgroundColor: "#3d4260" },
  toggleText: { color: "#8b90a5", fontWeight: "600" },
  toggleTextActive: { color: "#fff" },
  headline: { color: "#fff", fontSize: 44, fontWeight: "800", textAlign: "center", marginTop: 24 },
  negative: { color: "#ff6b6b" },
  commentary: { color: "#8b90a5", fontSize: 14, textAlign: "center", marginTop: 8, fontStyle: "italic" },
  card: { backgroundColor: "#1c1f2e", borderRadius: 14, padding: 16, marginTop: 20 },
  reviewCard: { borderColor: "#7c83ff", borderWidth: 1 },
  cardLabel: { color: "#8b90a5", fontSize: 13 },
  cardValue: { color: "#fff", fontSize: 26, fontWeight: "700", marginTop: 4 },
  section: { color: "#fff", fontSize: 16, fontWeight: "700", marginTop: 28, marginBottom: 8 },
  catRow: { flexDirection: "row", alignItems: "center", paddingVertical: 7 },
  catEmoji: { fontSize: 18, width: 30 },
  catMid: { flex: 1, marginRight: 10 },
  catName: { color: "#e8e9f0", fontSize: 14, marginBottom: 3 },
  bar: { height: 5, borderRadius: 3, backgroundColor: "#7c83ff" },
  catAmt: { color: "#8b90a5", fontSize: 13, fontVariant: ["tabular-nums"] },
  empty: { color: "#565b73", textAlign: "center", marginTop: 20 },
});
