// Westpac CSV importer.
// Standard Westpac online-banking export header:
//   Bank Account,Date,Narrative,Debit Amount,Credit Amount,Balance,Categories,Serial
// Dates are DD/MM/YYYY. Debit and Credit are separate positive columns.

import { audToCents, auDateToIso, splitCsvLine, type ParsedTxn } from "../ingest";

export interface WestpacRow extends ParsedTxn {
  bank_account: string; // e.g. "032xxx123456" — used to match/create the account
}

const EXPECTED = ["bank account", "date", "narrative", "debit amount", "credit amount", "balance"];

export function looksLikeWestpac(headerLine: string): boolean {
  const cols = splitCsvLine(headerLine).map((c) => c.trim().toLowerCase());
  return EXPECTED.every((e) => cols.includes(e));
}

export function parseWestpacCsv(content: string): WestpacRow[] {
  const lines = content.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]).map((c) => c.trim().toLowerCase());
  if (!looksLikeWestpac(lines[0])) {
    throw new Error(`Not a Westpac export. Header was: ${lines[0]}`);
  }
  const col = (name: string) => header.indexOf(name);
  const iAcct = col("bank account");
  const iDate = col("date");
  const iNarr = col("narrative");
  const iDebit = col("debit amount");
  const iCredit = col("credit amount");
  const iBal = col("balance");

  const rows: WestpacRow[] = [];
  for (let n = 1; n < lines.length; n++) {
    const f = splitCsvLine(lines[n]);
    if (f.length < 6) continue; // trailing junk line
    const debit = audToCents(f[iDebit] ?? "");
    const credit = audToCents(f[iCredit] ?? "");
    // Westpac reports both as positive numbers; debit means money out.
    const amount_cents = credit - debit;
    if (amount_cents === 0 && !f[iNarr]?.trim()) continue;
    rows.push({
      bank_account: (f[iAcct] ?? "").trim(),
      posted_at: auDateToIso(f[iDate] ?? ""),
      description: (f[iNarr] ?? "").trim(),
      amount_cents,
      balance_cents: f[iBal]?.trim() ? audToCents(f[iBal]) : undefined,
    });
  }
  return rows;
}
