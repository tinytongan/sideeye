// SideEye personality engine — copy packs.
// Every user-facing moment has one line per mascot. Add lines, not logic.

export type SnarkLevel = "quokka" | "wombat" | "bin_chicken" | "tassie_devil";

const VALID_LEVELS = new Set(["quokka", "wombat", "bin_chicken", "tassie_devil"]);

/** Coerce anything (incl. corrupted persisted values like '"quokka"') to a
 * valid SnarkLevel. The app must NEVER crash on a bad stored setting. */
export function asSnark(v: unknown): SnarkLevel {
  if (typeof v === "string") {
    const cleaned = v.replace(/["\\]/g, "").trim();
    if (VALID_LEVELS.has(cleaned)) return cleaned as SnarkLevel;
  }
  return "wombat";
}

export type CopyEvent =
  | "greeting_morning"
  | "overdraft_warning"
  | "overdraft_critical"
  | "budget_pace_bad" // {category} {pct_month} {pct_budget}
  | "budget_blown" // {category}
  | "categorise_queue" // {count}
  | "big_purchase" // {merchant} {amount}
  | "review_prompt_weekly"
  | "review_complete"
  | "goal_milestone" // {goal} {pct}
  | "streak_broken" // {streak}
  | "no_spend_day"
  | "tax_receipt_saved";

export const MASCOTS: Record<SnarkLevel, { name: string; emoji: string; tagline: string }> = {
  quokka: { name: "Quokka", emoji: "😊", tagline: "So supportive. Technically." },
  wombat: { name: "Judgy Wombat", emoji: "🪨", tagline: "Necessary, or absolutely not." },
  bin_chicken: { name: "Bin Chicken", emoji: "🗑️", tagline: "Dumpster-certified financial expert." },
  tassie_devil: { name: "Tassie Devil", emoji: "🌪️", tagline: "WHY." },
};

// {placeholders} are interpolated by say(); pick is random per event.
export const COPY: Record<CopyEvent, Record<SnarkLevel, string[]>> = {
  greeting_morning: {
    quokka: ["Good morning! Your money is still here. Most of it. 😊", "A brand new day to almost stick to the budget! 😊"],
    wombat: ["Morning. Don't buy anything stupid.", "Awake? Good. Spend nothing."],
    bin_chicken: ["Rise and shine. I've already been through your statements. And a bin.", "Morning! Today's forecast: financial decisions I'll be judging."],
    tassie_devil: ["IT'S A NEW DAY. DO NOT RUIN IT.", "AWAKE? GOOD. THE BUDGET IS WATCHING."],
  },
  overdraft_warning: {
    quokka: ["Heads up! Your account is looking… cosy. Only ${days} days of buffer left! 😊", "Your balance is doing its best! Its best is ${balance}. 😊"],
    wombat: ["Account's getting low. Recurring bills incoming. Fix it.", "${balance} left, ${upcoming} in bills due. You can do the maths."],
    bin_chicken: ["Your balance is approaching bin-diving territory. I'd know. ${balance} left.", "I've seen healthier balances on a parking meter. ${upcoming} in bills coming."],
    tassie_devil: ["BALANCE LOW. BILLS COMING. ${balance}. MOVE MONEY. NOW.", "OVERDRAFT APPROACHING. THIS IS NOT A DRILL."],
  },
  overdraft_critical: {
    quokka: ["Sooo… your account might go negative tomorrow! Exciting! 😊 (Transfer money. Please.)"],
    wombat: ["Going negative tomorrow unless you transfer. No."],
    bin_chicken: ["Tomorrow your account joins me in the bin. Transfer ${needed} tonight."],
    tassie_devil: ["NEGATIVE. BALANCE. TOMORROW. TRANSFER ${needed} IMMEDIATELY."],
  },
  budget_pace_bad: {
    quokka: ["You're ${pct_month}% through the month and ${pct_budget}% through the {category} budget! Bold! 😊"],
    wombat: ["{category}: ${pct_budget}% gone, month ${pct_month}% done. We're not buying more."],
    bin_chicken: ["{category} budget's ${pct_budget}% gone at ${pct_month}% of the month. That's not budgeting. That's performance art."],
    tassie_devil: ["{category}. ${pct_budget}%. EXPLAIN YOURSELF."],
  },
  budget_blown: {
    quokka: ["The {category} budget is done for the month! You did that! 😊 Progress."],
    wombat: ["{category} budget: blown. Everything else this month: absolutely not."],
    bin_chicken: ["{category} budget's cooked. I've found better restraint in a shopping centre car park."],
    tassie_devil: ["{category}. BLOWN. WHY. WHY. WHY."],
  },
  categorise_queue: {
    quokka: ["{count} little transactions would love to know what they are! 😊"],
    wombat: ["{count} uncategorised. Sort them."],
    bin_chicken: ["{count} mystery transactions. I don't even eat mysteries this vague."],
    tassie_devil: ["{count} UNCATEGORISED. UNACCEPTABLE."],
  },
  big_purchase: {
    quokka: ["Ooh, ${amount} at {merchant}! You only live once! Repeatedly, apparently. 😊"],
    wombat: ["${amount} at {merchant}. You already own three."],
    bin_chicken: ["${amount} at {merchant}? You paid full price? Amateur."],
    tassie_devil: ["${amount}. {merchant}. WHY."],
  },
  review_prompt_weekly: {
    quokka: ["Weekly review time! Let's celebrate everything you *almost* didn't buy! 😊"],
    wombat: ["Weekly review. Five minutes. Sit."],
    bin_chicken: ["Weekly review. Bring answers. I've already been through the receipts. Literally."],
    tassie_devil: ["REVIEW TIME. NOW. BRING EXCUSES."],
  },
  review_complete: {
    quokka: ["Review done! Look at you, being accountable! Technically. 😊"],
    wombat: ["Done. Acceptable. See you next week."],
    bin_chicken: ["Review complete. There's hope for you yet. Not much. Some."],
    tassie_devil: ["REVIEW COMPLETE. RAGE… SUBSIDING."],
  },
  goal_milestone: {
    quokka: ["{goal} is {pct}% funded! You only spent slightly more than you saved! 😊"],
    wombat: ["{goal}: {pct}%. Keep going. Necessary."],
    bin_chicken: ["{goal} at {pct}%. Even I'm impressed, and my standards are in a bin."],
    tassie_devil: ["{goal}. {pct}%. YES. MORE. FASTER."],
  },
  streak_broken: {
    quokka: ["Your {streak} streak ended! Starting over is basically a fresh achievement! 😊"],
    wombat: ["{streak} streak: dead. Disappointing."],
    bin_chicken: ["{streak} streak's in the bin. Scooch over, streak."],
    tassie_devil: ["THE {streak} STREAK. GONE. I NEED A MINUTE."],
  },
  no_spend_day: {
    quokka: ["A whole day with zero spending! The economy fears you! 😊"],
    wombat: ["No spending today. Correct."],
    bin_chicken: ["Zero dollars spent. Welcome to my lifestyle. The scraps are lovely."],
    tassie_devil: ["NO SPENDING. TODAY WAS A GOOD DAY."],
  },
  tax_receipt_saved: {
    quokka: ["Receipt filed! Future-you at tax time says thanks! 😊"],
    wombat: ["Receipt saved. Deduction secured. Necessary."],
    bin_chicken: ["Receipt safely stored — and NOT in a bin. Growth, for both of us."],
    tassie_devil: ["RECEIPT. FILED. THE ATO CANNOT STOP US."],
  },
};

export function say(
  event: CopyEvent,
  level: SnarkLevel,
  vars: Record<string, string | number> = {}
): string {
  const lines = COPY[event][level];
  let line = lines[Math.floor(Math.random() * lines.length)];
  for (const [k, v] of Object.entries(vars)) {
    line = line.replaceAll(`{${k}}`, String(v)).replaceAll(`\${${k}}`, `$${v}`);
  }
  return line;
}
