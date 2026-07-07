// Sort Rush scoring + persistence.
import { supabase } from "./supabase";
import type { SnarkLevel } from "../personality/copy";

export const COMBO_WINDOW_MS = 7000;

export function scoreFor(combo: number, cleared: number): number {
  return 10 + Math.min(combo, 10) * 2 + cleared * 5;
}

async function getNum(key: string): Promise<number> {
  const { data } = await supabase.from("settings").select("value").eq("key", key).maybeSingle();
  return typeof data?.value === "number" ? data.value : 0;
}
async function setNum(key: string, v: number): Promise<void> {
  await supabase.from("settings").upsert({ key, value: v as unknown as object });
}

export async function loadGameStats() {
  const [points, bestCombo, rushBest] = await Promise.all([
    getNum("sort_points"), getNum("best_combo"), getNum("rush_best"),
  ]);
  return { points, bestCombo, rushBest };
}

export async function saveGameStats(s: { points?: number; bestCombo?: number; rushBest?: number }) {
  const jobs: Promise<void>[] = [];
  if (s.points !== undefined) jobs.push(setNum("sort_points", s.points));
  if (s.bestCombo !== undefined) jobs.push(setNum("best_combo", s.bestCombo));
  if (s.rushBest !== undefined) jobs.push(setNum("rush_best", s.rushBest));
  await Promise.all(jobs);
}

/** Combo-milestone reactions, per mascot. */
export const REACTIONS: Record<SnarkLevel, Record<number, string>> = {
  quokka: {
    3: "Three in a row! You're basically an accountant! 😊",
    5: "Five! The spreadsheet fears you! 😊",
    8: "Eight!! Are you okay?? Don't stop! 😊",
    12: "TWELVE. I've never been so proud. Technically.",
  },
  wombat: {
    3: "Three. Adequate.",
    5: "Five straight. Hm. Continue.",
    8: "Eight. You're... good at this. Weird.",
    12: "Twelve consecutive. Necessary AND impressive.",
  },
  bin_chicken: {
    3: "Three! Sorting trash like a professional. I'd know.",
    5: "Five straight — you'd survive a hard-waste collection day.",
    8: "Eight?! Save some rubbish for the rest of us.",
    12: "Twelve. The bin bows to you.",
  },
  tassie_devil: {
    3: "THREE. MORE.",
    5: "FIVE. FASTER.",
    8: "EIGHT!!! UNSTOPPABLE!!!",
    12: "TWELVE. I HAVE NO MORE RAGE. ONLY RESPECT.",
  },
};

export const RUSH_SECONDS = 60;
