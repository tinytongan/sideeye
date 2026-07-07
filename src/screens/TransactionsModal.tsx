import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet,
  Switch, Text, TextInput, View,
} from "react-native";
import { supabase } from "../lib/supabase";
import { centsToAud, type Category } from "../lib/types";

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

              <Text style={styles.dLabel}>Category</Text>
              <View style={styles.grid}>
                {cats
                  .filter((c) => (open.amount_cents > 0 ? c.is_income : !c.is_income))
                  .map((c) => {
                    const active = open.category_id === c.id;
                    return (
                      <Pressable
                        key={c.id}
                        onPress={() => patch(open.id, { category_id: c.id, needs_review: false })}
                        style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && styles.pressed]}
                      >
                        <Text style={[styles.chipText, active && styles.chipTextActive]}>{c.emoji} {c.name}</Text>
                      </Pressable>
                    );
                  })}
              </View>

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
});
