// Syncs Basiq accounts + transactions into SideEye tables, then runs the
// categorisation rules. Callable from the app (authed) or by cron (secret header).
import { createClient } from "npm:@supabase/supabase-js@2";

function normalise(desc: string): string {
  return desc.toUpperCase().replace(/\s+/g, " ").replace(/[^A-Z0-9 ]/g, "").trim();
}
function dedupKey(accountId: string, date: string, cents: number, desc: string, seq = 0): string {
  const base = [accountId, date, cents, normalise(desc)].join("|");
  return seq > 0 ? `${base}|${seq}` : base;
}

Deno.serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info, x-cron-secret",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // auth: either a logged-in app user or the cron secret
  const cronOk = req.headers.get("x-cron-secret") === Deno.env.get("CRON_SECRET");
  if (!cronOk) {
    const authed = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } }
    );
    const { data: { user } } = await authed.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "unauthorised" }), { status: 401, headers: cors });
  }

  const { data: setting } = await admin.from("settings").select("value").eq("key", "basiq_user_id").single();
  const basiqUserId = setting?.value as string;

  const tokRes = await fetch("https://au-api.basiq.io/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Deno.env.get("BASIQ_API_KEY")}`,
      "basiq-version": "3.0",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "scope=SERVER_ACCESS",
  });
  const { access_token } = await tokRes.json();
  const bq = (path: string) =>
    fetch(`https://au-api.basiq.io${path}`, { headers: { Authorization: `Bearer ${access_token}`, Accept: "application/json" } })
      .then((r) => r.json());

  // ── Accounts ──
  const acctData = await bq(`/users/${basiqUserId}/accounts`);
  const accounts = acctData.data ?? [];
  const acctMap = new Map<string, string>(); // basiq id → our id
  for (const a of accounts) {
    const balance = Math.round(parseFloat(a.balance ?? "0") * 100);
    const kind = a.class?.type === "credit-card" ? "credit"
      : a.class?.type === "savings" ? "savings"
      : a.class?.type === "loan" ? "loan" : "transaction";
    const { data: existing } = await admin.from("accounts").select("id")
      .eq("source", "basiq").eq("external_id", a.id).maybeSingle();
    if (existing) {
      await admin.from("accounts").update({ balance_cents: balance, balance_as_of: new Date().toISOString() }).eq("id", existing.id);
      acctMap.set(a.id, existing.id);
    } else {
      const { data: created } = await admin.from("accounts").insert({
        name: a.name ?? `Account ${(a.accountNo ?? "").slice(-4)}`,
        institution: a.institution ?? "Basiq",
        kind, source: "basiq", external_id: a.id,
        balance_cents: balance, balance_as_of: new Date().toISOString(),
      }).select("id").single();
      if (created) acctMap.set(a.id, created.id);
    }
  }

  // ── Transactions (paginated) ──
  let inserted = 0, scanned = 0;
  let url = `/users/${basiqUserId}/transactions?limit=500`;
  const seen = new Map<string, number>();
  while (url) {
    const page = await bq(url);
    const txns = page.data ?? [];
    scanned += txns.length;
    const rows = [];
    for (const t of txns) {
      const ourAcct = acctMap.get(t.account);
      if (!ourAcct || t.status !== "posted") continue;
      const cents = Math.round(parseFloat(t.amount) * 100);
      const date = (t.postDate ?? t.transactionDate ?? "").slice(0, 10);
      if (!date) continue;
      const base = dedupKey(ourAcct, date, cents, t.description ?? "");
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      rows.push({
        account_id: ourAcct,
        posted_at: date,
        description: t.description ?? "",
        amount_cents: cents,
        source: "basiq",
        external_id: t.id,
        dedup_hash: dedupKey(ourAcct, date, cents, t.description ?? "", n),
        needs_review: true,
      });
    }
    if (rows.length > 0) {
      const { count } = await admin.from("transactions")
        .upsert(rows, { onConflict: "dedup_hash", ignoreDuplicates: true, count: "exact" });
      inserted += count ?? 0;
    }
    const next = page.links?.next as string | undefined;
    url = next ? next.replace("https://au-api.basiq.io", "") : "";
  }

  // ── Categorise new arrivals ──
  const { data: catResult } = await admin.rpc("categorise_transactions");

  return new Response(JSON.stringify({
    accounts: accounts.length, scanned, inserted,
    categorised: catResult?.[0]?.categorised ?? null,
  }), { headers: { ...cors, "Content-Type": "application/json" } });
});
