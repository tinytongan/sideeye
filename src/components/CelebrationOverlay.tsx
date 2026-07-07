import { useEffect, useState } from "react";
import { Animated, Image, Pressable, StyleSheet, Text } from "react-native";
import type { AchievementState } from "../lib/achievements";
import { MASCOTS, type SnarkLevel } from "../personality/copy";
import { MASCOT_ART } from "../personality/art";

const LINES: Record<SnarkLevel, string> = {
  quokka: "Look at you! An achiever! Technically. 😊",
  wombat: "Achievement unlocked. Acceptable work.",
  bin_chicken: "An achievement? In THIS economy? Respect.",
  tassie_devil: "YES. ACHIEVEMENT. MORE. NOW.",
};

export default function CelebrationOverlay({
  unlocks, snark, onDone,
}: { unlocks: AchievementState[]; snark: SnarkLevel; onDone: () => void }) {
  const [idx, setIdx] = useState(0);
  const [scale] = useState(() => new Animated.Value(0.3));
  const a = unlocks[idx];

  useEffect(() => {
    scale.setValue(0.3);
    Animated.spring(scale, { toValue: 1, useNativeDriver: false, friction: 4 }).start();
  }, [idx, scale]);

  if (!a) return null;
  return (
    <Pressable style={styles.backdrop} onPress={() => (idx < unlocks.length - 1 ? setIdx(idx + 1) : onDone())}>
      <Animated.View style={[styles.card, { transform: [{ scale }] }]}>
        <Text style={styles.burst}>✨🎉✨</Text>
        <Text style={styles.emoji}>{a.emoji}</Text>
        <Text style={styles.name}>{a.name}</Text>
        <Text style={styles.desc}>{a.desc}</Text>
        <Image source={MASCOT_ART[snark]} style={styles.art} />
        <Text style={styles.mascot}>“{LINES[snark]}”</Text>
        <Text style={styles.tap}>{idx < unlocks.length - 1 ? "tap for next" : "tap to dismiss"}</Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.75)", alignItems: "center", justifyContent: "center", zIndex: 99,
  },
  card: {
    backgroundColor: "#1c1f2e", borderRadius: 22, padding: 30, alignItems: "center",
    borderWidth: 2, borderColor: "#ffd43b", maxWidth: 320, margin: 24,
  },
  burst: { fontSize: 22 },
  emoji: { fontSize: 64, marginTop: 8 },
  name: { color: "#ffd43b", fontSize: 22, fontWeight: "800", marginTop: 10 },
  desc: { color: "#8b90a5", fontSize: 14, marginTop: 4, textAlign: "center" },
  art: { width: 72, height: 72, marginTop: 14 },
  mascot: { color: "#e8e9f0", fontSize: 14, fontStyle: "italic", marginTop: 8, textAlign: "center" },
  tap: { color: "#565b73", fontSize: 12, marginTop: 14 },
});
