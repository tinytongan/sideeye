// Categorisation actions + rule learning, with undo support.
import { supabase } from "./supabase";
import { normaliseDescription } from "./ingest";

/** Merchant signature: first 1-2 digit-free tokens of the normalised
 * description. "AUSPOST MULGRAVE VIC" → "AUSPOST". */
export function merchantSignature(description: string): string | null {
  const tokens = normaliseDescription(description)
    .split(" ")
    .filter((t) => t.length > 1 && !/\d/.test(t));
  if (tokens.length === 0) return null;
  return tokens[0].length >= 6 ? tokens[0] : tokens.slice(0, 2).join(" ");
}

export interface CategoriseAction {
  txnId: string;
  ruleId: string | null;     // rule created (if "all from merchant")
  clearedIds: string[];      // lookalikes the rule also categorised
}

/** Categorise ONE transaction only. No rule learned — the next transaction
 * from this merchant still comes to the queue (passports vs postage). */
export async function categoriseOne(txnId: string, categoryId: string): Promise<CategoriseAction> {
  await supabase
    .from("transactions")
    .update({ category_id: categoryId, category_confidence: null, needs_review: false })
    .eq("id", txnId);
  return { txnId, ruleId: null, clearedIds: [] };
}

/** Categorise this transaction AND learn a rule for the merchant, applying
 * it to every queued lookalike. */
export async function categoriseAndLearn(
  txnId: string,
  description: string,
  categoryId: string
): Promise<CategoriseAction> {
  await categoriseOne(txnId, categoryId);

  const sig = merchantSignature(description);
  if (!sig) return { txnId, ruleId: null, clearedIds: [] };

  const { data: rule } = await supabase
    .from("category_rules")
    .insert({ match_type: "contains", pattern: sig, category_id: categoryId, priority: 10, learned_from: txnId })
    .select("id").single();

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
  return { txnId, ruleId: rule?.id ?? null, clearedIds: ids };
}

/** Fully revert a categorisation action (transaction, rule, lookalikes). */
export async function undoCategorisation(a: CategoriseAction): Promise<void> {
  const revert = { category_id: null, category_confidence: null, needs_review: true };
  await supabase.from("transactions").update(revert).eq("id", a.txnId);
  if (a.clearedIds.length > 0) {
    await supabase.from("transactions").update(revert).in("id", a.clearedIds);
  }
  if (a.ruleId) {
    await supabase.from("category_rules").delete().eq("id", a.ruleId);
  }
}

/** Re-categorise this transaction AND every other transaction from the same
 * merchant — including already-categorised ones (fixing recurring mistakes).
 * Learns a rule so future arrivals land right too. */
export async function categoriseEverywhere(
  txnId: string,
  description: string,
  categoryId: string
): Promise<CategoriseAction & { retagged: number }> {
  const base = await categoriseAndLearn(txnId, description, categoryId);
  const sig = merchantSignature(description);
  if (!sig) return { ...base, retagged: 0 };
  const { data: matches } = await supabase
    .from("transactions")
    .select("id, description, category_id")
    .ilike("description", `%${sig.split(" ")[0]}%`);
  const ids = (matches ?? [])
    .filter((m) => m.id !== txnId && merchantSignature(m.description) === sig && m.category_id !== categoryId)
    .map((m) => m.id);
  if (ids.length > 0) {
    await supabase
      .from("transactions")
      .update({ category_id: categoryId, category_confidence: 0.95, needs_review: false })
      .in("id", ids);
  }
  return { ...base, clearedIds: [...base.clearedIds, ...ids], retagged: ids.length };
}
