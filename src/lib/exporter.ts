// CSV + AI-readable Markdown export.
import { supabase } from "./supabase";
import { centsToAud } from "./types";

export interface ExportData {
  from: string;
  to: string;
  accounts: { name: string; kind: string; balance_cents: number | null }[];
  txns: {
    posted_at: string; description: string; amount_cents: number;
    category: string; account: string; tax_flag: boolean; tax_note: string | null; notes: string | null;
  }[];
}

export async function fetchExportData(from: string, to: string): Promise<ExportData> {
  const [acctRes, txnRes, catRes] = await Promise.all([
    supabase.from("accounts").select("id, name, kind, balance_cents"),
    supabase
      .from("transactions")
      .select("posted_at, description, amount_cents, category_id, account_id, tax_flag, tax_note, notes")
      .gte("posted_at", from).lt("posted_at", to)
      .order("posted_at", { ascending: true }),
    supabase.from("categories").select("id, name"),
  ]);
  const cat = new Map((catRes.data ?? []).map((c) => [c.id, c.name]));
  const acct = new Map((acctRes.data ?? []).map((a) => [a.id, a.name]));
  return {
    from, to,
    accounts: (acctRes.data ?? []).map(({ name, kind, balance_cents }) => ({ name, kind, balance_cents })),
    txns: (txnRes.data ?? []).map((t) => ({
      posted_at: t.posted_at,
      description: t.description,
      amount_cents: t.amount_cents,
      category: t.category_id ? cat.get(t.category_id) ?? "?" : "Uncategorised",
      account: acct.get(t.account_id) ?? "?",
      tax_flag: t.tax_flag,
      tax_note: t.tax_note,
      notes: t.notes,
    })),
  };
}

const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s);

export function buildCsv(d: ExportData): string {
  const header = "date,description,amount_aud,category,account,tax_flag,tax_note,notes";
  const lines = d.txns.map((t) =>
    [t.posted_at, esc(t.description), (t.amount_cents / 100).toFixed(2), esc(t.category),
     esc(t.account), t.tax_flag ? "yes" : "", esc(t.tax_note ?? ""), esc(t.notes ?? "")].join(",")
  );
  return [header, ...lines].join("\n");
}

