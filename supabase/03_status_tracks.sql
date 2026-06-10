-- ============================================================================
-- JEI — Migration 03: two-track status (logistics + payment)
-- Run this in Supabase → SQL Editor AFTER 01_schema.sql and 02_seed.sql.
-- Safe to run on an existing database; it only adds/updates.
-- ============================================================================

-- 1. Payment status track (separate from logistics stage on purpose)
do $$ begin
  create type payment_status as enum ('Unpaid', 'Invoiced', 'Paid');
exception when duplicate_object then null; end $$;

alter table shipments
  add column if not exists payment payment_status not null default 'Unpaid';

-- 2. Record WHEN the stage last changed (for "last updated" display)
alter table shipments
  add column if not exists stage_updated_at timestamptz default now();

-- 3. When payment last changed
alter table shipments
  add column if not exists payment_updated_at timestamptz default now();

-- 4. Re-point existing rows to the new checkpoint vocabulary.
--    Old prototype stages -> new JEI checkpoints.
update shipments set stage = 'Package received in US' where stage in ('Ordered','US Warehouse');
update shipments set stage = 'Sent from US'           where stage = 'In Transit US→SG';
update shipments set stage = 'Received in SG'          where stage = 'Singapore Hub';
update shipments set stage = 'Sent to ID'              where stage = 'In Transit SG→ID';
update shipments set stage = 'Received in ID'          where stage = 'Indonesia Customs';
update shipments set stage = 'Delivered to customer'   where stage = 'Delivered';

-- Give the seed data some realistic payment states so the UI isn't all "Unpaid"
update shipments set payment = 'Paid'      where stage = 'Delivered to customer';
update shipments set payment = 'Invoiced'  where stage = 'Received in ID';

-- NOTE: stage is a free-text column (not an enum) so you can rename checkpoints
-- later without a database migration. The app supplies the canonical list.
