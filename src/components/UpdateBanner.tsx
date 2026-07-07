// Detects a newer deployed build and offers a one-tap refresh —
// no more mystery stale-cache sessions.
import { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text } from "react-native";
import { BUILD } from "../buildInfo";

export default function UpdateBanner() {
  const [newer, setNewer] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "web" || BUILD === "dev") return;
    let stop = false;
    const check = async () => {
      try {
        const r = await fetch(`/sideeye/version.json?cb=${Date.now()}`, { cache: "no-store" });
        const v = await r.json();
        if (!stop && v.build && v.build !== BUILD) setNewer(true);
      } catch { /* offline — try again later */ }
    };
    check();
    const onFocus = () => check();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    const t = setInterval(check, 5 * 60 * 1000);
    return () => {
      stop = true;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      clearInterval(t);
    };
  }, []);

  if (!newer) return null;
  return (
    <Pressable
      onPress={() => window.location.reload()}
      style={({ pressed }) => [styles.banner, pressed && { opacity: 0.7 }]}
    >
      <Text style={styles.text}>✨ New version of SideEye — tap to update</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: "absolute", top: 0, left: 0, right: 0,
    backgroundColor: "#7c83ff", paddingTop: 46, paddingBottom: 10,
    alignItems: "center", zIndex: 50,
  },
  text: { color: "#fff", fontWeight: "700", fontSize: 13 },
});