export function buildMarkdown(d: ExportData): string {
  const spend = d.txns.filter((t) => t.amount_cents < 0 && t.category !== "Transfers");
  const income = d.txns.filter((t) => t.amount_cents > 0 && t.category !== "Transfers");
  const sum = (xs: typeof d.txns) => xs.reduce((s, t) => s + t.amount_cents, 0);

  const byCat = new Map<string, number>();
  for (const t of spend) byCat.set(t.category, (byCat.get(t.category) ?? 0) + -t.amount_cents);
  const catRows = [...byCat.entries()].sort((a, b) => b[1] - a[1])
    .map(([c, v]) => `| ${c} | ${centsToAud(v)} |`).join("\n");

  const byMonth = new Map<string, { inc: number; sp: number }>();
  for (const t of d.txns) {
    if (t.category === "Transfers") continue;
    const m = t.posted_at.slice(0, 7);
    const e = byMonth.get(m) ?? { inc: 0, sp: 0 };
    if (t.amount_cents > 0) e.inc += t.amount_cents; else e.sp += -t.amount_cents;
    byMonth.set(m, e);
  }
  const monthRows = [...byMonth.entries()].sort()
    .map(([m, v]) => `| ${m} | ${centsToAud(v.inc)} | ${centsToAud(v.sp)} | ${centsToAud(v.inc - v.sp)} |`).join("\n");

  const taxed = d.txns.filter((t) => t.tax_flag);
  const taxRows = taxed.map((t) =>
    `| ${t.posted_at} | ${t.description} | ${centsToAud(t.amount_cents)} | ${t.tax_note ?? ""} |`).join("\n");

  const txnRows = d.txns.map((t) =>
    `| ${t.posted_at} | ${t.description} | ${centsToAud(t.amount_cents)} | ${t.category} | ${t.account} |`).join("\n");

  return `# SideEye financial export

> Personal finance data for the period ${d.from} to ${d.to} (AUD).
> Amounts are signed: negative = spending, positive = income.
> "Transfers" are movements between own accounts and are excluded from totals.

## Summary

- Period: ${d.from} → ${d.to}
- Transactions: ${d.txns.length}
- Total income: ${centsToAud(sum(income))}
- Total spending: ${centsToAud(-sum(spend))}
- Net: ${centsToAud(sum(income) + sum(spend))}

## Accounts (current balances)

| Account | Type | Balance |
|---|---|---|
${d.accounts.map((a) => `| ${a.name} | ${a.kind} | ${a.balance_cents !== null ? centsToAud(a.balance_cents) : "unknown"} |`).join("\n")}

## Month by month

| Month | Income | Spending | Net |
|---|---|---|---|
${monthRows}

## Spending by category

| Category | Total |
|---|---|
${catRows}

${taxed.length > 0 ? `## Tax-flagged transactions\n\n| Date | Description | Amount | Note |\n|---|---|---|---|\n${taxRows}\n` : ""}
## All transactions

| Date | Description | Amount | Category | Account |
|---|---|---|---|---|
${txnRows}
`;
}

/** Trigger a browser download (web/PWA). */
export function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** EOFY deduction pack: tax-flagged transactions for a financial year,
 * grouped by category with notes and receipt counts. Accountant-ready. */
export async function buildEofyPack(fyEndYear: number): Promise<{ md: string; count: number }> {
  const from = `${fyEndYear - 1}-07-01`;
  const to = `${fyEndYear}-07-01`;
  const [txnRes, catRes, recRes] = await Promise.all([
    supabase
      .from("transactions")
      .select("id, posted_at, description, amount_cents, category_id, tax_note, notes")
      .eq("tax_flag", true)
      .gte("posted_at", from).lt("posted_at", to)
      .order("posted_at", { ascending: true }),
    supabase.from("categories").select("id, name, emoji"),
    supabase.from("receipts").select("transaction_id"),
  ]);
  const cat = new Map((catRes.data ?? []).map((c) => [c.id, c]));
  const receiptCount = new Map<string, number>();
  for (const r of recRes.data ?? []) {
    receiptCount.set(r.transaction_id, (receiptCount.get(r.transaction_id) ?? 0) + 1);
  }
  const txns = txnRes.data ?? [];

  const byCat = new Map<string, typeof txns>();
  for (const t of txns) {
    const key = t.category_id ?? "uncat";
    if (!byCat.has(key)) byCat.set(key, []);
    byCat.get(key)!.push(t);
  }

  let body = "";
  let grand = 0;
  for (const [catId, group] of byCat) {
    const c = catId === "uncat" ? { name: "Uncategorised", emoji: "❓" } : cat.get(catId) ?? { name: "?", emoji: "" };
    const total = group.reduce((s, t) => s + Math.abs(t.amount_cents), 0);
    grand += total;
    body += `\n### ${c.emoji ?? ""} ${c.name} — ${centsToAud(total)}\n\n`;
    body += `| Date | Description | Amount | Note | Receipts |\n|---|---|---|---|---|\n`;
    for (const t of group) {
      const rc = receiptCount.get(t.id) ?? 0;
      body += `| ${t.posted_at} | ${t.description} | ${centsToAud(Math.abs(t.amount_cents))} | ${t.tax_note ?? t.notes ?? ""} | ${rc > 0 ? `${rc} 🧾` : "—"} |\n`;
    }
  }

  const missing = txns.filter((t) => !(receiptCount.get(t.id) ?? 0)).length;
  const md = `# SideEye — EOFY deduction pack FY${fyEndYear - 1}-${String(fyEndYear).slice(2)}

> Tax-flagged transactions ${from} → ${to.slice(0, 10)}. Amounts are the transaction totals —
> apportion work-use percentages with your accountant. Receipts are stored in SideEye;
> export individual files from each transaction's detail view.

**Summary:** ${txns.length} flagged transactions totalling ${centsToAud(grand)}.
${missing > 0 ? `⚠️ ${missing} flagged transaction(s) have no receipt attached.` : "✅ Every flagged transaction has at least one receipt."}
${body}`;
  return { md, count: txns.length };
}
