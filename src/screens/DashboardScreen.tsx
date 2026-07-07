import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { supabase } from "../lib/supabase";
import { centsToAud } from "../lib/types";
import { asSnark, MASCOTS, say, type SnarkLevel } from "../personality/copy";
import TransactionsModal from "./TransactionsModal";
import { assessOverdraftRisk, detectRecurring, type OverdraftRisk } from "../lib/recurring";
import ReviewFlowModal from "./ReviewFlowModal";
import { reviewDue } from "../lib/reviews";
import { enablePush, pushEnabled, pushSupported } from "../lib/push";

interface CatRow { id: string | "uncat"; name: string; emoji: string | null; total_cents: number }
interface MonthTotals { income: number; spend: number }
interface AcctInfo { id: string; name: string; kind: string; balance_cents: number | null }
interface MonthNet { label: string; perAccount: { name: string; kind: string; cents: number }[]; net: number }

const ACCT_COLORS: Record<string, string> = {
  savings: "#51cf66", transaction: "#7c83ff", credit: "#ff6b6b",
  loan: "#ff922b", super: "#ffd43b", investment: "#66d9e8", cash: "#e8e9f0",
};

const monthLabel = (d: Date) =>
  d.toLocaleDateString("en-AU", { month: "long", year: "numeric" });
const iso = (d: Date) => d.toISOString().slice(0, 10);

