-- ============================================================================
-- JEI — Migration 14: anon read-only access for Google Sheets backup
-- Run in Supabase → SQL Editor
--
-- The free Apps Script backup calls Supabase using the public "anon" key
-- (no login). By default RLS only allows "authenticated" users to read.
-- This adds read-only policies for the anon role on the 4 tables that get
-- backed up. It does NOT expose shipment_costs or fx_rates (owner-only
-- financial data stays protected), and does NOT allow anon writes anywhere.
-- ============================================================================

create policy "anon read orders for backup"    on orders     for select to anon using (true);
create policy "anon read customers for backup" on customers  for select to anon using (true);
create policy "anon read shipments for backup" on shipments  for select to anon using (true);
create policy "anon read couriers for backup"  on couriers   for select to anon using (true);

-- To revoke this later (e.g. if you stop using the backup):
--   drop policy "anon read orders for backup" on orders;
--   drop policy "anon read customers for backup" on customers;
--   drop policy "anon read shipments for backup" on shipments;
--   drop policy "anon read couriers for backup" on couriers;
