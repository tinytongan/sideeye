import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { parseWestpacCsv } from "../src/lib/importers/westpac";
import { dedupKeysForBatch } from "../src/lib/ingest";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;
if (!url || !key) throw new Error("Set EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY (see .env)");
const db = createClient(url, key);

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Usage: npx tsx scripts/import-csv.ts <file.csv>");
  const rows = parseWestpacCsv(readFileSync(file, "utf8"));
  console.log(`Parsed ${rows.length} rows from ${file}`);
  if (rows.length === 0) return;

  const byAccount = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!byAccount.has(r.bank_account)) byAccount.set(r.bank_account, []);
    byAccount.get(r.bank_account)!.push(r);
  }

  for (const [acctNo, acctRows] of byAccount) {
    let { data: acct } = await db
      .from("accounts").select("id")
      .eq("source", "csv").eq("external_id", acctNo).maybeSingle();
    if (!acct) {
      const { data, error } = await db
        .from("accounts")
        .insert({ name: `Westpac ${acctNo.slice(-4)}`, institution: "Westpac", kind: "transaction", source: "csv", external_id: acctNo })
        .select("id").single();
      if (error) throw error;
      acct = data;
      console.log(`Created account Westpac ${acctNo.slice(-4)}`);
    }

    const keys = dedupKeysForBatch(acct!.id, acctRows);
    const txns = acctRows.map((r, i) => ({
      account_id: acct!.id,
      posted_at: r.posted_at,
      description: r.description,
      amount_cents: r.amount_cents,
      source: "csv" as const,
      dedup_hash: keys[i],
      needs_review: true,
    }));

    const { error, count } = await db
      .from("transactions")
      .upsert(txns, { onConflict: "dedup_hash", ignoreDuplicates: true, count: "exact" });
    if (error) throw error;

    const withBal = acctRows.filter((r) => r.balance_cents !== undefined && r.balance_cents !== 0);
    if (withBal.length > 0) {
      const latest = withBal.reduce((a, b) => (a.posted_at >= b.posted_at ? a : b));
      await db.from("accounts").update({
        balance_cents: latest.balance_cents,
        balance_as_of: new Date().toISOString(),
      }).eq("id", acct!.id);
    }
    console.log(`Westpac ${acctNo.slice(-4)}: ${count ?? "?"} new transactions (of ${acctRows.length} in file).`);
  }
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
