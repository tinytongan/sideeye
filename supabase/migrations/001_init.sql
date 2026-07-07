-- SideEye · 001_init.sql
-- Unified ingestion data model. All money values are integer cents (AUD).

create extension if not exists "uuid-ossp";

-- ── Accounts ────────────────────────────────────────────────
create type account_kind as enum ('transaction','savings','credit','loan','super','investment','cash');
create type data_source as enum ('basiq','csv','manual','sharesight');

create table accounts (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  institution text,                      -- 'Westpac', 'AustralianSuper', ...
  kind account_kind not null default 'transaction',
  source data_source not null default 'manual',
  external_id text,                      -- Basiq account id, etc.
  currency text not null default 'AUD',
  balance_cents bigint,                  -- last known balance
  balance_as_of timestamptz,
  include_in_net_worth boolean not null default true,
  overdraft_limit_cents bigint default 0,
  created_at timestamptz not null default now(),
  unique (source, external_id)
);

-- ── Categories (AU taxonomy seeded in seed.sql) ─────────────
create table categories (
  id uuid primary key default uuid_generate_v4(),
  name text not null unique,
  parent_id uuid references categories(id),
  emoji text,
  is_income boolean not null default false,
  is_tax_relevant boolean not null default false,  -- default flag hint for deductions
  sort int not null default 0
);

-- ── Transactions (the one table all sources land in) ────────
create type txn_status as enum ('posted','pending');

create table transactions (
  id uuid primary key default uuid_generate_v4(),
  account_id uuid not null references accounts(id),
  posted_at date not null,
  description text not null,             -- raw bank string
  merchant text,                          -- cleaned merchant name
  amount_cents bigint not null,           -- negative = spend, positive = income
  status txn_status not null default 'posted',
  source data_source not null,
  external_id text,                       -- for dedup vs Basiq
  dedup_hash text not null,               -- sha256(account, date, amount, normalised desc)
  category_id uuid references categories(id),
  category_confidence real,               -- 0..1 from rules engine; null = user-set
  needs_review boolean not null default false,  -- feeds the categorisation queue
  tax_flag boolean not null default false,
  tax_note text,
  notes text,
  created_at timestamptz not null default now(),
  unique (dedup_hash)
);
create index idx_txn_posted on transactions (posted_at desc);
create index idx_txn_category on transactions (category_id);
create index idx_txn_review on transactions (needs_review) where needs_review;
create index idx_txn_tax on transactions (tax_flag) where tax_flag;

-- ── Receipts / tax invoices ─────────────────────────────────
create table receipts (
  id uuid primary key default uuid_generate_v4(),
  transaction_id uuid not null references transactions(id) on delete cascade,
  storage_path text not null,             -- Supabase Storage object
  mime_type text not null,
  uploaded_at timestamptz not null default now()
);

-- ── Categorisation rules (learned from corrections) ─────────
create table category_rules (
  id uuid primary key default uuid_generate_v4(),
  match_type text not null default 'contains',   -- contains | exact | regex
  pattern text not null,
  category_id uuid not null references categories(id),
  priority int not null default 100,
  learned_from uuid references transactions(id), -- correction that created it
  created_at timestamptz not null default now()
);

-- ── Budgets (monthly envelopes) ─────────────────────────────
create table budgets (
  id uuid primary key default uuid_generate_v4(),
  category_id uuid not null references categories(id),
  month date not null,                    -- first of month
  limit_cents bigint not null,
  unique (category_id, month)
);

-- ── Savings goals ───────────────────────────────────────────
create table goals (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  emoji text,
  target_cents bigint not null,
  target_date date,
  linked_account_id uuid references accounts(id),  -- balance tracks goal
  manual_progress_cents bigint default 0,          -- if not account-linked
  achieved_at timestamptz,
  created_at timestamptz not null default now()
);

-- ── Net worth snapshots (daily, from edge function) ─────────
create table net_worth_snapshots (
  snapshot_date date primary key,
  assets_cents bigint not null,
  liabilities_cents bigint not null
);

-- ── Weekly/monthly reviews ──────────────────────────────────
create type review_kind as enum ('weekly','monthly');

create table review_sessions (
  id uuid primary key default uuid_generate_v4(),
  kind review_kind not null,
  period_start date not null,
  period_end date not null,
  completed_at timestamptz,
  answers jsonb not null default '[]',    -- [{question_id, question, answer}]
  recommendations jsonb not null default '[]',
  unique (kind, period_start)
);

-- ── Gamification ────────────────────────────────────────────
create table achievements (
  id text primary key,                    -- 'receipt_goblin_50'
  unlocked_at timestamptz
);

create table streaks (
  id text primary key,                    -- 'weekly_review' | 'under_budget'
  current int not null default 0,
  best int not null default 0,
  last_incremented date
);

-- ── App settings ────────────────────────────────────────────
create table settings (
  key text primary key,                   -- 'snark_level' = quokka|wombat|bin_chicken|tassie_devil
  value jsonb not null
);
insert into settings (key, value) values ('snark_level', '"wombat"');
