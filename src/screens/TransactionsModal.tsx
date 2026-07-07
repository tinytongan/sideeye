import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet,
  Switch, Text, TextInput, View,
} from "react-native";
import { supabase } from "../lib/supabase";
import { centsToAud, type Category, type Receipt } from "../lib/types";
import { deleteReceipt, listReceipts, pickAndUploadReceipt } from "../lib/receipts";
import { categoriseEverywhere, merchantSignature } from "../lib/learn";

interface Txn {
  id: string;
  posted_at: string;
  description: string;
  merchant: string | null;
  amount_cents: number;
  category_id: string | null;
  tax_flag: boolean;
  tax_note: string | null;
  notes: string | null;
  needs_review: boolean;
  accounts: { name: string } | null;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  title: string;
  categoryId: string | null | "uncat"; // null = all, "uncat" = uncategorised
  from: string; // ISO inclusive
  to: string;   // ISO exclusive
}

export default function TransactionsModal({ visible, onClose, title, categoryId, from, to }: Props) {
  const [txns, setTxns] = useState<Txn[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [open, setOpen] = useState<Txn | null>(null);
  const [loading, setLoading] = useState(true);
  const [changed, setChanged] = useState(false); // reload list after edits
  const [receipts, setReceipts] = useState<(Receipt & { url: string })[]>([]);
  const [uploading, setUploading] = useState(false);
  const [pendingCat, setPendingCat] = useState<Category | null>(null);
  const [catMsg, setCatMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from("transactions")
      .select("id, posted_at, description, merchant, amount_cents, category_id, tax_flag, tax_note, notes, needs_review, accounts(name)")
      .gte("posted_at", from).lt("posted_at", to)
      .order("posted_at", { ascending: false });
    if (categoryId === "uncat") q = q.is("category_id", null);
    else if (categoryId) q = q.eq("category_id", categoryId);
    const [txnRes, catRes] = await Promise.all([
      q,
      supabase.from("categories").select("*").order("sort"),
    ]);
    setTxns((txnRes.data ?? []) as unknown as Txn[]);
    setCats((catRes.data ?? []) as Category[]);
    setLoading(false);
  }, [categoryId, from, to]);

  useEffect(() => { if (visible) { setOpen(null); load(); } }, [visible, load]);
  useEffect(() => {
    if (open) listReceipts(open.id).then(setReceipts);
    else setReceipts([]);
  }, [open?.id]);

  const attach = async () => {
    if (!open) return;
    setUploading(true);
    const r = await pickAndUploadReceipt(open.id);
    if (r) setReceipts(await listReceipts(open.id));
    setUploading(false);
  };
  const removeReceipt = async (r: Receipt & { url: string }) => {
    await deleteReceipt(r);
    setReceipts((rs) => rs.filter((x) => x.id !== r.id));
  };

  const patch = async (id: string, fields: Partial<Txn>) => {
    await supabase.from("transactions").update(fields).eq("id", id);
    setOpen((o) => (o && o.id === id ? { ...o, ...fields } : o));
    setChanged(true);
  };

  const catOf = (id: string | null) => cats.find((c) => c.id === id);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1}>{title}</Text>
            <Pressable
              onPress={() => { if (open) { setOpen(null); if (changed) load(); } else onClose(); }}
              style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}
            >
              <Text style={styles.closeText}>{open ? "‹ Back" : "Close"}</Text>
            </Pressable>
          </View>

          {loading ? (
            <ActivityIndicator style={{ marginTop: 40 }} />
          ) : open ? (
            /* ── Detail view ── */
            <ScrollView contentContainerStyle={styles.detail}>
              <Text style={styles.dDesc}>{open.description}</Text>
              <Text style={[styles.dAmount, open.amount_cents > 0 && styles.income]}>
                {centsToAud(open.amount_cents)}
              </Text>
              <Text style={styles.dMeta}>
                {new Date(open.posted_at).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "long", year: "numeric" })}
                {open.accounts?.name ? `  ·  ${open.accounts.name}` : ""}
              </Text>

              <Text style={styles.dLabel}>🧾 Receipts & invoices</Text>
              {receipts.map((r) => (
                <View key={r.id} style={styles.receiptRow}>
                  <Pressable style={{ flex: 1 }} onPress={() => window.open(r.url, "_blank")}>
                    <Text style={styles.receiptLink}>
                      {r.mime_type.includes("pdf") ? "📄" : "🖼️"} {r.storage_path.split("/").pop()}
                    </Text>
                  </Pressable>
                  <Pressable onPress={() => removeReceipt(r)}>
                    <Text style={styles.receiptDelete}>✕</Text>
                  </Pressable>
                </View>
              ))}
              <Pressable onPress={attach} disabled={uploading}
                style={({ pressed }) => [styles.attachBtn, pressed && styles.pressed]}>
                <Text style={styles.attachText}>{uploading ? "Uploading…" : "＋ Attach photo or PDF"}</Text>
              </Pressable>

              <Text style={styles.dLabel}>Category</Text>
              <View style={styles.grid}>
                {cats
                  .filter((c) => (open.amount_cents > 0 ? c.is_income : !c.is_income))
                  .map((c) => {
                    const active = open.category_id === c.id;
                    const pending = pendingCat?.id === c.id;
                    return (
                      <Pressable
                        key={c.id}
                        onPress={() => { setPendingCat(active || pending ? null : c); setCatMsg(null); }}
                        style={({ pressed }) => [styles.chip, (active || pending) && styles.chipActive, pressed && styles.pressed]}
                      >
                        <Text style={[styles.chipText, (active || pending) && styles.chipTextActive]}>{c.emoji} {c.name}</Text>
                      </Pressable>
                    );
                  })}
              </View>

              {pendingCat && (
                <View style={styles.scopeBox}>
                  <Text style={styles.scopeTitle}>
                    Change to {pendingCat.emoji} {pendingCat.name} for…
                  </Text>
                  <View style={styles.scopeRow}>
                    <Pressable
                      onPress={async () => {
                        await patch(open.id, { category_id: pendingCat.id, needs_review: false });
                        setCatMsg(`Changed this transaction only.`);
                        setPendingCat(null);
                      }}
                      style={({ pressed }) => [styles.scopeBtn, pressed && styles.pressed]}
                    >
                      <Text style={styles.scopeBtnText}>Just this one</Text>
                    </Pressable>
                    <Pressable
                      onPress={async () => {
                        const res = await categoriseEverywhere(open.id, open.description, pendingCat.id);
                        setOpen((o) => (o ? { ...o, category_id: pendingCat.id, needs_review: false } : o));
                        setChanged(true);
                        setCatMsg(`Changed everywhere — ${res.retagged + 1} transaction(s) retagged, rule learned.`);
                        setPendingCat(null);
                      }}
                      style={({ pressed }) => [styles.scopeBtn, styles.scopeBtnPrimary, pressed && styles.pressed]}
                    >
                      <Text style={styles.scopeBtnText}>
                        All "{merchantSignature(open.description) ?? "matching"}"
                      </Text>
                    </Pressable>
                  </View>
                </View>
              )}
              {catMsg && <Text style={styles.catMsg}>{catMsg}</Text>}

              <View style={styles.switchRow}>
                <Text style={styles.dLabel}>🧾 Flag for tax</Text>
                <Switch
                  value={open.tax_flag}
                  onValueChange={(v) => patch(open.id, { tax_flag: v })}
                  trackColor={{ true: "#7c83ff", false: "#3d4260" }}
                />
              </View>
              {open.tax_flag && (
                <TextInput
                  style={styles.input}
                  placeholder="Tax note — e.g. work travel, deductible %"
                  placeholderTextColor="#565b73"
                  defaultValue={open.tax_note ?? ""}
                  onEndEditing={(e) => patch(open.id, { tax_note: e.nativeEvent.text || null })}
                />
              )}

              <Text style={styles.dLabel}>Notes</Text>
              <TextInput
                style={[styles.input, styles.notesInput]}
                placeholder="Anything future-you should know"
                placeholderTextColor="#565b73"
                multiline
                defaultValue={open.notes ?? ""}
                onEndEditing={(e) => patch(open.id, { notes: e.nativeEvent.text || null })}
              />
            </ScrollView>
          ) : (
            /* ── List view ── */
            <ScrollView>
              {txns.map((t) => (
                <Pressable
                  key={t.id}
                  onPress={() => setOpen(t)}
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                >
                  <View style={styles.rowMid}>
                    <Text style={styles.rowDesc} numberOfLines={1}>
                      {t.tax_flag ? "🧾 " : ""}{t.description}
                    </Text>
                    <Text style={styles.rowMeta}>
                      {new Date(t.posted_at).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}
                      {"  ·  "}{catOf(t.category_id)?.emoji ?? "❓"} {catOf(t.category_id)?.name ?? "Uncategorised"}
                    </Text>
                  </View>
                  <Text style={[styles.rowAmt, t.amount_cents > 0 && styles.income]}>
                    {centsToAud(t.amount_cents)}
                  </Text>
                  <Text style={styles.rowChevron}>›</Text>
                </Pressable>
              ))}
              {txns.length === 0 && <Text style={styles.empty}>Nothing here this month.</Text>}
              <View style={{ height: 30 }} />
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: "#171923", borderTopLeftRadius: 20, borderTopRightRadius: 20,
    height: "88%", paddingHorizontal: 18, paddingTop: 14,
  },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  title: { color: "#fff", fontSize: 17, fontWeight: "800", flex: 1, marginRight: 12 },
  closeBtn: { padding: 6 },
  closeText: { color: "#7c83ff", fontSize: 15, fontWeight: "700" },
  pressed: { opacity: 0.55, transform: [{ scale: 0.97 }] },
  row: {
    flexDirection: "row", alignItems: "center", paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#232636",
  },
  rowPressed: { backgroundColor: "#1c1f2e" },
  rowMid: { flex: 1, marginRight: 10 },
  rowDesc: { color: "#e8e9f0", fontSize: 14, fontWeight: "600" },
  rowMeta: { color: "#565b73", fontSize: 12, marginTop: 2 },
  rowAmt: { color: "#ff6b6b", fontSize: 14, fontWeight: "700", fontVariant: ["tabular-nums"] },
  income: { color: "#51cf66" },
  empty: { color: "#565b73", textAlign: "center", marginTop: 40 },
  detail: { paddingBottom: 40 },
  dDesc: { color: "#fff", fontSize: 18, fontWeight: "700", marginTop: 6 },
  dAmount: { color: "#ff6b6b", fontSize: 34, fontWeight: "800", marginTop: 6 },
  dMeta: { color: "#8b90a5", fontSize: 13, marginTop: 4 },
  dLabel: { color: "#fff", fontSize: 14, fontWeight: "700", marginTop: 22, marginBottom: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { backgroundColor: "#232636", borderRadius: 16, paddingVertical: 7, paddingHorizontal: 11 },
  chipActive: { backgroundColor: "#7c83ff" },
  chipText: { color: "#e8e9f0", fontSize: 12 },
  chipTextActive: { color: "#fff", fontWeight: "700" },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
  input: {
    backgroundColor: "#1c1f2e", borderRadius: 10, color: "#fff",
    paddingVertical: 10, paddingHorizontal: 12, fontSize: 14, marginTop: 8,
  },
  notesInput: { minHeight: 70, textAlignVertical: "top" },
  receiptRow: { flexDirection: "row", alignItems: "center", backgroundColor: "#1c1f2e", borderRadius: 10, paddingVertical: 9, paddingHorizontal: 12, marginTop: 6 },
  receiptLink: { color: "#7c83ff", fontSize: 13 },
  receiptDelete: { color: "#565b73", fontSize: 15, paddingHorizontal: 6 },
  attachBtn: { backgroundColor: "#232636", borderRadius: 10, paddingVertical: 11, alignItems: "center", marginTop: 8 },
  attachText: { color: "#e8e9f0", fontSize: 13, fontWeight: "600" },
  rowChevron: { color: "#565b73", fontSize: 18, marginLeft: 8 },
  scopeBox: { backgroundColor: "#232636", borderRadius: 12, padding: 12, marginTop: 12 },
  scopeTitle: { color: "#fff", fontSize: 13, fontWeight: "700", textAlign: "center" },
  scopeRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  scopeBtn: { flex: 1, backgroundColor: "#1c1f2e", borderRadius: 9, paddingVertical: 11, alignItems: "center" },
  scopeBtnPrimary: { backgroundColor: "#7c83ff" },
  scopeBtnText: { color: "#fff", fontWeight: "700", fontSize: 12 },
  catMsg: { color: "#51cf66", fontSize: 12, marginTop: 8, textAlign: "center" },
});
