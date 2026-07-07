// Ingestion core — every source (CSV, Basiq, manual) funnels through here.

export interface ParsedTxn {
  posted_at: string; // ISO date YYYY-MM-DD
  description: string; // raw string from source
  amount_cents: number; // negative = spend
  balance_cents?: number; // running balance if the source provides it
}

/** Collapse whitespace, uppercase, strip trailing reference noise so the
 * same transaction arriving via CSV and Basiq normalises identically. */
export function normaliseDescription(desc: string): string {
  return desc
    .toUpperCase()
    .replace(/\s+/g, " ")
    .replace(/[^A-Z0-9 ]/g, "")
    .trim();
}

/** Deterministic dedup key. Same account + date + amount + normalised
 * description = same transaction, regardless of source. `seq` distinguishes
 * genuinely identical same-day purchases; 0 emits no suffix so existing
 * keys stay valid. */
export function dedupKey(accountId: string, t: ParsedTxn, seq = 0): string {
  const base = [accountId, t.posted_at, t.amount_cents, normaliseDescription(t.description)].join("|");
  return seq > 0 ? `${base}|${seq}` : base;
}

/** Assign dedup keys to a batch, numbering repeats of identical txns within
 * the batch so none are lost. Deterministic given source file order. */
export function dedupKeysForBatch(accountId: string, rows: ParsedTxn[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const base = dedupKey(accountId, r);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return dedupKey(accountId, r, n);
  });
}

/** Parse an AUD money string ("1,234.56", "-12.00", "$5.20", "") to cents. */
export function audToCents(s: string): number {
  const cleaned = s.replace(/[$,\s]/g, "");
  if (cleaned === "" || cleaned === "-") return 0;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) throw new Error(`Unparseable amount: "${s}"`);
  return Math.round(n * 100);
}

/** DD/MM/YYYY → YYYY-MM-DD (Westpac and most AU bank exports). */
export function auDateToIso(s: string): string {
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) throw new Error(`Unparseable AU date: "${s}"`);
  const [, d, mo, y] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

/** Minimal CSV line splitter handling quoted fields with commas. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
