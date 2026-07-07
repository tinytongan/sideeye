// "Connected banks" management for the More tab: connect, sync,
// disconnect (with explicit keep-or-delete data choice), account removal.
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { supabase } from "../lib/supabase";
import {
  deleteAccountFully, deleteSyncedData, institutionName,
  listConnections, revokeConnection, txnCount, type BankConnection,
} from "../lib/banks";
import { centsToAud } from "../lib/types";

interface Acct { id: string; name: string; kind: string; source: string; balance_cents: number | null }

export default function BanksSection({ onDataChanged }: { onDataChanged?: () => void }) {
  const [connections, setConnections] = useState<BankConnection[] | null>(null);
  const [accounts, setAccounts] = useState<Acct[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // disconnect flow state
  const [disconnecting, setDisconnecting] = useState<BankConnection | null>(null);
  // account delete flow state
  const [deleting, setDeleting] = useState<{ acct: Acct; txns: number } | null>(null);

  const load = useCallback(async () => {
    const [acctRes, conns] = await Promise.all([
      supabase.from("accounts").select("id, name, kind, source, balance_cents").order("name"),
      listConnections().catch(() => null),
    ]);
    setAccounts((acctRes.data ?? []) as Acct[]);
    setConnections(conns);
  }, []);

  useEffect(() => { load(); }, [load]);

  const connect = async () => {
    setBusy(true); setMsg(null);
    const { data, error } = await supabase.functions.invoke("basiq-consent");
    setBusy(false);
    if (error || !data?.url) { setMsg("⚠️ Couldn't get a consent link."); return; }
    window.open(data.url, "_blank");
    setMsg("Finish in the Basiq tab — I'll sync when you come back.");
    const onFocus = () => { window.removeEventListener("focus", onFocus); sync(); };
    window.addEventListener("focus", onFocus);
  };

  const sync = async () => {
    setBusy(true); setMsg(null);
    const { data, error } = await supabase.functions.invoke("basiq-sync", { method: "POST" });
    setBusy(false);
    if (error) { setMsg("⚠️ Sync failed."); return; }
    setMsg(`Synced: ${data.inserted} new transaction(s) from ${data.accounts} account(s).`);
    load();
    onDataChanged?.();
  };

  const doDisconnect = async (keepData: boolean) => {
    if (!disconnecting) return;
    setBusy(true);
    const ok = await revokeConnection(disconnecting.id);
    if (!ok) {
      setMsg("⚠️ Basiq wouldn't revoke the connection — try again or poke Claude.");
      setBusy(false); setDisconnecting(null);
      return;
    }
    let note = "consent revoked, history kept";
    if (!keepData) {
      const n = await deleteSyncedData(disconnecting.account_external_ids);
      note = `consent revoked, ${n} transaction(s) deleted`;
    }
    setMsg(`✅ ${institutionName(disconnecting.institution)} disconnected — ${note}.`);
    setDisconnecting(null);
    setBusy(false);
    load();
    onDataChanged?.();
  };

  const askDeleteAccount = async (acct: Acct) => {
    const n = await txnCount(acct.id);
    setDeleting({ acct, txns: n });
  };

  const doDeleteAccount = async () => {
    if (!deleting) return;
    setBusy(true);
    await deleteAccountFully(deleting.acct.id);
    setMsg(`✅ ${deleting.acct.name} deleted (${deleting.txns} transaction(s) removed).`);
    setDeleting(null);
    setBusy(false);
    load();
    onDataChanged?.();
  };

  return (
    <View>
      <Text style={styles.section}>Connected banks</Text>

      <View style={styles.btnRow}>
        <Pressable disabled={busy} onPress={connect}
          style={({ pressed }) => [styles.btn, styles.btnGreen, pressed && styles.pressed]}>
          <Text style={styles.btnText}>🔗 Connect a bank</Text>
        </Pressable>
        <Pressable disabled={busy} onPress={sync}
          style={({ pressed }) => [styles.btn, pressed && styles.pressed]}>
          <Text style={styles.btnText}>⟳ Sync now</Text>
        </Pressable>
      </View>
      <Text style={styles.hint}>Feeds also sync automatically every morning at 6am.</Text>

      {connections === null ? (
        <Text style={styles.hint}>Couldn't reach Basiq just now — connections list unavailable.</Text>
      ) : connections.length === 0 ? (
        <Text style={styles.hint}>No live bank connections.</Text>
      ) : (
        connections.map((c) => (
          <View key={c.id} style={styles.connRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.connName}>🏦 {institutionName(c.institution)}</Text>
              <Text style={styles.connMeta}>
                {c.status} · {c.account_external_ids.length} account(s)
              </Text>
            </View>
            <Pressable disabled={busy} onPress={() => setDisconnecting(c)}
              style={({ pressed }) => [styles.dangerBtn, pressed && styles.pressed]}>
              <Text style={styles.dangerText}>Disconnect</Text>
            </Pressable>
          </View>
        ))
      )}

      <Text style={styles.section}>All accounts</Text>
      {accounts.map((a) => (
        <View key={a.id} style={styles.acctRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.acctName}>{a.name}</Text>
            <Text style={styles.acctMeta}>
              {a.kind} · {a.source}{a.balance_cents !== null ? ` · ${centsToAud(a.balance_cents)}` : ""}
            </Text>
          </View>
          <Pressable disabled={busy} onPress={() => askDeleteAccount(a)}
            style={({ pressed }) => [pressed && styles.pressed]}>
            <Text style={styles.trash}>🗑</Text>
          </Pressable>
        </View>
      ))}

      {msg && <Text style={styles.msg}>{msg}</Text>}
      {busy && <ActivityIndicator style={{ marginTop: 8 }} />}

      {/* Disconnect: keep or delete data */}
      <Modal visible={disconnecting !== null} transparent animationType="fade"
        onRequestClose={() => setDisconnecting(null)}>
        <View style={styles.backdrop}>
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>
              Disconnect {disconnecting ? institutionName(disconnecting.institution) : ""}?
            </Text>
            <Text style={styles.dialogBody}>
              This revokes your data-sharing consent at Basiq — the feed stops immediately.
              What should happen to the transactions already synced?
            </Text>
            <Pressable disabled={busy} onPress={() => doDisconnect(true)}
              style={({ pressed }) => [styles.dialogBtn, pressed && styles.pressed]}>
              <Text style={styles.btnText}>Keep my transaction history</Text>
            </Pressable>
            <Pressable disabled={busy} onPress={() => doDisconnect(false)}
              style={({ pressed }) => [styles.dialogBtn, styles.dialogDanger, pressed && styles.pressed]}>
              <Text style={styles.btnText}>Delete everything from this bank</Text>
            </Pressable>
            <Pressable onPress={() => setDisconnecting(null)}
              style={({ pressed }) => [styles.dialogCancel, pressed && styles.pressed]}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Account delete confirmation */}
      <Modal visible={deleting !== null} transparent animationType="fade"
        onRequestClose={() => setDeleting(null)}>
        <View style={styles.backdrop}>
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>Delete {deleting?.acct.name}?</Text>
            <Text style={styles.dialogBody}>
              This permanently removes the account, its {deleting?.txns ?? 0} transaction(s),
              and any attached receipts. There's no undo.
            </Text>
            <Pressable disabled={busy} onPress={doDeleteAccount}
              style={({ pressed }) => [styles.dialogBtn, styles.dialogDanger, pressed && styles.pressed]}>
              <Text style={styles.btnText}>Delete it all</Text>
            </Pressable>
            <Pressable onPress={() => setDeleting(null)}
              style={({ pressed }) => [styles.dialogCancel, pressed && styles.pressed]}>
              <Text style={styles.cancelText}>Keep it</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { color: "#fff", fontSize: 15, fontWeight: "700", marginTop: 26, marginBottom: 10 },
  btnRow: { flexDirection: "row", gap: 8 },
  btn: { flex: 1, backgroundColor: "#232636", borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  btnGreen: { backgroundColor: "#2b5e3a" },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  hint: { color: "#565b73", fontSize: 12, marginTop: 8 },
  pressed: { opacity: 0.55, transform: [{ scale: 0.97 }] },
  connRow: { flexDirection: "row", alignItems: "center", backgroundColor: "#1c1f2e", borderRadius: 12, padding: 12, marginTop: 8 },
  connName: { color: "#e8e9f0", fontSize: 14, fontWeight: "600" },
  connMeta: { color: "#565b73", fontSize: 12, marginTop: 2 },
  dangerBtn: { borderColor: "#ff6b6b", borderWidth: 1, borderRadius: 8, paddingVertical: 7, paddingHorizontal: 12 },
  dangerText: { color: "#ff8787", fontSize: 12, fontWeight: "700" },
  acctRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#232636" },
  acctName: { color: "#e8e9f0", fontSize: 14 },
  acctMeta: { color: "#565b73", fontSize: 12, marginTop: 1 },
  trash: { fontSize: 16, padding: 6 },
  msg: { color: "#51cf66", fontSize: 13, marginTop: 10 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.65)", alignItems: "center", justifyContent: "center", padding: 24 },
  dialog: { backgroundColor: "#1c1f2e", borderRadius: 18, padding: 22, width: "100%", maxWidth: 380 },
  dialogTitle: { color: "#fff", fontSize: 18, fontWeight: "800" },
  dialogBody: { color: "#8b90a5", fontSize: 14, marginTop: 8, lineHeight: 20 },
  dialogBtn: { backgroundColor: "#3d4260", borderRadius: 10, paddingVertical: 13, alignItems: "center", marginTop: 12 },
  dialogDanger: { backgroundColor: "#8c1f1f" },
  dialogCancel: { alignItems: "center", marginTop: 12, padding: 8 },
  cancelText: { color: "#8b90a5", fontSize: 14 },
});
