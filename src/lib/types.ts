// Domain types mirroring supabase/migrations/001_init.sql
// Money is always integer cents (AUD).

export type AccountKind =
  | "transaction" | "savings" | "credit" | "loan"
  | "super" | "investment" | "cash";

export type DataSource = "basiq" | "csv" | "manual" | "sharesight";

export interface Account {
  id: string;
  name: string;
  institution: string | null;
  kind: AccountKind;
  source: DataSource;
  external_id: string | null;
  currency: string;
  balance_cents: number | null;
  balance_as_of: string | null;
  include_in_net_worth: boolean;
  overdraft_limit_cents: number;
}

export interface Category {
  id: string;
  name: string;
  parent_id: string | null;
  emoji: string | null;
  is_income: boolean;
  is_tax_relevant: boolean;
  sort: number;
}

export interface Transaction {
  id: string;
  account_id: string;
  posted_at: string; // ISO date
  description: string;
  merchant: string | null;
  amount_cents: number; // negative = spend
  status: "posted" | "pending";
  source: DataSource;
  external_id: string | null;
  dedup_hash: string;
  category_id: string | null;
  category_confidence: number | null;
  needs_review: boolean;
  tax_flag: boolean;
  tax_note: string | null;
  notes: string | null;
}

export interface Receipt {
  id: string;
  transaction_id: string;
  storage_path: string;
  mime_type: string;
  uploaded_at: string;
}

export interface Budget {
  id: string;
  category_id: string;
  month: string; // first of month, ISO date
  limit_cents: number;
}

export interface Goal {
  id: string;
  name: string;
  emoji: string | null;
  target_cents: number;
  target_date: string | null;
  linked_account_id: string | null;
  manual_progress_cents: number;
  achieved_at: string | null;
}

export interface NetWorthSnapshot {
  snapshot_date: string;
  assets_cents: number;
  liabilities_cents: number;
}

export interface ReviewSession {
  id: string;
  kind: "weekly" | "monthly";
  period_start: string;
  period_end: string;
  completed_at: string | null;
  answers: { question_id: string; question: string; answer: string }[];
  recommendations: string[];
}

export const centsToAud = (cents: number): string =>
  (cents / 100).toLocaleString("en-AU", { style: "currency", currency: "AUD" });
