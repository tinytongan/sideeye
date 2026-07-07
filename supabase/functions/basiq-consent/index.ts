// Returns a Basiq consent URL for the app to open. Requires a logged-in user.
import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // verify the caller is the logged-in app user
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

  // server token → client token bound to the user
  const st = await fetch("https://au-api.basiq.io/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Deno.env.get("BASIQ_API_KEY")}`,
      "basiq-version": "3.0",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `scope=CLIENT_ACCESS&userId=${basiqUserId}`,
  });
  const { access_token } = await st.json();

  return new Response(
    JSON.stringify({ url: `https://consent.basiq.io/home?token=${access_token}&action=connect` }),
    { headers: { ...cors, "Content-Type": "application/json" } }
  );
});
