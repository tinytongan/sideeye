// Receipt/tax-invoice attachments (Supabase Storage, private bucket).
import { supabase } from "./supabase";
import type { Receipt } from "./types";

/** Web file picker (camera-enabled on mobile) → upload → receipts row. */
export function pickAndUploadReceipt(txnId: string): Promise<Receipt | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*,application/pdf";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const ext = file.name.split(".").pop() ?? "jpg";
      const path = `${txnId}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("receipts").upload(path, file, {
        contentType: file.type || "application/octet-stream",
      });
      if (upErr) return resolve(null);
      const { data, error } = await supabase
        .from("receipts")
        .insert({ transaction_id: txnId, storage_path: path, mime_type: file.type || "application/octet-stream" })
        .select("*").single();
      resolve(error ? null : (data as Receipt));
    };
    input.click();
  });
}

export async function listReceipts(txnId: string): Promise<(Receipt & { url: string })[]> {
  const { data } = await supabase.from("receipts").select("*").eq("transaction_id", txnId);
  const out: (Receipt & { url: string })[] = [];
  for (const r of (data ?? []) as Receipt[]) {
    const { data: signed } = await supabase.storage.from("receipts").createSignedUrl(r.storage_path, 3600);
    if (signed?.signedUrl) out.push({ ...r, url: signed.signedUrl });
  }
  return out;
}

export async function deleteReceipt(r: Receipt): Promise<void> {
  await supabase.storage.from("receipts").remove([r.storage_path]);
  await supabase.from("receipts").delete().eq("id", r.id);
}
