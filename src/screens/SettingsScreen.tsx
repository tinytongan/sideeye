import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { supabase } from "../lib/supabase";
import { centsToAud, type AccountKind } from "../lib/types";
import { asSnark, MASCOTS, say, type SnarkLevel } from "../personality/copy";
import { computeAchievements, type AchievementState } from "../lib/achievements";
import { MASCOT_ART } from "../personality/art";
import { BUILD } from "../buildInfo";

const LEVELS: SnarkLevel[] = ["quokka", "wombat", "bin_chicken", "tassie_devil"];

interface ManualAcct { id: string; name: string; kind: string; balance_cents: number | null }


export default function SettingsScreen() {
  const [snark, setSnark] = useState<SnarkLevel>("wombat");
  const [accts, setAccts] = useState<ManualAcct[]>([]);
  const [achievements, setAchievements] = useState<AchievementState[]>([]);
  const [streaks, setStreaks] = useState<{ id: string; current: number; best: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [newBal, setNewBal] = useState("");
  const [newKind, setNewKind] = useState<AccountKind>("super");
  const [sample, setSample] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [snarkRes, acctRes, streakRes, achStates] = await Promise.all([
      supabase.from("settings").select("value").eq("key", "snark_level").maybeSingle(),
      supabase.from("accounts").select("id, name, kind, balance_cents").in("kind", ["super", "investment", "cash"]),
      supabase.from("streaks").select("*"),
      computeAchievements(),
    ]);
    if (snarkRes.data?.value) setSnark(asSnark(snarkRes.data.value));
    setAccts((acctRes.data ?? []) as ManualAcct[]);
    setStreaks((streakRes.data ?? []) as { id: string; current: number; best: number }[]);
    setAchievements(achStates);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const pickSnark = async (l: SnarkLevel) => {
    setSnark(l);
    setSample(say("greeting_morning", l));
    await supabase.from("settings").upsert({ key: "snark_level", value: l as unknown as object });
  };

  const addAccount = async () => {
    const name = newName.trim();
    const bal = Math.round(Number(newBal.replace(/[$,\s]/g, "")) * 100);
    if (!name || !Number.isFinite(bal)) return;
    const { data } = await supabase.from("accounts").insert({
      name, kind: newKind, source: "manual",
      balance_cents: bal, balance_as_of: new Date().toISOString(),
    }).select("id, name, kind, balance_cents").single();
    if (data) { setAccts((a) => [...a, data as ManualAcct]); setNewName(""); setNewBal(""); }
  };

  const updateBalance = async (a: ManualAcct, v: string) => {
    const bal = Math.round(Number(v.replace(/[$,\s]/g, "")) * 100);
    if (!Number.isFinite(bal)) return;
    await supabase.from("accounts").update({ balance_cents: bal, balance_as_of: new Date().toISOString() }).eq("id", a.id);
    setAccts((as) => as.map((x) => (x.id === a.id ? { ...x, balance_cents: bal } : x)));
  };

  if (loading) return <ActivityIndicator style={{ marginTop: 80 }} />;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Settings</Text>

      {/* Snark dial */}
      <Text style={styles.section}>Who judges you</Text>
      {LEVELS.map((l) => {
        const m = MASCOTS[l];
        const active = snark === l;
        return (
          <Pressable key={l} onPress={() => pickSnark(l)}
            style={({ pressed }) => [styles.mascotRow, active && styles.mascotActive, pressed && styles.pressed]}>
            <Image source={MASCOT_ART[l]} style={styles.mascotArt} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.mascotName, active && { color: "#fff" }]}>{m.name}</Text>
              <Text style={styles.mascotTag}>{m.tagline}</Text>
            </View>
            {active && <Text style={styles.tick}>✓</Text>}
          </Pressable>
        );
      })}
      {sample && <Text style={styles.sample}>“{sample}”</Text>}

      {/* Super & investments */}
      <Text style={styles.section}>Super & investments</Text>
      <Text style={styles.hint}>No CDR feed exists for these yet — update balances quarterly (I'll nag you).</Text>
      {accts.map((a) => (
        <View key={a.id} style={styles.acctRow}>
          <Text style={styles.acctEmoji}>{a.kind === "super" ? "🦺" : a.kind === "investment" ? "📊" : "💵"}</Text>
          <Text style={styles.acctName}>{a.name}</Text>
          <TextInput
            style={styles.input}
            defaultValue={a.balance_cents !== null ? String(a.balance_cents / 100) : ""}
            keyboardType="numeric"
            onEndEditing={(e) => updateBalance(a, e.nativeEvent.text)}
          />
        </View>
      ))}
      <View style={styles.addRow}>
        <Pressable onPress={() => setNewKind(newKind === "super" ? "investment" : newKind === "investment" ? "cash" : "super")}
          style={({ pressed }) => [styles.kindBtn, pressed && styles.pressed]}>
          <Text style={styles.kindText}>{newKind === "super" ? "🦺 Super" : newKind === "investment" ? "📊 Invest" : "💵 Cash"}</Text>
        </Pressable>
        <TextInput style={[styles.input, { flex: 1, textAlign: "left" }]} placeholder="Name (e.g. AustralianSuper)"
          placeholderTextColor="#565b73" value={newName} onChangeText={setNewName} />
        <TextInput style={styles.input} placeholder="Balance" placeholderTextColor="#565b73"
          keyboardType="numeric" value={newBal} onChangeText={setNewBal} />
        <Pressable onPress={addAccount} style={({ pressed }) => [styles.addBtn, pressed && styles.pressed]}>
          <Text style={styles.addText}>Add</Text>
        </Pressable>
      </View>

      {/* Achievements */}
      <Text style={styles.section}>Achievements</Text>
      {streaks.length > 0 && (
        <Text style={styles.hint}>
          {streaks.map((s) => `${s.id.replace(/_/g, " ")}: ${s.current} (best ${s.best})`).join("  ·  ")}
        </Text>
      )}
      {achievements.map((a) => (
        <View key={a.id} style={[styles.achRow, !a.unlocked && styles.achLocked]}>
          <Text style={styles.achEmoji}>{a.unlocked ? a.emoji : "🔒"}</Text>
          <View style={{ flex: 1 }}>
            <Text style={[styles.achName, a.unlocked && { color: "#ffd43b" }]}>{a.name}</Text>
            <Text style={styles.achDesc}>{a.desc}</Text>
          </View>
          <Text style={styles.achProgress}>{Math.min(a.progress, a.target)}/{a.target}</Text>
        </View>
      ))}

      {/* Sign out */}
      <Text style={styles.version}>SideEye build {BUILD}</Text>
      <Pressable onPress={() => supabase.auth.signOut()}
        style={({ pressed }) => [styles.signOut, pressed && styles.pressed]}>
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#14161f" },
  content: { padding: 20, paddingTop: 56, paddingBottom: 60 },
  title: { color: "#fff", fontSize: 24, fontWeight: "800" },
  section: { color: "#fff", fontSize: 15, fontWeight: "700", marginTop: 26, marginBottom: 10 },
  hint: { color: "#565b73", fontSize: 12, marginBottom: 8 },
  pressed: { opacity: 0.55, transform: [{ scale: 0.97 }] },
  mascotRow: { flexDirection: "row", alignItems: "center", backgroundColor: "#1c1f2e", borderRadius: 12, padding: 12, marginBottom: 8 },
  mascotActive: { borderWidth: 1, borderColor: "#7c83ff" },
  mascotArt: { width: 44, height: 44, marginRight: 12 },
  mascotName: { color: "#e8e9f0", fontSize: 15, fontWeight: "700" },
  mascotTag: { color: "#8b90a5", fontSize: 12, marginTop: 1 },
  tick: { color: "#7c83ff", fontSize: 18, fontWeight: "800" },
  sample: { color: "#8b90a5", fontSize: 13, fontStyle: "italic", textAlign: "center", marginTop: 6 },
  acctRow: { flexDirection: "row", alignItems: "center", marginBottom: 8, gap: 8 },
  acctEmoji: { fontSize: 18 },
  acctName: { color: "#e8e9f0", fontSize: 14, flex: 1 },
  input: { backgroundColor: "#1c1f2e", borderRadius: 8, color: "#fff", paddingVertical: 7, paddingHorizontal: 10, minWidth: 90, textAlign: "right", fontSize: 14 },
  addRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  kindBtn: { backgroundColor: "#232636", borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10 },
  kindText: { color: "#e8e9f0", fontSize: 12 },
  addBtn: { backgroundColor: "#3d4260", borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14 },
  addText: { color: "#fff", fontWeight: "700" },
  achRow: { flexDirection: "row", alignItems: "center", backgroundColor: "#1c1f2e", borderRadius: 12, padding: 12, marginBottom: 8 },
  achLocked: { opacity: 0.55 },
  achEmoji: { fontSize: 22, marginRight: 12 },
  achName: { color: "#e8e9f0", fontSize: 14, fontWeight: "700" },
  achDesc: { color: "#8b90a5", fontSize: 12, marginTop: 1 },
  achProgress: { color: "#565b73", fontSize: 12, fontVariant: ["tabular-nums"] },
  version: { color: "#3a3f52", fontSize: 11, textAlign: "center", marginTop: 28 },
  signOut: { alignSelf: "center", marginTop: 4, padding: 12 },
  signOutText: { color: "#ff6b6b", fontSize: 14, fontWeight: "600" },
});
