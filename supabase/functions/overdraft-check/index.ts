// Daily overdraft check: recurring-debit detection server-side; if projected
// debits in the next 7 days exceed a transaction account's balance, push a
// warning to every registered device. Cron-only (x-cron-secret) or test mode.
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3";

const DAY = 86400000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

function normalise(s: string) {
  return s.toUpperCase().replace(/\s+/g, " ").replace(/[^A-Z0-9 ]/g, "").trim();
}
function signature(desc: string): string | null {
  const t = normalise(desc).split(" ").filter((x) => x.length > 1 && !/\d/.test(x));
  if (t.length === 0) return null;
  return t[0].length >= 6 ? t[0] : t.slice(0, 2).join(" ");
}

function detectRecurring(txns: { posted_at: string; description: string; amount_cents: number }[]) {
  const groups = new Map<string, { posted_at: string; amount_cents: number }[]>();
  for (const t of txns) {
    if (t.amount_cents >= 0) continue;
    const sig = signature(t.description);
    if (!sig) continue;
    (groups.get(sig) ?? groups.set(sig, []).get(sig)!).push(t);
  }
  const out: { signature: string; avg_cents: number; next_date: string }[] = [];
  for (const [sig, g] of groups) {
    if (g.length < 3) continue;
    g.sort((a, b) => a.posted_at.localeCompare(b.posted_at));
    const gaps = g.slice(1).map((x, i) => Math.round((+new Date(x.posted_at) - +new Date(g[i].posted_at)) / DAY));
    const avgGap = gaps.reduce((s, x) => s + x, 0) / gaps.length;
    if (!(avgGap >= 5 && avgGap <= 35 && gaps.every((x) => Math.abs(x - avgGap) <= Math.max(3, avgGap * 0.4)))) continue;
    const amounts = g.map((x) => -x.amount_cents);
    const avgAmt = amounts.reduce((s, x) => s + x, 0) / amounts.length;
    if (!amounts.every((x) => Math.abs(x - avgAmt) <= avgAmt * 0.35)) continue;
    const next = new Date(+new Date(g[g.length - 1].posted_at) + Math.round(avgGap) * DAY);
    out.push({ signature: sig, avg_cents: Math.round(avgAmt), next_date: iso(next) });
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) {
    return new Response(JSON.stringify({ error: "unauthorised" }), { status: 401 });
  }
  const url = new URL(req.url);
  const testMode = url.searchParams.get("test") === "1";

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const [acctRes, txnRes] = await Promise.all([
    admin.from("accounts").select("id, name, kind, balance_cents").eq("kind", "transaction").not("balance_cents", "is", null),
    admin.from("transactions").select("account_id, posted_at, description, amount_cents")
      .gte("posted_at", iso(new Date(Date.now() - 120 * DAY))),
  ]);

  const today = iso(new Date());
  const horizon = iso(new Date(Date.now() + 7 * DAY));
  const warnings: string[] = [];
  for (const a of acctRes.data ?? []) {
    const mine = (txnRes.data ?? []).filter((t) => t.account_id === a.id);
    const rec = detectRecurring(mine);
    const due = rec.filter((r) => r.next_date >= today && r.next_date <= horizon);
    const upcoming = due.reduce((s, r) => s + r.avg_cents, 0);
    if (due.length > 0 && (a.balance_cents ?? 0) < upcoming) {
      const short = ((upcoming - (a.balance_cents ?? 0)) / 100).toFixed(2);
      const items = due.map((d) => `${d.signature} ~$${(d.avg_cents / 100).toFixed(0)} (${d.next_date.slice(5)})`).join(", ");
      warnings.push(`${a.name}: $${((a.balance_cents ?? 0) / 100).toFixed(2)} in the bank, ${items} incoming. Short $${short}. Move money. Now.`);
    }
  }
  if (testMode && warnings.length === 0) {
    warnings.push("Test alert: this is what an overdraft warning will look like. The Wombat says hello. Grudgingly.");
  }

  let sent = 0, dropped = 0;
  if (warnings.length > 0) {
    webpush.setVapidDetails("mailto:mdaunauda@gmail.com",
      Deno.env.get("VAPID_PUBLIC_KEY")!, Deno.env.get("VAPID_PRIVATE_KEY")!);
    const { data: subs } = await admin.from("push_subscriptions").select("endpoint, subscription");
    for (const s of subs ?? []) {
      try {
        await webpush.sendNotification(s.subscription, JSON.stringify({
          title: "⚠️ SideEye — overdraft risk",
          body: warnings.join("\n"),
          tag: "overdraft",
          url: "/sideeye/",
        }));
        sent++;
      } catch (e) {
        // expired subscription → clean up
        if ((e as { statusCode?: number }).statusCode === 410 || (e as { statusCode?: number }).statusCode === 404) {
          await admin.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
          dropped++;
        }
      }
    }
  }
  return new Response(JSON.stringify({ warnings: warnings.length, sent, dropped }), {
    headers: { "Content-Type": "application/json" },
  });
});
