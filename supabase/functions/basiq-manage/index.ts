// List Basiq connections (with their account ids) and revoke consent.
// Revocation = DELETE the connection at Basiq — the CDR-compliant way to
// stop data sharing for that institution.
import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // must be the logged-in app user
  const authed = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } }
  );
  const { data: { user } } = await authed.auth.getUser();
  if (!user) return new Response(JSON.stringify({ error: "unauthorised" }), { status: 401, headers: cors });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
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
  const H = { Authorization: `Bearer ${access_token}`, Accept: "application/json" };

  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const action = body.action ?? "list";

  if (action === "disconnect") {
    const connectionId = body.connectionId as string;
    if (!connectionId) return new Response(JSON.stringify({ error: "connectionId required" }), { status: 400, headers: cors });
    const del = await fetch(`https://au-api.basiq.io/users/${basiqUserId}/connections/${connectionId}`, {
      method: "DELETE", headers: H,
    });
    return new Response(JSON.stringify({ ok: del.status === 202 || del.status === 204 || del.ok, status: del.status }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  // list: connections + which basiq account ids belong to each
  const [connRes, acctRes] = await Promise.all([
    fetch(`https://au-api.basiq.io/users/${basiqUserId}/connections`, { headers: H }).then((r) => r.json()),
    fetch(`https://au-api.basiq.io/users/${basiqUserId}/accounts`, { headers: H }).then((r) => r.json()),
  ]);
  const accounts = acctRes.data ?? [];
  const connections = (connRes.data ?? []).map((c: { id: string; status: string; institution?: { id?: string } }) => ({
    id: c.id,
    status: c.status,
    institution: c.institution?.id ?? "unknown",
    account_external_ids: accounts
      .filter((a: { connection?: string; id: string }) => a.connection === c.id)
      .map((a: { id: string }) => a.id),
  }));
  return new Response(JSON.stringify({ connections }), {
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
