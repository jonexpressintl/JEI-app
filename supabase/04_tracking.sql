-- ============================================================================
-- JEI — Migration 04: per-leg tracking numbers
-- Run in Supabase → SQL Editor after the earlier files. Safe on existing data.
-- ============================================================================
-- Each shipment can carry up to three tracking numbers — one per leg — because
-- the US->SG carrier and the SG->ID carrier are often different companies.
-- All are optional; a leg with no number simply shows nothing in the UI.

alter table shipments add column if not exists track_us_sg     text;
alter table shipments add column if not exists track_us_sg_carrier text;  -- e.g. 'fedex'
alter table shipments add column if not exists track_sg_id     text;
alter table shipments add column if not exists track_sg_id_carrier text;
alter table shipments add column if not exists track_id_cust   text;
alter table shipments add column if not exists track_id_cust_carrier text;

-- Give the sample data one realistic tracking number so the UI shows the feature
update shipments
  set track_us_sg = '7749 1234 5678', track_us_sg_carrier = 'fedex'
  where id = 'SHP-2401';
