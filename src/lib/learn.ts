// Turns a user categorisation into a reusable rule + applies it to lookalikes.
import { supabase } from "./supabase";
import { normaliseDescription } from "./ingest";

/** Merchant signature: first 1-2 digit-free tokens of the normalised
 * description. "WOOLWORTHS 3130 MULGRAVE AUS" → "WOOLWORTHS",
 * "SQ TROUBLEMAKER SYD" → "SQ TROUBLEMAKER". */
export function merchantSignature(description: string): string | null {
  const tokens = normaliseDescription(description)
    .split(" ")
    .filter((t) => t.length > 1 && !/\d/.test(t));
  if (tokens.length === 0) return null;
  // One long distinctive token is enough; otherwise take two.
  return tokens[0].length >= 6 ? tokens[0] : tokens.slice(0, 2).join(" ");
}

/** Categorise a transaction from user feedback, learn a rule from it, and
 * apply that rule to every other queued transaction that matches.
 * Returns how many extra transactions the new rule cleared. */
export async function categoriseAndLearn(
  txnId: string,
  description: string,
  categoryId: string
): Promise<number> {
  await supabase
    .from("transactions")
    .update({ category_id: categoryId, category_confidence: null, needs_review: false })
    .eq("id", txnId);

  const sig = merchantSignature(description);
  if (!sig) return 0;

  await supabase.from("category_rules").insert({
    match_type: "contains",
    pattern: sig,
    category_id: categoryId,
    priority: 10, // user-taught rules beat seeded ones
    learned_from: txnId,
  });

  // Clear lookalikes still in the queue.
  const { data: matches } = await supabase
    .from("transactions")
    .select("id, description")
    .eq("needs_review", true)
    .ilike("description", `%${sig.split(" ")[0]}%`);
  const ids = (matches ?? [])
    .filter((m) => merchantSignature(m.description) === sig)
    .map((m) => m.id);
  if (ids.length > 0) {
    await supabase
      .from("transactions")
      .update({ category_id: categoryId, category_confidence: 0.95, needs_review: false })
      .in("id", ids);
  }
  return ids.length;
}
