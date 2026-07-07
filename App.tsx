import { useEffect, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./src/lib/supabase";
import DashboardScreen from "./src/screens/DashboardScreen";
import ReviewScreen from "./src/screens/ReviewScreen";
import BudgetScreen from "./src/screens/BudgetScreen";
import LoginScreen from "./src/screens/LoginScreen";
import ExportScreen from "./src/screens/ExportScreen";
import SettingsScreen from "./src/screens/SettingsScreen";
import CelebrationOverlay from "./src/components/CelebrationOverlay";
import { syncNewUnlocks, type AchievementState } from "./src/lib/achievements";
import { asSnark, type SnarkLevel } from "./src/personality/copy";
import ErrorBoundary from "./src/components/ErrorBoundary";
import UpdateBanner from "./src/components/UpdateBanner";

type Tab = "dashboard" | "review" | "budgets" | "export" | "settings";
const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: "dashboard", label: "Dashboard", icon: "📊" },
  { key: "review", label: "Review", icon: "👀" },
  { key: "budgets", label: "Budgets", icon: "🧮" },
  { key: "export", label: "Export", icon: "📤" },
  { key: "settings", label: "More", icon: "⚙️" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [unlocks, setUnlocks] = useState<AchievementState[]>([]);
  const [snark, setSnark] = useState<SnarkLevel>("wombat");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setChecking(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    supabase.from("settings").select("value").eq("key", "snark_level").maybeSingle()
      .then(({ data }) => { if (data?.value) setSnark(asSnark(data.value)); });
    syncNewUnlocks().then((fresh) => { if (fresh.length > 0) setUnlocks(fresh); });
  }, [session]);

  if (checking) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator />
        <StatusBar style="light" />
      </View>
    );
  }

  if (!session) {
    return (
      <>
        <LoginScreen />
        <StatusBar style="light" />
      </>
    );
  }

  return (
    <ErrorBoundary>
    <View style={styles.root}>
      <View style={styles.body}>
        {tab === "dashboard" && <DashboardScreen goSettings={() => setTab("settings")} />}
        {tab === "review" && <ReviewScreen />}
        {tab === "budgets" && <BudgetScreen />}
        {tab === "export" && <ExportScreen />}
        {tab === "settings" && <SettingsScreen />}
      </View>
      <View style={styles.tabbar}>
        {TABS.map((t) => (
          <Pressable key={t.key} style={styles.tab} onPress={() => setTab(t.key)}>
            <Text style={styles.tabIcon}>{t.icon}</Text>
            <Text style={[styles.tabLabel, tab === t.key && styles.tabActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
      {unlocks.length > 0 && (
        <CelebrationOverlay unlocks={unlocks} snark={snark} onDone={() => setUnlocks([])} />
      )}
      <UpdateBanner />
      <StatusBar style="light" />
    </View>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#14161f" },
  center: { alignItems: "center", justifyContent: "center" },
  body: { flex: 1 },
  tabbar: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#232636",
    backgroundColor: "#171923",
    paddingBottom: 18,
    paddingTop: 8,
  },
  tab: { flex: 1, alignItems: "center" },
  tabIcon: { fontSize: 20 },
  tabLabel: { color: "#565b73", fontSize: 11, marginTop: 2 },
  tabActive: { color: "#7c83ff", fontWeight: "700" },
});
