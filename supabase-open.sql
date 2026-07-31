-- ============================================================================
-- COMP Voucher — reopen the database to the anon key (NO login required)
-- ============================================================================
-- Inverse of supabase-auth.sql: removes "authenticated-only" policies and
-- restores open "anon" access, so the app works with just the anon key
-- embedded in the client (no sign-in). Safe to run regardless of current
-- state — drops either policy set if present, then recreates the anon set.
-- This is the state the app ships in by default (supabase-schema.sql already
-- creates these anon policies) — you'd only re-run this after having run
-- supabase-auth.sql and wanting to revert.
--
-- NOTE: with these policies, anyone who has the site URL can read/write the
-- data (there is no password). Use only because this data is not sensitive
-- (matches the sibling Certificate Ledger app's security decision).

drop policy if exists auth_all_vouchers       on vouchers;
drop policy if exists auth_all_audit_log      on audit_log;
drop policy if exists auth_all_import_batches on import_batches;
drop policy if exists auth_all_meta           on meta;

drop policy if exists anon_all_vouchers       on vouchers;
drop policy if exists anon_all_audit_log      on audit_log;
drop policy if exists anon_all_import_batches on import_batches;
drop policy if exists anon_all_meta           on meta;

create policy anon_all_vouchers       on vouchers       for all to anon using (true) with check (true);
create policy anon_all_audit_log      on audit_log      for all to anon using (true) with check (true);
create policy anon_all_import_batches on import_batches for all to anon using (true) with check (true);
create policy anon_all_meta           on meta           for all to anon using (true) with check (true);
