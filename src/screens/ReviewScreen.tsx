import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { supabase } from "../lib/supabase";
import {
  categoriseAndLearn, categoriseOne, merchantSignature,
  undoCategorisation, type CategoriseAction,
} from "../lib/learn";
import {
  COMBO_WINDOW_MS, loadGameStats, REACTIONS, RUSH_SECONDS, saveGameStats, scoreFor,
} from "../lib/game";
import { centsToAud, type Category } from "../lib/types";
import { asSnark, MASCOTS, say, type SnarkLevel } from "../personality/copy";
import { MASCOT_ART } from "../personality/art";

interface QueueTxn {
  id: string;
  posted_at: string;
  description: string;
  amount_cents: number;
}

interface Toast { message: string; action: CategoriseAction | null }

export default function ReviewScreen() {
  const [queue, setQueue] = useState<QueueTxn[]>([]);
  const [sessionStart, setSessionStart] = useState(0);
  const [cats, setCats] = useState<Category[]>([]);
  const [selected, setSelected] = useState<Category | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<Toast | null>(null);
  const [snark, setSnark] = useState<SnarkLevel>("wombat");

  // game state
  const [points, setPoints] = useState(0);        // all-time
  const [sessionPts, setSessionPts] = useState(0);
  const [combo, setCombo] = useState(0);
  const [bestCombo, setBestCombo] = useState(0);
  const [reaction, setReaction] = useState<string | null>(null);
  const [rushEndsAt, setRushEndsAt] = useState<number | null>(null);
  const [rushCount, setRushCount] = useState(0);
  const [rushBest, setRushBest] = useState(0);
  const [rushResult, setRushResult] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const lastAction = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [txnRes, catRes, snarkRes, stats] = await Promise.all([
      supabase
        .from("transactions")
        .select("id, posted_at, description, amount_cents")
        .eq("needs_review", true)
        .order("amount_cents", { ascending: true })
        .limit(100),
      supabase.from("categories").select("*").order("sort"),
      supabase.from("settings").select("value").eq("key", "snark_level").maybeSingle(),
      loadGameStats(),
    ]);
    const q = (txnRes.data ?? []) as QueueTxn[];
    setQueue(q);
    setSessionStart((s) => (s === 0 ? q.length : s));
    setCats((catRes.data ?? []) as Category[]);
    if (snarkRes.data?.value) setSnark(asSnark(snarkRes.data.value));
    setPoints(stats.points);
    setBestCombo(stats.bestCombo);
    setRushBest(stats.rushBest);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // ticking clock for combo + rush countdown
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  // rush end
  useEffect(() => {
    if (rushEndsAt !== null && now >= rushEndsAt) {
      setRushEndsAt(null);
      setRushResult(rushCount);
      if (rushCount > rushBest) {
        setRushBest(rushCount);
        saveGameStats({ rushBest: rushCount });
      }
    }
  }, [now, rushEndsAt, rushCount, rushBest]);

  const current = queue[0];

  const showToast = (t: Toast) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(t);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  };

  const apply = async (scope: "one" | "all") => {
    if (!current || !selected || busy) return;
    setBusy(true);
    const action = scope === "one"
      ? await categoriseOne(current.id, selected.id)
      : await categoriseAndLearn(current.id, current.description, selected.id);

    // combo logic
    const t = Date.now();
    const newCombo = t - lastAction.current <= COMBO_WINDOW_MS ? combo + 1 : 1;
    lastAction.current = t;
    setCombo(newCombo);
    if (newCombo > bestCombo) {
      setBestCombo(newCombo);
      saveGameStats({ bestCombo: newCombo });
    }
    const gained = scoreFor(newCombo, action.clearedIds.length);
    const newPoints = points + gained;
    setPoints(newPoints);
    setSessionPts((p) => p + gained);
    saveGameStats({ points: newPoints });
    if (rushEndsAt !== null) setRushCount((c) => c + 1 + action.clearedIds.length);

    const r = REACTIONS[snark][newCombo as 3 | 5 | 8 | 12];
    if (r) { setReaction(r); setTimeout(() => setReaction(null), 3500); }

    const extra = action.clearedIds.length > 0 ? ` +${action.clearedIds.length} similar` : "";
    showToast({ message: `+${gained} pts · ${selected.emoji ?? ""} ${selected.name}${extra}`, action });
    const removed = new Set([current.id, ...action.clearedIds]);
    setQueue((q) => q.filter((x) => !removed.has(x.id)));
    setSelected(null);
    setBusy(false);
  };

  const undo = async () => {
    if (!toast?.action) return;
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setBusy(true);
    await undoCategorisation(toast.action);
    setCombo(0); // undo breaks the combo. The Wombat saw that.
    setToast(null);
    await load();
    setBusy(false);
  };

  const skip = () => {
    setCombo(0);
    setSelected(null);
    setQueue((q) => [...q.slice(1), q[0]]);
  };

  const startRush = () => {
    setRushCount(0);
    setRushResult(null);
    setRushEndsAt(Date.now() + RUSH_SECONDS * 1000);
  };

  if (loading) return <ActivityIndicator style={{ marginTop: 80 }} />;

  const cleared = Math.max(0, sessionStart - queue.length);
  const comboLive = combo > 1 && now - lastAction.current <= COMBO_WINDOW_MS;
  const comboPct = comboLive ? Math.max(0, 1 - (now - lastAction.current) / COMBO_WINDOW_MS) : 0;
  const rushSecs = rushEndsAt !== null ? Math.max(0, Math.ceil((rushEndsAt - now) / 1000)) : null;

  if (!current) {
    return (
      <View style={styles.doneWrap}>
        <Image source={MASCOT_ART[snark]} style={styles.doneArt} />
        <Text style={styles.doneText}>“{say("review_complete", snark)}”</Text>
        <Text style={styles.doneSub}>
          Queue cleared. {sessionPts > 0 ? `+${sessionPts} pts this session · best combo ×${bestCombo}` : "Nothing needs your eyes."}
        </Text>
      </View>
    );
  }

  const isIncome = current.amount_cents > 0;
  const options = cats.filter((c) => (isIncome ? c.is_income : !c.is_income));
  const sig = merchantSignature(current.description);

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Game header */}
        <View style={styles.hud}>
          <Image source={MASCOT_ART[snark]} style={styles.hudArt} />
          <View style={{ flex: 1 }}>
            <View style={styles.hudRow}>
              <Text style={styles.hudPoints}>⭐ {points.toLocaleString()} pts</Text>
              {comboLive && <Text style={styles.hudCombo}>🔥 ×{combo}</Text>}
              {rushSecs !== null && <Text style={styles.hudRush}>⏱ {rushSecs}s · {rushCount}</Text>}
            </View>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${sessionStart > 0 ? (cleared / sessionStart) * 100 : 0}%` }]} />
            </View>
            <Text style={styles.progressText}>{cleared} sorted · {queue.length} to go</Text>
            {comboLive && (
              <View style={styles.comboTrack}>
                <View style={[styles.comboFill, { width: `${comboPct * 100}%` }]} />
              </View>
            )}
          </View>
        </View>

        {reaction && <Text style={styles.reaction}>“{reaction}”</Text>}

        {rushEndsAt === null && rushResult === null && queue.length >= 5 && (
          <Pressable onPress={startRush} style={({ pressed }) => [styles.rushBtn, pressed && styles.pressed]}>
            <Text style={styles.rushBtnText}>⚡ Rush round — how many can you sort in {RUSH_SECONDS}s? (best: {rushBest})</Text>
          </Pressable>
        )}
        {rushResult !== null && (
          <View style={styles.rushCard}>
            <Text style={styles.rushResultText}>
              ⚡ Rush over: {rushResult} sorted{rushResult >= rushBest && rushResult > 0 ? " — NEW BEST!" : ` (best ${rushBest})`}
            </Text>
            <Pressable onPress={startRush} style={({ pressed }) => [pressed && styles.pressed]}>
              <Text style={styles.rushAgain}>go again ›</Text>
            </Pressable>
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.date}>
            {new Date(current.posted_at).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}
          </Text>
          <Text style={styles.desc}>{current.description}</Text>
          <Text style={[styles.amount, isIncome && styles.income]}>
            {centsToAud(current.amount_cents)}
          </Text>
        </View>

        <Text style={styles.prompt}>What is this?</Text>
        <View style={styles.grid}>
          {options.map((c) => {
            const active = selected?.id === c.id;
            return (
              <Pressable
                key={c.id}
                onPress={() => setSelected(active ? null : c)}
                style={({ pressed }) => [styles.chip, active && styles.chipSelected, pressed && styles.pressed]}
              >
                <Text style={[styles.chipText, active && styles.chipTextSelected]}>
                  {c.emoji} {c.name}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Pressable style={({ pressed }) => [styles.skip, pressed && styles.pressed]} onPress={skip}>
          <Text style={styles.skipText}>Skip for now (breaks combo)</Text>
        </Pressable>
        <View style={{ height: 130 }} />
      </ScrollView>

      {selected && (
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>{selected.emoji} {selected.name}</Text>
          <View style={styles.sheetRow}>
            <Pressable disabled={busy} onPress={() => apply("one")}
              style={({ pressed }) => [styles.sheetBtn, pressed && styles.pressed]}>
              <Text style={styles.sheetBtnText}>Just this one</Text>
            </Pressable>
            <Pressable disabled={busy} onPress={() => apply("all")}
              style={({ pressed }) => [styles.sheetBtn, styles.sheetBtnPrimary, pressed && styles.pressed]}>
              <Text style={styles.sheetBtnText}>All from {sig ?? "this merchant"}</Text>
            </Pressable>
          </View>
        </View>
      )}

      {toast && (
        <View style={styles.toast}>
          <Text style={styles.toastText}>{toast.message}</Text>
          {toast.action && (
            <Pressable onPress={undo} disabled={busy} style={({ pressed }) => [pressed && styles.pressed]}>
              <Text style={styles.undoText}>UNDO</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#14161f" },
  content: { padding: 20, paddingTop: 50 },
  hud: { flexDirection: "row", alignItems: "center", gap: 12 },
  hudArt: { width: 56, height: 56 },
  hudRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  hudPoints: { color: "#ffd43b", fontSize: 15, fontWeight: "800" },
  hudCombo: { color: "#ff922b", fontSize: 15, fontWeight: "800" },
  hudRush: { color: "#66d9e8", fontSize: 15, fontWeight: "800" },
  progressTrack: { height: 8, borderRadius: 4, backgroundColor: "#232636", marginTop: 6, overflow: "hidden" },
  progressFill: { height: 8, backgroundColor: "#7c83ff" },
  progressText: { color: "#565b73", fontSize: 11, marginTop: 3 },
  comboTrack: { height: 3, borderRadius: 2, backgroundColor: "#232636", marginTop: 4, overflow: "hidden" },
  comboFill: { height: 3, backgroundColor: "#ff922b" },
  reaction: { color: "#ffd43b", fontSize: 14, fontStyle: "italic", textAlign: "center", marginTop: 12 },
  rushBtn: { backgroundColor: "#1c2f36", borderRadius: 12, padding: 12, marginTop: 14, borderWidth: 1, borderColor: "#66d9e8" },
  rushBtnText: { color: "#66d9e8", fontSize: 13, fontWeight: "700", textAlign: "center" },
  rushCard: { backgroundColor: "#1c2f36", borderRadius: 12, padding: 12, marginTop: 14, alignItems: "center" },
  rushResultText: { color: "#66d9e8", fontSize: 14, fontWeight: "800" },
  rushAgain: { color: "#8b90a5", fontSize: 12, marginTop: 6, textDecorationLine: "underline" },
  card: { backgroundColor: "#1c1f2e", borderRadius: 16, padding: 20, marginTop: 14, alignItems: "center" },
  date: { color: "#8b90a5", fontSize: 13 },
  desc: { color: "#fff", fontSize: 17, fontWeight: "600", textAlign: "center", marginTop: 8 },
  amount: { color: "#ff6b6b", fontSize: 30, fontWeight: "800", marginTop: 10 },
  income: { color: "#51cf66" },
  prompt: { color: "#fff", fontSize: 15, fontWeight: "700", marginTop: 22, marginBottom: 10 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { backgroundColor: "#232636", borderRadius: 18, paddingVertical: 8, paddingHorizontal: 12 },
  chipSelected: { backgroundColor: "#7c83ff" },
  chipText: { color: "#e8e9f0", fontSize: 13 },
  chipTextSelected: { color: "#fff", fontWeight: "700" },
  pressed: { opacity: 0.55, transform: [{ scale: 0.97 }] },
  skip: { alignSelf: "center", marginTop: 22, padding: 10 },
  skipText: { color: "#565b73", fontSize: 13 },
  sheet: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    backgroundColor: "#1c1f2e", borderTopLeftRadius: 18, borderTopRightRadius: 18,
    padding: 18, paddingBottom: 26, borderTopWidth: 1, borderTopColor: "#3d4260",
  },
  sheetTitle: { color: "#fff", fontSize: 15, fontWeight: "700", textAlign: "center", marginBottom: 12 },
  sheetRow: { flexDirection: "row", gap: 10 },
  sheetBtn: { flex: 1, backgroundColor: "#232636", borderRadius: 10, paddingVertical: 13, alignItems: "center" },
  sheetBtnPrimary: { backgroundColor: "#7c83ff" },
  sheetBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  toast: {
    position: "absolute", bottom: 24, alignSelf: "center",
    flexDirection: "row", alignItems: "center", gap: 16,
    backgroundColor: "#3d4260", borderRadius: 22, paddingVertical: 10, paddingHorizontal: 18,
  },
  toastText: { color: "#fff", fontSize: 13 },
  undoText: { color: "#ffd43b", fontSize: 13, fontWeight: "800" },
  doneWrap: { flex: 1, backgroundColor: "#14161f", alignItems: "center", justifyContent: "center", padding: 32 },
  doneArt: { width: 140, height: 140 },
  doneText: { color: "#e8e9f0", fontSize: 17, textAlign: "center", marginTop: 16, fontStyle: "italic" },
  doneSub: { color: "#565b73", marginTop: 8, textAlign: "center" },
});