export default function DashboardScreen({ goSettings }: { goSettings?: () => void } = {}) {
  const [month, setMonth] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const [seg, setSeg] = useState<"income" | "spend" | null>(null);
  const [cats, setCats] = useState<CatRow[]>([]);
  const [totals, setTotals] = useState<MonthTotals>({ income: 0, spend: 0 });
  const [netWorth, setNetWorth] = useState<number | null>(null);
  const [monthNets, setMonthNets] = useState<MonthNet[]>([]);
  const [reviewCount, setReviewCount] = useState(0);
  const [snark, setSnark] = useState<SnarkLevel>("wombat");
  const [loading, setLoading] = useState(true);
  const [openCat, setOpenCat] = useState<CatRow | null>(null);
  const [openAll, setOpenAll] = useState(false);
  const [risks, setRisks] = useState<OverdraftRisk[]>([]);
  const [dueReview, setDueReview] = useState<"weekly" | "monthly" | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [alertsOn, setAlertsOn] = useState(() => pushEnabled());
  const [alertMsg, setAlertMsg] = useState<string | null>(null);
  const [pace, setPace] = useState<{ name: string; pctBudget: number } | null>(null);
  const [staleAccts, setStaleAccts] = useState<string[]>([]);

  const nextMonth = new Date(month.getFullYear(), month.getMonth() + 1, 1);

  const load = useCallback(async () => {
    setLoading(true);
    const from = iso(month);
    const to = iso(nextMonth);

    const [txnRes, acctRes, reviewRes, settingsRes, catRes, allTxnRes, sessRes, budRes] = await Promise.all([
      supabase
        .from("transactions")
        .select("amount_cents, category_id")
        .gte("posted_at", from).lt("posted_at", to),
      supabase.from("accounts").select("id, name, kind, balance_cents, balance_as_of, include_in_net_worth, source"),
      supabase
        .from("transactions")
        .select("id", { count: "exact", head: true })
        .eq("needs_review", true),
      supabase.from("settings").select("value").eq("key", "snark_level").maybeSingle(),
      supabase.from("categories").select("id, name, emoji, is_income"),
      supabase
        .from("transactions")
        .select("account_id, amount_cents, posted_at, description")
        .order("posted_at", { ascending: false })
        .limit(3000),
      supabase.from("review_sessions").select("kind, period_start").not("completed_at", "is", null),
      supabase.from("budgets").select("category_id, month, limit_cents").order("month", { ascending: false }),
    ]);

    const catById = new Map((catRes.data ?? []).map((c) => [c.id, c]));
    const transferIds = new Set(
      (catRes.data ?? []).filter((c) => ["Transfers", "Savings Contribution", "Loan Repayment"].includes(c.name)).map((c) => c.id)
    );

    let income = 0, spend = 0;
    const byCat = new Map<string, number>();
    for (const t of txnRes.data ?? []) {
      if (t.category_id && transferIds.has(t.category_id)) continue;
      if (t.amount_cents > 0) income += t.amount_cents;
      else {
        spend += -t.amount_cents;
        const key = t.category_id ?? "uncat";
        byCat.set(key, (byCat.get(key) ?? 0) + -t.amount_cents);
      }
    }
    const rows: CatRow[] = [...byCat.entries()]
      .map(([id, total_cents]) => ({
        id: id as string | "uncat",
        name: id === "uncat" ? "Uncategorised" : catById.get(id)?.name ?? "?",
        emoji: id === "uncat" ? "❓" : catById.get(id)?.emoji ?? null,
        total_cents,
      }))
      .sort((a, b) => b.total_cents - a.total_cents);

    // ── Budget pace: worst category vs its budget for the viewed month ──
    const latestBudget = new Map<string, number>();
    for (const b of budRes.data ?? []) {
      if (b.month <= from && !latestBudget.has(b.category_id)) latestBudget.set(b.category_id, b.limit_cents);
      if (b.month === from) latestBudget.set(b.category_id, b.limit_cents);
    }
    let worstPace: { name: string; pctBudget: number } | null = null;
    for (const [catId, spent] of byCat) {
      if (catId === "uncat") continue;
      const limit = latestBudget.get(catId);
      if (!limit || limit <= 0) continue;
      const pctBudget = Math.round((spent / limit) * 100);
      if (!worstPace || pctBudget > worstPace.pctBudget) {
        worstPace = { name: catById.get(catId)?.name ?? "?", pctBudget };
      }
    }
    setPace(worstPace);

    const accts = (acctRes.data ?? []) as (AcctInfo & { include_in_net_worth: boolean; source?: string })[];
    const nw = accts
      .filter((a) => a.include_in_net_worth && a.balance_cents !== null)
      .reduce((s, a) => s + (a.balance_cents ?? 0), 0);

    // ── Month-end net positions: balance_now − Σ(txns after month end) ──
    const nets: MonthNet[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const mEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 1); // exclusive
      const label = new Date(now.getFullYear(), now.getMonth() - i, 1)
        .toLocaleDateString("en-AU", { month: "short" });
      const endIso = iso(mEnd);
      const perAccount = accts
        .filter((a) => a.balance_cents !== null && a.include_in_net_worth)
        .map((a) => {
          const later = (allTxnRes.data ?? [])
            .filter((t) => t.account_id === a.id && t.posted_at >= endIso)
            .reduce((s, t) => s + t.amount_cents, 0);
          return { name: a.name, kind: a.kind, cents: (a.balance_cents ?? 0) - later };
        });
      nets.push({ label, perAccount, net: perAccount.reduce((s, p) => s + p.cents, 0) });
    }

    // ── Overdraft risk: recurring debits due in 7 days vs balances ──
    const riskList: OverdraftRisk[] = [];
    for (const a of accts) {
      if (a.kind !== "transaction" || a.balance_cents === null) continue;
      const mine = (allTxnRes.data ?? []).filter((t) => t.account_id === a.id);
      const rec = detectRecurring(mine as { posted_at: string; description: string; amount_cents: number }[]);
      const risk = assessOverdraftRisk(a.name, a.balance_cents, rec);
      if (risk) riskList.push(risk);
    }

    const done = (sessRes.data ?? []) as { kind: "weekly" | "monthly"; period_start: string }[];
    if (reviewDue("monthly", done.filter((d) => d.kind === "monthly"))) setDueReview("monthly");
    else if (reviewDue("weekly", done.filter((d) => d.kind === "weekly"))) setDueReview("weekly");
    else setDueReview(null);

    const ninetyAgo = new Date(Date.now() - 90 * 86400000).toISOString();
    setStaleAccts(
      accts
        .filter((a: any) => ["super", "investment"].includes(a.kind) && a.balance_as_of && a.balance_as_of < ninetyAgo)
        .map((a) => a.name)
    );

    setRisks(riskList);
    setTotals({ income, spend });
    setCats(rows);
    setNetWorth(nw);
    setMonthNets(nets);
    setReviewCount(reviewRes.count ?? 0);
    if (settingsRes.data?.value) setSnark(asSnark(settingsRes.data.value));
    setLoading(false);
  }, [month]);

  useEffect(() => { load(); }, [load]);

  const net = totals.income - totals.spend;

  const commentary = useMemo(() => {
    const now = new Date();
    const isCurrentMonth = month.getMonth() === now.getMonth() && month.getFullYear() === now.getFullYear();
    const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const pctMonth = isCurrentMonth ? Math.round((now.getDate() / daysInMonth) * 100) : 100;
    if (pace && pace.pctBudget >= 100) {
      return say("budget_blown", snark, { category: pace.name });
    }
    if (pace && pace.pctBudget > pctMonth) {
      return say("budget_pace_bad", snark, {
        category: pace.name, pct_month: pctMonth, pct_budget: pace.pctBudget,
      });
    }
    return say("greeting_morning", snark);
  }, [pace, snark, month]);

  const turnOnAlerts = async () => {
    const res = await enablePush();
    if (res.ok) { setAlertsOn(true); setAlertMsg("Alerts on. The Wombat is watching your balance."); }
    else setAlertMsg(res.reason ?? "Couldn't enable alerts.");
  };

  const maxCat = cats[0]?.total_cents ?? 1;
  const maxNet = Math.max(1, ...monthNets.map((m) => Math.abs(m.net)));
  const selNetIdx = monthNets.findIndex(
    (m) => m.label === month.toLocaleDateString("en-AU", { month: "short" })
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {/* Month selector */}
      <View style={styles.row}>
        <Pressable onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
          style={({ pressed }) => [pressed && styles.pressed]}>
          <Text style={styles.chev}>‹</Text>
        </Pressable>
        <Text style={styles.month}>{monthLabel(month)}</Text>
        <Pressable onPress={() => setMonth(nextMonth)} style={({ pressed }) => [pressed && styles.pressed]}>
          <Text style={styles.chev}>›</Text>
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} />
      ) : (
        <>
          {/* Net headline + segmented month bar */}
          <Text style={[styles.headline, net < 0 && styles.negative]}>
            {centsToAud(net)}
          </Text>
          <Text style={styles.netLabel}>net this month</Text>
          <View style={styles.segBar}>
            <Pressable
              onPress={() => setSeg(seg === "income" ? null : "income")}
              style={({ pressed }) => [
                styles.segIncome,
                { flex: Math.max(totals.income, 1) },
                seg === "income" && styles.segActive,
                pressed && styles.pressed,
              ]}
            />
            <Pressable
              onPress={() => setSeg(seg === "spend" ? null : "spend")}
              style={({ pressed }) => [
                styles.segSpend,
                { flex: Math.max(totals.spend, 1) },
                seg === "spend" && styles.segActive,
                pressed && styles.pressed,
              ]}
            />
          </View>
          {seg ? (
            <Text style={styles.segDetail}>
              {seg === "income" ? "🟢 In: " : "🔴 Spent: "}
              <Text style={styles.segDetailVal}>
                {centsToAud(seg === "income" ? totals.income : totals.spend)}
              </Text>
            </Text>
          ) : (
            <Text style={styles.segHint}>tap a segment for the split</Text>
          )}
          <Text style={styles.commentary}>
            {MASCOTS[snark].emoji} “{commentary}”
          </Text>

          {/* Overdraft warnings */}
          {risks.map((r) => (
            <View key={r.account_name} style={[styles.card, styles.riskCard]}>
              <Text style={styles.riskTitle}>
                ⚠️ {say("overdraft_warning", snark, {
                  balance: centsToAud(r.balance_cents),
                  upcoming: centsToAud(r.upcoming_cents),
                })}
              </Text>
              {r.items.map((i) => (
                <Text key={i.signature} style={styles.riskItem}>
                  {i.signature} · ~{centsToAud(i.avg_cents)} expected {new Date(i.next_date).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" })}
                </Text>
              ))}
              <Text style={styles.riskShortfall}>
                Shortfall if nothing moves: {centsToAud(r.shortfall_cents)}
              </Text>
            </View>
          ))}

          {/* Overdraft push alerts */}
          {pushSupported() && !alertsOn && (
            <Pressable onPress={turnOnAlerts}
              style={({ pressed }) => [styles.card, styles.alertCard, pressed && styles.pressed]}>
              <Text style={styles.alertTitle}>🔔 Enable overdraft alerts</Text>
              <Text style={styles.bankSub}>Get pushed a warning when recurring bills threaten to overdraw an account — even when the app is closed ›</Text>
              {alertMsg && <Text style={styles.bankMsg}>{alertMsg}</Text>}
            </Pressable>
          )}
          {alertsOn && alertMsg && (
            <View style={[styles.card, styles.alertCard]}>
              <Text style={styles.bankMsg}>{alertMsg}</Text>
            </View>
          )}

          {/* Stale super/investment balances */}
          {staleAccts.length > 0 && (
            <Pressable onPress={goSettings}
              style={({ pressed }) => [styles.card, styles.staleCard, pressed && styles.pressed]}>
              <Text style={styles.staleTitle}>🦺 Quarterly check-in</Text>
              <Text style={styles.bankSub}>
                {staleAccts.join(", ")} — balance{staleAccts.length > 1 ? "s" : ""} over 3 months old. Two minutes in More → update ›
              </Text>
            </Pressable>
          )}

          {/* Review due */}
          {dueReview && (
            <Pressable onPress={() => setReviewOpen(true)}
              style={({ pressed }) => [styles.card, styles.dueCard, pressed && styles.pressed]}>
              <Text style={styles.dueTitle}>
                {MASCOTS[snark].emoji} {dueReview === "weekly" ? "Weekly" : "Monthly"} review time
              </Text>
              <Text style={styles.dueSub}>“{say("review_prompt_weekly", snark)}” — 5 questions, 3 minutes ›</Text>
            </Pressable>
          )}

          {/* Month-end position for the selected month */}
          {selNetIdx >= 0 && (
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Position at end of {monthNets[selNetIdx].label}</Text>
              <Text style={styles.cardValue}>{centsToAud(monthNets[selNetIdx].net)}</Text>
              {monthNets[selNetIdx].perAccount.map((p) => (
                <View key={p.name} style={styles.acctRow}>
                  <View style={[styles.dot, { backgroundColor: ACCT_COLORS[p.kind] ?? "#e8e9f0" }]} />
                  <Text style={styles.acctName}>{p.name}</Text>
                  <Text style={[styles.acctVal, p.cents < 0 && styles.negative]}>{centsToAud(p.cents)}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Net position over time (running total) */}
          <Text style={styles.section}>Net position over time</Text>
          <Text style={styles.sectionHint}>your running total at the end of each month — small figures show the month's change</Text>
          <View style={styles.chart}>
            {monthNets.map((m, i) => (
              <View key={m.label} style={styles.chartCol}>
                <Text style={styles.chartVal}>{(Math.round(m.net / 10000) / 10).toFixed(1)}k</Text>
                <View style={styles.chartBarArea}>
                  <View style={[
                    styles.chartBar,
                    { height: Math.max(4, (Math.abs(m.net) / maxNet) * 90) },
                    m.net < 0 && { backgroundColor: "#ff6b6b" },
                  ]}>
                    {m.net >= 0 && m.perAccount.filter((p) => p.cents > 0).map((p) => (
                      <View key={p.name} style={{
                        flex: Math.max(0.0001, p.cents),
                        backgroundColor: ACCT_COLORS[p.kind] ?? "#e8e9f0",
                      }} />
                    ))}
                  </View>
                </View>
                <Text style={styles.chartLabel}>{m.label}</Text>
                {i > 0 ? (
                  <Text style={[
                    styles.chartDelta,
                    m.net - monthNets[i - 1].net >= 0 ? styles.deltaUp : styles.deltaDown,
                  ]}>
                    {m.net - monthNets[i - 1].net >= 0 ? "+" : "−"}
                    {(Math.round(Math.abs(m.net - monthNets[i - 1].net) / 10000) / 10).toFixed(1)}k
                  </Text>
                ) : (
                  <Text style={styles.chartDelta}> </Text>
                )}
              </View>
            ))}
          </View>
          <View style={styles.legend}>
            {monthNets[0]?.perAccount.map((p) => (
              <View key={p.name} style={styles.legendItem}>
                <View style={[styles.dot, { backgroundColor: ACCT_COLORS[p.kind] ?? "#e8e9f0" }]} />
                <Text style={styles.legendText}>{p.name}</Text>
              </View>
            ))}
          </View>

          {/* Net worth now */}
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Net worth today</Text>
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
          <Text style={styles.sectionHint}>tap a category, then a transaction — edit, tax-flag, attach receipts</Text>
          {cats.map((c) => (
            <Pressable key={c.name} onPress={() => setOpenCat(c)}
              style={({ pressed }) => [styles.catRow, pressed && styles.rowPressed]}>
              <Text style={styles.catEmoji}>{c.emoji ?? "·"}</Text>
              <View style={styles.catMid}>
                <Text style={styles.catName}>{c.name}</Text>
                <View style={[styles.bar, { width: `${Math.max(4, (c.total_cents / maxCat) * 100)}%` }]} />
              </View>
              <Text style={styles.catAmt}>{centsToAud(c.total_cents)}</Text>
            </Pressable>
          ))}
          <Pressable onPress={() => setOpenAll(true)}
            style={({ pressed }) => [styles.allBtn, pressed && styles.pressed]}>
            <Text style={styles.allBtnText}>All transactions ›</Text>
          </Pressable>

          <TransactionsModal
            visible={openCat !== null}
            onClose={() => { setOpenCat(null); load(); }}
            title={openCat ? `${openCat.emoji ?? ""} ${openCat.name} — ${monthLabel(month)}` : ""}
            categoryId={openCat?.id ?? null}
            from={iso(month)}
            to={iso(nextMonth)}
          />
          <ReviewFlowModal
            visible={reviewOpen}
            kind={dueReview ?? "weekly"}
            snark={snark}
            onClose={(completed) => { setReviewOpen(false); if (completed) load(); }}
          />
          <TransactionsModal
            visible={openAll}
            onClose={() => { setOpenAll(false); load(); }}
            title={`All transactions — ${monthLabel(month)}`}
            categoryId={null}
            from={iso(month)}
            to={iso(nextMonth)}
          />
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
  pressed: { opacity: 0.55, transform: [{ scale: 0.97 }] },
  headline: { color: "#51cf66", fontSize: 44, fontWeight: "800", textAlign: "center", marginTop: 20 },
  netLabel: { color: "#565b73", fontSize: 12, textAlign: "center", marginTop: 2 },
  segBar: { flexDirection: "row", height: 26, borderRadius: 13, overflow: "hidden", marginTop: 14, gap: 2 },
  segIncome: { backgroundColor: "#51cf66" },
  segSpend: { backgroundColor: "#ff6b6b" },
  segActive: { borderWidth: 2, borderColor: "#fff" },
  segDetail: { color: "#8b90a5", fontSize: 14, textAlign: "center", marginTop: 8 },
  segDetailVal: { color: "#fff", fontWeight: "800", fontSize: 16 },
  segHint: { color: "#565b73", fontSize: 12, textAlign: "center", marginTop: 8 },
  negative: { color: "#ff6b6b" },
  commentary: { color: "#8b90a5", fontSize: 14, textAlign: "center", marginTop: 8, fontStyle: "italic" },
  card: { backgroundColor: "#1c1f2e", borderRadius: 14, padding: 16, marginTop: 20 },
  reviewCard: { borderColor: "#7c83ff", borderWidth: 1 },
  riskCard: { borderColor: "#ff6b6b", borderWidth: 1 },
  riskTitle: { color: "#ff8787", fontSize: 14, fontWeight: "700", lineHeight: 20 },
  riskItem: { color: "#8b90a5", fontSize: 12, marginTop: 6 },
  riskShortfall: { color: "#ff6b6b", fontSize: 13, fontWeight: "800", marginTop: 8 },
  dueCard: { borderColor: "#ffd43b", borderWidth: 1 },
  dueTitle: { color: "#ffd43b", fontSize: 15, fontWeight: "800" },
  dueSub: { color: "#8b90a5", fontSize: 13, marginTop: 4, fontStyle: "italic" },
  alertCard: { borderColor: "#ffd43b", borderWidth: 1 },
  bankSub: { color: "#8b90a5", fontSize: 13, marginTop: 4 },
  bankMsg: { color: "#e8e9f0", fontSize: 13, marginTop: 8 },
  alertTitle: { color: "#ffd43b", fontSize: 15, fontWeight: "800" },
  staleCard: { borderColor: "#ffd43b", borderWidth: 1 },
  staleTitle: { color: "#ffd43b", fontSize: 15, fontWeight: "800" },
  cardLabel: { color: "#8b90a5", fontSize: 13 },
  cardValue: { color: "#fff", fontSize: 26, fontWeight: "700", marginTop: 4 },
  acctRow: { flexDirection: "row", alignItems: "center", marginTop: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  acctName: { color: "#e8e9f0", fontSize: 13, flex: 1 },
  acctVal: { color: "#8b90a5", fontSize: 13, fontVariant: ["tabular-nums"] },
  section: { color: "#fff", fontSize: 16, fontWeight: "700", marginTop: 28, marginBottom: 8 },
  sectionHint: { color: "#565b73", fontSize: 11, marginTop: -6, marginBottom: 8 },
  chart: { flexDirection: "row", alignItems: "flex-end", height: 130, gap: 6 },
  chartCol: { flex: 1, alignItems: "center", justifyContent: "flex-end" },
  chartVal: { color: "#8b90a5", fontSize: 10, marginBottom: 3 },
  chartBarArea: { justifyContent: "flex-end" },
  chartBar: { width: 26, borderRadius: 5, overflow: "hidden", backgroundColor: "#3d4260", flexDirection: "column" },
  chartLabel: { color: "#565b73", fontSize: 11, marginTop: 5 },
  chartDelta: { fontSize: 9, marginTop: 1 },
  deltaUp: { color: "#51cf66" },
  deltaDown: { color: "#ff8787" },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 10 },
  legendItem: { flexDirection: "row", alignItems: "center" },
  legendText: { color: "#8b90a5", fontSize: 12 },
  catRow: { flexDirection: "row", alignItems: "center", paddingVertical: 7 },
  catEmoji: { fontSize: 18, width: 30 },
  catMid: { flex: 1, marginRight: 10 },
  catName: { color: "#e8e9f0", fontSize: 14, marginBottom: 3 },
  bar: { height: 5, borderRadius: 3, backgroundColor: "#7c83ff" },
  catAmt: { color: "#8b90a5", fontSize: 13, fontVariant: ["tabular-nums"] },
  empty: { color: "#565b73", textAlign: "center", marginTop: 20 },
  rowPressed: { backgroundColor: "#1c1f2e", borderRadius: 8 },
  allBtn: { alignSelf: "center", marginTop: 14, padding: 10 },
  allBtnText: { color: "#7c83ff", fontSize: 14, fontWeight: "700" },
});
