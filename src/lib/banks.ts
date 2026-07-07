// Bank connection management: list, connect, sync, disconnect, data cleanup.
import { supabase } from "./supabase";

export interface BankConnection {
  id: string;
  status: string;
  institution: string;
  account_external_ids: string[];
}

const INSTITUTION_NAMES: Record<string, string> = {
  AU00000: "Hooli Bank (test)",
  AU00201: "Hooligov (test)",
};
export const institutionName = (id: string) => INSTITUTION_NAMES[id] ?? id;

export async function listConnections(): Promise<BankConnection[]> {
  const { data, error } = await supabase.functions.invoke("basiq-manage", {
    body: { action: "list" },
  });
  if (error) throw new Error("Couldn't reach Basiq.");
  return (data?.connections ?? []) as BankConnection[];
}

/** Revoke consent at Basiq. Data handling is a separate, explicit choice. */
export async function revokeConnection(connectionId: string): Promise<boolean> {
  const { data, error } = await supabase.functions.invoke("basiq-manage", {
    body: { action: "disconnect", connectionId },
  });
  return !error && !!data?.ok;
}

/** Delete all synced data for the given basiq account external ids. */
export async function deleteSyncedData(externalIds: string[]): Promise<number> {
  if (externalIds.length === 0) return 0;
  const { data: accts } = await supabase
    .from("accounts").select("id")
    .eq("source", "basiq").in("external_id", externalIds);
  const ids = (accts ?? []).map((a) => a.id);
  if (ids.length === 0) return 0;
  const { data: txns } = await supabase.from("transactions").select("id").in("account_id", ids);
  const txnIds = (txns ?? []).map((t) => t.id);
  if (txnIds.length > 0) {
    await supabase.from("receipts").delete().in("transaction_id", txnIds);
    await supabase.from("transactions").delete().in("account_id", ids);
  }
  await supabase.from("accounts").delete().in("id", ids);
  return txnIds.length;
}

/** Count transactions for an account (for honest delete confirmations). */
export async function txnCount(accountId: string): Promise<number> {
  const { count } = await supabase
    .from("transactions").select("id", { count: "exact", head: true })
    .eq("account_id", accountId);
  return count ?? 0;
}

/** Delete one account and everything attached to it. */
export async function deleteAccountFully(accountId: string): Promise<void> {
  const { data: txns } = await supabase.from("transactions").select("id").eq("account_id", accountId);
  const txnIds = (txns ?? []).map((t) => t.id);
  if (txnIds.length > 0) {
    await supabase.from("receipts").delete().in("transaction_id", txnIds);
    await supabase.from("transactions").delete().eq("account_id", accountId);
  }
  await supabase.from("accounts").delete().eq("id", accountId);
}
