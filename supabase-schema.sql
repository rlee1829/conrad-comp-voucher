-- COMP Voucher — initial schema. Run once in your Supabase project's SQL Editor after creating
-- the project (Supabase → SQL Editor → New query → paste → Run).
--
-- Design: one JSONB blob per record (`data`) rather than per-column tables — matches how the app
-- already models records as loosely-shaped JS objects (F&B/Room/HR vouchers have different fields).
-- The app does all filtering/aggregation client-side; these tables are just durable + shared storage.
--
-- Security: RLS is enabled with OPEN policies (anon role, no login) — matches the sibling
-- Certificate Ledger app's decision (trusted internal users, not a real access-control boundary).
-- Run supabase-auth.sql later if you ever want to lock this down to a shared login instead.

create extension if not exists pgcrypto; -- gen_random_uuid()

create table if not exists vouchers (
  id uuid primary key default gen_random_uuid(),
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  data jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists import_batches (
  id uuid primary key default gen_random_uuid(),
  data jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists meta (
  key text primary key,
  data jsonb,
  updated_at timestamptz not null default now()
);

-- Keep updated_at current on every write to vouchers.
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_vouchers_updated_at on vouchers;
create trigger trg_vouchers_updated_at before update on vouchers
  for each row execute function set_updated_at();

drop trigger if exists trg_meta_updated_at on meta;
create trigger trg_meta_updated_at before update on meta
  for each row execute function set_updated_at();

-- Realtime: only the tables operators actively collaborate on live. audit_log/import_batches are
-- refetched on-demand when their views open (same pattern as the Certificate Ledger app).
alter publication supabase_realtime add table vouchers;
alter publication supabase_realtime add table meta;

-- RLS: enable + open anon policies on all four tables.
alter table vouchers enable row level security;
alter table audit_log enable row level security;
alter table import_batches enable row level security;
alter table meta enable row level security;

drop policy if exists anon_all_vouchers on vouchers;
create policy anon_all_vouchers on vouchers for all to anon using (true) with check (true);

drop policy if exists anon_all_audit_log on audit_log;
create policy anon_all_audit_log on audit_log for all to anon using (true) with check (true);

drop policy if exists anon_all_import_batches on import_batches;
create policy anon_all_import_batches on import_batches for all to anon using (true) with check (true);

drop policy if exists anon_all_meta on meta;
create policy anon_all_meta on meta for all to anon using (true) with check (true);
