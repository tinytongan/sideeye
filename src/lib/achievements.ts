// Achievement definitions + persistent unlock tracking with celebrations.
import { supabase } from "./supabase";

export interface AchievementDef {
  id: string;
  emoji: string;
  name: string;
  desc: string;
  target: number;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: "first_review", emoji: "🎓", name: "Self-Aware", desc: "Complete your first review", target: 1 },
  { id: "review_streak_4", emoji: "🔥", name: "The Streak", desc: "4 reviews in a row", target: 4 },
  { id: "receipt_first", emoji: "📎", name: "Paper Trail", desc: "Attach your first receipt", target: 1 },
  { id: "receipt_goblin", emoji: "🧾", name: "Receipt Goblin", desc: "File 50 receipts", target: 50 },
  { id: "tax_hawk", emoji: "🦅", name: "Tax Hawk", desc: "Flag 20 transactions for tax", target: 20 },
  { id: "categoriser_100", emoji: "🗂️", name: "The Librarian", desc: "Clear 100 from the review queue", target: 100 },
  { id: "budget_setter", emoji: "🧮", name: "Envelope Pusher", desc: "Set 5 budgets", target: 5 },
  { id: "combo_10", emoji: "🔥", name: "Combo Machine", desc: "Hit a ×10 sorting combo", target: 10 },
  { id: "rush_15", emoji: "⚡", name: "Speed Demon", desc: "Sort 15 in one Rush round", target: 15 },
  { id: "points_5k", emoji: "⭐", name: "High Roller", desc: "Earn 5,000 sort points", target: 5000 },
];

export interface AchievementState extends AchievementDef {
  progress: number;
  unlocked: boolean;
}

export async function computeAchievements(): Promise<AchievementState[]> {
  const [receipts, reviews, tax, streaks, categorised, budgets, gameSettings] = await Promise.all([
    supabase.from("receipts").select("id", { count: "exact", head: true }),
    supabase.from("review_sessions").select("id", { count: "exact", head: true }).not("completed_at", "is", null),
    supabase.from("transactions").select("id", { count: "exact", head: true }).eq("tax_flag", true),
    supabase.from("streaks").select("id, best"),
    supabase.from("transactions").select("id", { count: "exact", head: true }).eq("needs_review", false).not("category_confidence", "is", null),
    supabase.from("budgets").select("id", { count: "exact", head: true }),
    supabase.from("settings").select("key, value").in("key", ["best_combo", "rush_best", "sort_points"]),
  ]);
  const gameVal = (k: string) => {
    const row = (gameSettings.data ?? []).find((s) => s.key === k);
    return typeof row?.value === "number" ? row.value : 0;
  };
  const bestReview = (streaks.data ?? []).find((s) => s.id === "weekly_review")?.best ?? 0;
  const progressOf: Record<string, number> = {
    first_review: reviews.count ?? 0,
    review_streak_4: bestReview,
    receipt_first: receipts.count ?? 0,
    receipt_goblin: receipts.count ?? 0,
    tax_hawk: tax.count ?? 0,
    categoriser_100: categorised.count ?? 0,
    budget_setter: budgets.count ?? 0,
    combo_10: gameVal("best_combo"),
    rush_15: gameVal("rush_best"),
    points_5k: gameVal("sort_points"),
  };
  return ACHIEVEMENTS.map((a) => ({
    ...a,
    progress: progressOf[a.id] ?? 0,
    unlocked: (progressOf[a.id] ?? 0) >= a.target,
  }));
}

/** Persist newly earned unlocks; returns only the NEW ones (for celebration). */
export async function syncNewUnlocks(): Promise<AchievementState[]> {
  const [states, stored] = await Promise.all([
    computeAchievements(),
    supabase.from("achievements").select("id").not("unlocked_at", "is", null),
  ]);
  const already = new Set((stored.data ?? []).map((s) => s.id));
  const fresh = states.filter((s) => s.unlocked && !already.has(s.id));
  if (fresh.length > 0) {
    await supabase.from("achievements").upsert(
      fresh.map((f) => ({ id: f.id, unlocked_at: new Date().toISOString() }))
    );
  }
  return fresh;
}
