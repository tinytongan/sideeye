// Weekly/monthly review engine: period stats, question generation,
// rule-based saving recommendations, streaks.
import { supabase } from "./supabase";
import { centsToAud } from "./types";

export interface PeriodStats {
  from: string; to: string;
  spend_cents: number;
  income_cents: number;
  prev_spend_cents: number;
  top_categories: { name: string; emoji: string | null; cents: number }[];
  biggest: { description: string; cents: number } | null;
  no_spend_days: number;
  overdrawn_fees: number;
  subscription_cents: number;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const DAY = 86400000;

export function currentPeriod(kind: "weekly" | "monthly"): { from: string; to: string } {
  const now = new Date();
  if (kind === "weekly") {
    // the 7 days ending yesterday
    return { from: iso(new Date(now.getTime() - 7 * DAY)), to: iso(now) };
  }
  // previous calendar month
  const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const next = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: iso(first), to: iso(next) };
}

export function reviewDue(kind: "weekly" | "monthly", completed: { period_start: string }[]): boolean {
  const { from } = currentPeriod(kind);
  if (kind === "monthly") {
    // only prompt in the first 7 days of a new month
    if (new Date().getDate() > 7) return false;
  }
  return !completed.some((c) => c.period_start === from);
}

export async function fetchPeriodStats(from: string, to: string): Promise<PeriodStats> {
  const prevFrom = iso(new Date(new Date(from).getTime() - (new Date(to).getTime() - new Date(from).getTime())));
  const [txnRes, prevRes, catRes] = await Promise.all([
    supabase.from("transactions")
      .select("posted_at, description, amount_cents, category_id")
      .gte("posted_at", from).lt("posted_at", to),
    supabase.from("transactions")
      .select("amount_cents, category_id")
      .gte("posted_at", prevFrom).lt("posted_at", from),
    supabase.from("categories").select("id, name, emoji"),
  ]);
  const cat = new Map((catRes.data ?? []).map((c) => [c.id, c]));
  const transferIds = new Set((catRes.data ?? [])
    .filter((c) => ["Transfers", "Savings Contribution", "Loan Repayment"].includes(c.name)).map((c) => c.id));
  const subId = (catRes.data ?? []).find((c) => c.name === "Subscriptions")?.id;

  const txns = (txnRes.data ?? []).filter((t) => !(t.category_id && transferIds.has(t.category_id)));
  const spendTxns = txns.filter((t) => t.amount_cents < 0);

  const byCat = new Map<string, number>();
  for (const t of spendTxns) {
    const key = t.category_id ?? "uncat";
    byCat.set(key, (byCat.get(key) ?? 0) + -t.amount_cents);
  }
  const top = [...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([id, cents]) => ({
      name: id === "uncat" ? "Uncategorised" : cat.get(id)?.name ?? "?",
      emoji: id === "uncat" ? "❓" : cat.get(id)?.emoji ?? null,
      cents,
    }));

  const biggestTxn = spendTxns.sort((a, b) => a.amount_cents - b.amount_cents)[0];
  const spendDays = new Set(spendTxns.map((t) => t.posted_at));
  const totalDays = Math.round((new Date(to).getTime() - new Date(from).getTime()) / DAY);

  return {
    from, to,
    spend_cents: spendTxns.reduce((s, t) => s + -t.amount_cents, 0),
    income_cents: txns.filter((t) => t.amount_cents > 0).reduce((s, t) => s + t.amount_cents, 0),
    prev_spend_cents: (prevRes.data ?? [])
      .filter((t) => t.amount_cents < 0 && !(t.category_id && transferIds.has(t.category_id)))
      .reduce((s, t) => s + -t.amount_cents, 0),
    top_categories: top,
    biggest: biggestTxn ? { description: biggestTxn.description, cents: -biggestTxn.amount_cents } : null,
    no_spend_days: Math.max(0, totalDays - spendDays.size),
    overdrawn_fees: (txnRes.data ?? []).filter((t) => /OVERDRAWN/i.test(t.description)).length,
    subscription_cents: subId ? (byCat.get(subId) ?? 0) : 0,
  };
}

export interface ReviewQuestion { id: string; question: string; context?: string }

export function buildQuestions(s: PeriodStats, kind: "weekly" | "monthly"): ReviewQuestion[] {
  const qs: ReviewQuestion[] = [];
  const delta = s.spend_cents - s.prev_spend_cents;
  qs.push({
    id: "surprise",
    question: "Looking at this period, what surprised you most about your spending?",
    context: `You spent ${centsToAud(s.spend_cents)} (${delta >= 0 ? "up" : "down"} ${centsToAud(Math.abs(delta))} on the period before).`,
  });
  if (s.top_categories[0]) {
    qs.push({
      id: "top_category",
      question: `${s.top_categories[0].emoji ?? ""} ${s.top_categories[0].name} was your biggest category at ${centsToAud(s.top_categories[0].cents)}. What drove that — and was it worth it?`,
    });
  }
  if (s.biggest) {
    qs.push({
      id: "biggest",
      question: `Your single biggest spend was "${s.biggest.description}" at ${centsToAud(s.biggest.cents)}. Planned or impulse?`,
    });
  }
  qs.push({
    id: "why",
    question: "When you spent on non-essentials, what was usually going on? (bored, social, stressed, celebrating, habit?)",
  });
  qs.push({
    id: "differently",
    question: kind === "weekly"
      ? "What's one thing you'll do differently next week?"
      : "What's one thing you'll change for the month ahead?",
  });
  return qs;
}

export function buildRecommendations(s: PeriodStats): string[] {
  const recs: string[] = [];
  if (s.overdrawn_fees > 0) {
    recs.push(`You paid ${s.overdrawn_fees} overdrawn fee(s). A small automatic buffer transfer the day after payday would make those extinct.`);
  }
  if (s.subscription_cents > 5000) {
    recs.push(`Subscriptions ran ${centsToAud(s.subscription_cents)} this period. Ten minutes cancelling the ones you forgot about is the easiest money you'll ever save.`);
  }
  const delta = s.spend_cents - s.prev_spend_cents;
  if (delta > 0 && s.top_categories[0]) {
    recs.push(`Spending rose ${centsToAud(delta)} vs the previous period, led by ${s.top_categories[0].name}. Setting a budget for it in the Budgets tab puts a wombat on guard duty.`);
  }
  if (s.no_spend_days >= 2) {
    recs.push(`${s.no_spend_days} no-spend days this period. Whatever you did those days — do more of that.`);
  }
  if (recs.length === 0) {
    recs.push("Steady period. Keep the savings transfer automatic and let compounding do its thing.");
  }
  return recs.slice(0, 2);
}

export async function saveReview(
  kind: "weekly" | "monthly",
  from: string, to: string,
  answers: { question_id: string; question: string; answer: string }[],
  recommendations: string[]
): Promise<void> {
  await supabase.from("review_sessions").upsert({
    kind, period_start: from, period_end: to,
    completed_at: new Date().toISOString(),
    answers, recommendations,
  }, { onConflict: "kind,period_start" });

  // streak
  const id = `${kind}_review`;
  const { data: st } = await supabase.from("streaks").select("*").eq("id", id).maybeSingle();
  const current = (st?.current ?? 0) + 1;
  await supabase.from("streaks").upsert({
    id, current, best: Math.max(current, st?.best ?? 0),
    last_incremented: new Date().toISOString().slice(0, 10),
  });
}
