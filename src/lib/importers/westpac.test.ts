// Run: npx tsx src/lib/importers/westpac.test.ts
import { parseWestpacCsv, looksLikeWestpac } from "./westpac";
import { dedupKey, dedupKeysForBatch } from "../ingest";

const SAMPLE = `Bank Account,Date,Narrative,Debit Amount,Credit Amount,Balance,Categories,Serial
032123456789,01/07/2026,"WOOLWORTHS 1234 SYDNEY NSW",84.35,,1523.10,,
032123456789,01/07/2026,"SALARY MILLS FREIGHT GROUP",,3200.00,4723.10,,
032123456789,02/07/2026,"BP EXPRESS ROZELLE, NSW",65.20,,4657.90,,
032123456789,03/07/2026,"TFR TO SAVINGS ACCT",500.00,,4157.90,,
`;

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error("FAIL:", msg); process.exit(1); }
  console.log("ok:", msg);
}

assert(looksLikeWestpac(SAMPLE.split("\n")[0]), "header detected as Westpac");

const rows = parseWestpacCsv(SAMPLE);
assert(rows.length === 4, `parsed 4 rows (got ${rows.length})`);
assert(rows[0].amount_cents === -8435, `groceries is -8435c (got ${rows[0].amount_cents})`);
assert(rows[1].amount_cents === 320000, `salary is +320000c (got ${rows[1].amount_cents})`);
assert(rows[0].posted_at === "2026-07-01", `date converts to ISO (got ${rows[0].posted_at})`);
assert(rows[2].description.includes("BP EXPRESS ROZELLE, NSW"), "quoted comma survives");
assert(rows[3].balance_cents === 415790, `balance parsed (got ${rows[3].balance_cents})`);

const k1 = dedupKey("acct-1", rows[0]);
const k2 = dedupKey("acct-1", { ...rows[0], description: "woolworths  1234   sydney nsw" });
assert(k1 === k2, "dedup key stable across formatting differences");
const k3 = dedupKey("acct-1", rows[1]);
assert(k1 !== k3, "different txns get different keys");

// identical same-day purchases must not collide within a batch
const twin = [rows[0], { ...rows[0] }];
const keys = dedupKeysForBatch("acct-1", twin);
assert(keys[0] !== keys[1], "identical same-day twins get distinct keys");
assert(keys[0] === k1, "first twin keeps the legacy key format");
const keysAgain = dedupKeysForBatch("acct-1", twin);
assert(keys.join() === keysAgain.join(), "batch keys are deterministic on re-import");

console.log("\nAll Westpac importer tests passed.");
