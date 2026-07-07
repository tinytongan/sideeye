// Recurring-debit detection + overdraft risk projection. Client-side v1;
// moves to an edge function + push when Basiq sync lands.
import { merchantSignature } from "./learn";

export interface RecurringDebit {
  signature: string;
  avg_cents: number;         // average debit size (positive number)
  interval_days: number;     // 7, 14, 28/30
  last_date: string;
  next_date: string;         // projected
}

export interface OverdraftRisk {
  account_name: string;
  balance_cents: number;
  upcoming_cents: number;    // debits projected in next 7 days
  shortfall_cents: number;   // negative buffer
  items: RecurringDebit[];
}

const DAY = 86400000;
const daysBetween = (a: string, b: string) =>
  Math.round((new Date(b).getTime() - new Date(a).getTime()) / DAY);
const addDays = (d: string, n: number) =>
  new Date(new Date(d).getTime() + n * DAY).toISOString().slice(0, 10);

/** Find recurring debits in one account's transaction history. */
export function detectRecurring(
  txns: { posted_at: string; description: string; amount_cents: number }[]
): RecurringDebit[] {
  const groups = new Map<string, { posted_at: string; amount_cents: number }[]>();
  for (const t of txns) {
    if (t.amount_cents >= 0) continue;
    const sig = merchantSignature(t.description);
    if (!sig) continue;
    if (!groups.has(sig)) groups.set(sig, []);
    groups.get(sig)!.push(t);
  }

  const out: RecurringDebit[] = [];
  for (const [sig, g] of groups) {
    if (g.length < 3) continue;
    g.sort((a, b) => a.posted_at.localeCompare(b.posted_at));
    const gaps: number[] = [];
    for (let i = 1; i < g.length; i++) gaps.push(daysBetween(g[i - 1].posted_at, g[i].posted_at));
    const avgGap = gaps.reduce((s, x) => s + x, 0) / gaps.length;
    // regular if gaps are consistent (±40%) and cadence is weekly..monthly-ish
    const regular = avgGap >= 5 && avgGap <= 35 &&
      gaps.every((x) => Math.abs(x - avgGap) <= Math.max(3, avgGap * 0.4));
    if (!regular) continue;
    const amounts = g.map((x) => -x.amount_cents);
    const avgAmt = amounts.reduce((s, x) => s + x, 0) / amounts.length;
    const steady = amounts.every((x) => Math.abs(x - avgAmt) <= avgAmt * 0.35);
    if (!steady) continue;
    const interval = Math.round(avgGap);
    const last = g[g.length - 1].posted_at;
    out.push({
      signature: sig,
      avg_cents: Math.round(avgAmt),
      interval_days: interval,
      last_date: last,
      next_date: addDays(last, interval),
    });
  }
  return out;
}

/** Project the next `horizonDays` of recurring debits vs current balance. */
export function assessOverdraftRisk(
  accountName: string,
  balanceCents: number,
  recurring: RecurringDebit[],
  horizonDays = 7,
  today = new Date().toISOString().slice(0, 10)
): OverdraftRisk | null {
  const horizon = addDays(today, horizonDays);
  const due = recurring.filter((r) => r.next_date >= today && r.next_date <= horizon);
  if (due.length === 0) return null;
  const upcoming = due.reduce((s, r) => s + r.avg_cents, 0);
  const shortfall = balanceCents - upcoming;
  if (shortfall >= 0) return null; // no risk
  return {
    account_name: accountName,
    balance_cents: balanceCents,
    upcoming_cents: upcoming,
    shortfall_cents: shortfall,
    items: due,
  };
}
