-- ============================================================================
-- COMP Voucher — lock the database to logged-in users only
-- Run this in Supabase → SQL Editor AFTER you have created a shared login user
-- (Authentication → Users → Add user, with "Auto Confirm User" ON).
-- ============================================================================
-- Replaces the open "anon" policies with "authenticated"-only policies, so the
-- anon key alone can no longer read/write — a valid login session is required.
-- NOT wired up in the app yet (no login UI exists) — kept for parity with the
-- sibling Certificate Ledger app in case this is needed later.

drop policy if exists anon_all_vouchers       on vouchers;
drop policy if exists anon_all_audit_log      on audit_log;
drop policy if exists anon_all_import_batches on import_batches;
drop policy if exists anon_all_meta           on meta;

create policy auth_all_vouchers       on vouchers       for all to authenticated using (true) with check (true);
create policy auth_all_audit_log      on audit_log      for all to authenticated using (true) with check (true);
create policy auth_all_import_batches on import_batches for all to authenticated using (true) with check (true);
create policy auth_all_meta           on meta           for all to authenticated using (true) with check (true);
