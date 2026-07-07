import { useEffect, useState } from "react";
import {
  ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import {
  buildQuestions, buildRecommendations, currentPeriod, fetchPeriodStats,
  saveReview, type PeriodStats, type ReviewQuestion,
} from "../lib/reviews";
import { centsToAud } from "../lib/types";
import { MASCOTS, say, type SnarkLevel } from "../personality/copy";

interface Props {
  visible: boolean;
  kind: "weekly" | "monthly";
  snark: SnarkLevel;
  onClose: (completed: boolean) => void;
}

export default function ReviewFlowModal({ visible, kind, snark, onClose }: Props) {
  const [stats, setStats] = useState<PeriodStats | null>(null);
  const [questions, setQuestions] = useState<ReviewQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [step, setStep] = useState(-1); // -1 = intro, 0..n-1 questions, n = recommendations
  const [saving, setSaving] = useState(false);
  const [recs, setRecs] = useState<string[]>([]);

  useEffect(() => {
    if (!visible) return;
    setStep(-1); setAnswers({}); setStats(null);
    const { from, to } = currentPeriod(kind);
    fetchPeriodStats(from, to).then((s) => {
      setStats(s);
      setQuestions(buildQuestions(s, kind));
    });
  }, [visible, kind]);

  const finish = async () => {
    if (!stats) return;
    setSaving(true);
    const r = buildRecommendations(stats);
    setRecs(r);
    await saveReview(
      kind, stats.from, stats.to,
      questions.map((q) => ({ question_id: q.id, question: q.question, answer: answers[q.id] ?? "" })),
      r
    );
    setSaving(false);
    setStep(questions.length); // recommendations screen
  };

  const q = step >= 0 && step < questions.length ? questions[step] : null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={() => onClose(false)}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          {!stats ? (
            <ActivityIndicator style={{ marginTop: 60 }} />
          ) : step === -1 ? (
            /* intro */
            <ScrollView contentContainerStyle={styles.body}>
              <Text style={styles.emoji}>{MASCOTS[snark].emoji}</Text>
              <Text style={styles.title}>{kind === "weekly" ? "Weekly" : "Monthly"} review</Text>
              <Text style={styles.quote}>“{say("review_prompt_weekly", snark)}”</Text>
              <View style={styles.statsCard}>
                <Text style={styles.statLine}>Spent: <Text style={styles.statVal}>{centsToAud(stats.spend_cents)}</Text></Text>
                <Text style={styles.statLine}>In: <Text style={styles.statVal}>{centsToAud(stats.income_cents)}</Text></Text>
                {stats.top_categories.map((c) => (
                  <Text key={c.name} style={styles.statSmall}>{c.emoji} {c.name}: {centsToAud(c.cents)}</Text>
                ))}
                {stats.no_spend_days > 0 && (
                  <Text style={styles.statSmall}>🎉 {stats.no_spend_days} no-spend day(s)</Text>
                )}
              </View>
              <Pressable onPress={() => setStep(0)} style={({ pressed }) => [styles.btn, styles.btnPrimary, pressed && styles.pressed]}>
                <Text style={styles.btnText}>Let's do it ({questions.length} questions)</Text>
              </Pressable>
              <Pressable onPress={() => onClose(false)} style={({ pressed }) => [styles.btn, pressed && styles.pressed]}>
                <Text style={styles.btnTextDim}>Not now</Text>
              </Pressable>
            </ScrollView>
          ) : q ? (
            /* question step */
            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
              <Text style={styles.progress}>{step + 1} / {questions.length}</Text>
              <Text style={styles.question}>{q.question}</Text>
              {q.context && <Text style={styles.context}>{q.context}</Text>}
              <TextInput
                style={styles.input}
                multiline
                placeholder="Your honest answer — the Wombat can tell when you're lying"
                placeholderTextColor="#565b73"
                value={answers[q.id] ?? ""}
                onChangeText={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))}
              />
              <View style={styles.row}>
                {step > 0 && (
                  <Pressable onPress={() => setStep(step - 1)} style={({ pressed }) => [styles.btn, styles.btnHalf, pressed && styles.pressed]}>
                    <Text style={styles.btnTextDim}>‹ Back</Text>
                  </Pressable>
                )}
                <Pressable
                  disabled={saving}
                  onPress={() => (step === questions.length - 1 ? finish() : setStep(step + 1))}
                  style={({ pressed }) => [styles.btn, styles.btnPrimary, styles.btnHalf, pressed && styles.pressed]}
                >
                  <Text style={styles.btnText}>{step === questions.length - 1 ? (saving ? "Saving…" : "Finish") : "Next ›"}</Text>
                </Pressable>
              </View>
            </ScrollView>
          ) : (
            /* recommendations */
            <ScrollView contentContainerStyle={styles.body}>
              <Text style={styles.emoji}>{MASCOTS[snark].emoji}</Text>
              <Text style={styles.title}>“{say("review_complete", snark)}”</Text>
              <Text style={styles.subTitle}>Two things worth doing:</Text>
              {recs.map((r, i) => (
                <View key={i} style={styles.recCard}>
                  <Text style={styles.recText}>💡 {r}</Text>
                </View>
              ))}
              <Pressable onPress={() => onClose(true)} style={({ pressed }) => [styles.btn, styles.btnPrimary, pressed && styles.pressed]}>
                <Text style={styles.btnText}>Done</Text>
              </Pressable>
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
    minHeight: "70%", maxHeight: "92%", padding: 22,
  },
  body: { alignItems: "stretch", paddingBottom: 30 },
  emoji: { fontSize: 52, textAlign: "center" },
  title: { color: "#fff", fontSize: 21, fontWeight: "800", textAlign: "center", marginTop: 8 },
  subTitle: { color: "#8b90a5", fontSize: 14, textAlign: "center", marginTop: 14, marginBottom: 6 },
  quote: { color: "#8b90a5", fontSize: 14, fontStyle: "italic", textAlign: "center", marginTop: 8 },
  statsCard: { backgroundColor: "#1c1f2e", borderRadius: 14, padding: 16, marginTop: 18 },
  statLine: { color: "#e8e9f0", fontSize: 15, marginBottom: 4 },
  statVal: { fontWeight: "800", color: "#fff" },
  statSmall: { color: "#8b90a5", fontSize: 13, marginTop: 3 },
  progress: { color: "#565b73", textAlign: "center", fontSize: 13 },
  question: { color: "#fff", fontSize: 18, fontWeight: "700", marginTop: 14, lineHeight: 25 },
  context: { color: "#8b90a5", fontSize: 13, marginTop: 8 },
  input: {
    backgroundColor: "#1c1f2e", borderRadius: 12, color: "#fff",
    padding: 14, fontSize: 15, minHeight: 110, textAlignVertical: "top", marginTop: 16,
  },
  row: { flexDirection: "row", gap: 10 },
  btn: { borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 14, backgroundColor: "#232636" },
  btnPrimary: { backgroundColor: "#7c83ff" },
  btnHalf: { flex: 1 },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  btnTextDim: { color: "#8b90a5", fontWeight: "600", fontSize: 14 },
  pressed: { opacity: 0.55, transform: [{ scale: 0.97 }] },
  recCard: { backgroundColor: "#1c1f2e", borderRadius: 12, padding: 14, marginTop: 10 },
  recText: { color: "#e8e9f0", fontSize: 14, lineHeight: 21 },
});
