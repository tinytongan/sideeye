import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { supabase } from "../lib/supabase";
import { centsToAud, type Category } from "../lib/types";

type Period = "wk" | "fn" | "mo";
const PERIOD_FACTOR: Record<Period, number> = { wk: 52 / 12, fn: 26 / 12, mo: 1 };
const PERIOD_LABEL: Record<Period, string> = { wk: "/wk", fn: "/fn", mo: "/mo" };

interface Row {
  cat: Category;
  spent_month_cents: number; // this calendar month
  avg_month_cents: number; // 6-month average actual spend
  budget_cents: number | null; // current monthly budget
  draft: string;
  period: Period;
}

const EXCLUDED = new Set(["Transfers", "Savings Contribution", "Loan Repayment", "Uncategorised"]);
const monthStart = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-01`;
};

export default function BudgetScreen() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [newEmoji, setNewEmoji] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const since = new Date();
    since.setMonth(since.getMonth() - 6);
    const mStart = monthStart();
    const [catRes, txnRes, budRes] = await Promise.all([
      supabase.from("categories").select("*").eq("is_income", false).order("sort"),
      supabase
        .from("transactions")
        .select("category_id, amount_cents, posted_at")
        .lt("amount_cents", 0)
        .gte("posted_at", since.toISOString().slice(0, 10)),
      supabase.from("budgets").select("category_id, limit_cents, month").order("month", { ascending: false }),
    ]);
    const spend = new Map<string, number>();
    const monthSpend = new Map<string, number>();
    for (const t of txnRes.data ?? []) {
      if (!t.category_id) continue;
      spend.set(t.category_id, (spend.get(t.category_id) ?? 0) + -t.amount_cents);
      if ((t as { posted_at?: string }).posted_at && (t as { posted_at: string }).posted_at >= mStart) {
        monthSpend.set(t.category_id, (monthSpend.get(t.category_id) ?? 0) + -t.amount_cents);
      }
    }
    // latest budget per category (any month ≤ now acts as the template)
    const latestBudget = new Map<string, number>();
    for (const b of budRes.data ?? []) {
      if (!latestBudget.has(b.category_id)) latestBudget.set(b.category_id, b.limit_cents);
    }
    const rs: Row[] = (catRes.data ?? [])
      .filter((c) => !EXCLUDED.has(c.name))
      .map((c) => {
        const budget = latestBudget.get(c.id) ?? null;
        return {
          cat: c as Category,
          spent_month_cents: monthSpend.get(c.id) ?? 0,
          avg_month_cents: Math.round((spend.get(c.id) ?? 0) / 6),
          budget_cents: budget,
          draft: budget !== null ? String(budget / 100) : "",
          period: "mo" as Period,
        };
      })
      .sort((a, b) => b.avg_month_cents - a.avg_month_cents);
    setRows(rs);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async (r: Row) => {
    const raw = Number(r.draft.replace(/[$,\s]/g, ""));
    if (!Number.isFinite(raw) || raw <= 0) return;
    const monthly = Math.round(raw * 100 * PERIOD_FACTOR[r.period]);
    await supabase
      .from("budgets")
      .upsert({ category_id: r.cat.id, month: monthStart(), limit_cents: monthly }, { onConflict: "category_id,month" });
    setRows((rs) => rs.map((x) => (x.cat.id === r.cat.id ? { ...x, budget_cents: monthly, period: "mo", draft: String(monthly / 100) } : x)));
  };

  const cyclePeriod = (r: Row) => {
    const next: Period = r.period === "mo" ? "wk" : r.period === "wk" ? "fn" : "mo";
    setRows((rs) => rs.map((x) => (x.cat.id === r.cat.id ? { ...x, period: next } : x)));
  };

  const addCategory = async () => {
    const name = newName.trim();
    if (!name) return;
    const { data } = await supabase
      .from("categories")
      .insert({ name, emoji: newEmoji.trim() || "🏷️", sort: 80 })
      .select("*").single();
    if (data) {
      setRows((rs) => [...rs, { cat: data as Category, spent_month_cents: 0, avg_month_cents: 0, budget_cents: null, draft: "", period: "mo" }]);
      setNewName(""); setNewEmoji("");
    }
  };

  if (loading) return <ActivityIndicator style={{ marginTop: 80 }} />;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Budgets</Text>
      <Text style={styles.sub}>Monthly envelopes. Type an amount, tap /mo to switch to /wk or /fn — it converts on save.</Text>

      {rows.map((r) => (
        <View key={r.cat.id} style={styles.row}>
          <Text style={styles.emoji}>{r.cat.emoji}</Text>
          <View style={styles.mid}>
            <Text style={styles.name}>{r.cat.name}</Text>
            <Text style={styles.avg}>
              {r.avg_month_cents > 0 ? `averaging ${centsToAud(r.avg_month_cents)}/mo` : "no recent spending"}
            </Text>
            {r.budget_cents !== null && r.budget_cents > 0 && (
              <View style={styles.paceWrap}>
                <View style={[
                  styles.paceBar,
                  { width: `${Math.min(100, (r.spent_month_cents / r.budget_cents) * 100)}%` },
                  r.spent_month_cents > r.budget_cents && styles.paceOver,
                ]} />
                <Text style={[styles.paceText, r.spent_month_cents > r.budget_cents && styles.paceTextOver]}>
                  {centsToAud(r.spent_month_cents)} of {centsToAud(r.budget_cents)}
                </Text>
              </View>
            )}
          </View>
          <TextInput
            style={styles.input}
            value={r.draft}
            placeholder="—"
            placeholderTextColor="#565b73"
            keyboardType="numeric"
            onChangeText={(v) => setRows((rs) => rs.map((x) => (x.cat.id === r.cat.id ? { ...x, draft: v } : x)))}
            onBlur={() => save(r)}
          />
          <Pressable onPress={() => cyclePeriod(r)}>
            <Text style={styles.period}>{PERIOD_LABEL[r.period]}</Text>
          </Pressable>
        </View>
      ))}

      <Text style={styles.section}>Add a category</Text>
      <View style={styles.addRow}>
        <TextInput
          style={[styles.input, styles.emojiInput]} value={newEmoji} placeholder="🏷️"
          placeholderTextColor="#565b73" onChangeText={setNewEmoji}
        />
        <TextInput
          style={[styles.input, styles.nameInput]} value={newName} placeholder="Category name"
          placeholderTextColor="#565b73" onChangeText={setNewName}
        />
        <Pressable style={styles.addBtn} onPress={addCategory}>
          <Text style={styles.addBtnText}>Add</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#14161f" },
  content: { padding: 20, paddingTop: 56, paddingBottom: 64 },
  title: { color: "#fff", fontSize: 24, fontWeight: "800" },
  sub: { color: "#8b90a5", fontSize: 13, marginTop: 6, marginBottom: 18 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#232636" },
  emoji: { fontSize: 18, width: 30 },
  mid: { flex: 1 },
  name: { color: "#e8e9f0", fontSize: 14, fontWeight: "600" },
  avg: { color: "#565b73", fontSize: 12, marginTop: 1 },
  paceWrap: { marginTop: 4 },
  paceBar: { height: 4, borderRadius: 2, backgroundColor: "#51cf66" },
  paceOver: { backgroundColor: "#ff6b6b" },
  paceText: { color: "#565b73", fontSize: 10, marginTop: 2 },
  paceTextOver: { color: "#ff8787" },
  input: { backgroundColor: "#1c1f2e", borderRadius: 8, color: "#fff", paddingVertical: 6, paddingHorizontal: 10, minWidth: 76, textAlign: "right", fontSize: 14 },
  period: { color: "#7c83ff", fontSize: 13, fontWeight: "700", marginLeft: 8, width: 34 },
  section: { color: "#fff", fontSize: 16, fontWeight: "700", marginTop: 28, marginBottom: 10 },
  addRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  emojiInput: { minWidth: 52, textAlign: "center" },
  nameInput: { flex: 1, textAlign: "left" },
  addBtn: { backgroundColor: "#3d4260", borderRadius: 8, paddingVertical: 9, paddingHorizontal: 16 },
  addBtnText: { color: "#fff", fontWeight: "700" },
});
