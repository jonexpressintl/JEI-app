-- ============================================================
-- JEI — COMPLETE DATABASE SETUP (all migrations combined)
-- Paste this entire file into Supabase SQL Editor and click RUN.
-- Creates tables, sample data, status tracks, tracking, and
-- per-user login passcodes. Each user sets their passcode on
-- first login (no need to edit this file).
-- ============================================================

-- ============================================================================
-- JON EXPRESS INTERNATIONAL (JEI) — Database schema
-- Run this in Supabase → SQL Editor (paste the whole file, click RUN).
-- ============================================================================
-- Design notes:
--   • Orders, shipments, customers, couriers are separate tables (not one
--     flat sheet) so consolidation + cost allocation work cleanly.
--   • A `profiles` table holds each user's role (owner | admin).
--   • Row-Level Security (RLS) enforces the visibility split AT THE DATABASE.
--     Angie (admin) literally cannot SELECT cost/margin columns, even if the
--     frontend were bypassed. This is the real protection — UI hiding is not.
-- ============================================================================

-- ---------- 1. ROLES & PROFILES --------------------------------------------
-- Supabase ships an auth.users table. We mirror each user into `profiles`
-- with a role so our app logic can branch on owner vs admin.

create type user_role as enum ('owner', 'admin');

create table profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text,
  role       user_role not null default 'admin',
  created_at timestamptz default now()
);

-- Helper: is the current logged-in user an owner?
create or replace function is_owner()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'owner'
  );
$$;

-- ---------- 2. COURIERS (carry their own volumetric divisor) ---------------
create table couriers (
  id        text primary key,          -- e.g. 'fedex'
  name      text not null,             -- 'FedEx'
  divisor   integer not null,          -- 5000 or 6000 (cm3 per kg)
  created_at timestamptz default now()
);

-- ---------- 3. CUSTOMERS (owner sets a flat rate per kg manually) ----------
create table customers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  rate_per_kg numeric not null default 0,   -- IDR per chargeable kg
  notes       text,
  created_at  timestamptz default now()
);

-- ---------- 4. SHIPMENTS (the logistics unit moving US -> SG -> ID) --------
create table shipments (
  id         text primary key,         -- e.g. 'SHP-2401'
  courier_id text references couriers(id),
  stage      text not null default 'Ordered',
  eta_id     date,                     -- ETA Indonesia
  created_at timestamptz default now()
);

-- Cost lines belong to a shipment. MULTI-CURRENCY: amount + currency.
-- These rows are OWNER-ONLY (see RLS below).
create table shipment_costs (
  id          uuid primary key default gen_random_uuid(),
  shipment_id text references shipments(id) on delete cascade,
  label       text not null,           -- 'US freight', 'SG handling', ...
  amount      numeric not null,
  currency    text not null,           -- 'USD' | 'SGD' | 'IDR'
  created_at  timestamptz default now()
);

-- ---------- 5. ORDERS (the customer's unit) --------------------------------
-- An order belongs to ONE shipment; a shipment can hold MANY orders
-- (that's the consolidation). Physical dims stored in metric.
create table orders (
  id           text primary key,        -- e.g. 'ORD-1001'
  customer_id  uuid references customers(id),
  shipment_id  text references shipments(id),
  product      text not null,
  qty          integer not null default 1,
  weight_kg    numeric not null,        -- actual weight, metric
  dim_l_cm     numeric not null,
  dim_w_cm     numeric not null,
  dim_h_cm     numeric not null,
  sell_idr     numeric not null default 0,  -- revenue (OWNER-only via RLS)
  created_at   timestamptz default now()
);

-- ---------- 6. FX RATES (owner-editable; one row, latest wins) -------------
create table fx_rates (
  id        integer primary key default 1,
  usd_idr   numeric not null,
  sgd_idr   numeric not null,
  updated_at timestamptz default now(),
  constraint single_row check (id = 1)
);

-- ============================================================================
-- ROW-LEVEL SECURITY
-- ============================================================================
alter table profiles        enable row level security;
alter table couriers        enable row level security;
alter table customers       enable row level security;
alter table shipments       enable row level security;
alter table shipment_costs  enable row level security;
alter table orders          enable row level security;
alter table fx_rates        enable row level security;

-- profiles: a user can read their own profile (needed to learn their role)
create policy "read own profile" on profiles
  for select using (id = auth.uid());

-- Reference + operational tables: any logged-in user (owner OR admin) may read.
-- Both Merry and Angie need couriers, customers, shipments, orders to do their jobs.
create policy "auth read couriers"  on couriers   for select to authenticated using (true);
create policy "auth read customers" on customers  for select to authenticated using (true);
create policy "auth read shipments" on shipments  for select to authenticated using (true);
create policy "auth read orders"    on orders     for select to authenticated using (true);
create policy "auth read fx"        on fx_rates   for select to authenticated using (true);

-- THE KEY RULE: cost lines are OWNER-ONLY. Admin gets zero rows back.
create policy "owner read costs" on shipment_costs
  for select using (is_owner());

-- WRITES:
-- Both roles can manage customers (you said Angie can adjust pricing too),
-- orders, shipments, couriers. Only the owner can touch costs and FX.
create policy "auth write customers" on customers  for all to authenticated using (true) with check (true);
create policy "auth write orders"    on orders     for all to authenticated using (true) with check (true);
create policy "auth write shipments" on shipments  for all to authenticated using (true) with check (true);
create policy "auth write couriers"  on couriers   for all to authenticated using (true) with check (true);
create policy "owner write costs"    on shipment_costs for all using (is_owner()) with check (is_owner());
create policy "owner write fx"       on fx_rates   for all using (is_owner()) with check (is_owner());

-- ============================================================================
-- NOTE on sell_idr (revenue): RLS works on rows, not single columns. Because
-- revenue lives on the orders row (which admin must read for product/qty),
-- we hide revenue & margin in the APP layer for admin, and keep the truly
-- sensitive money — actual costs — fully walled off at the DB via the policy
-- above. If you later want revenue DB-enforced too, we split it into an
-- `order_financials` table. Flagging this as a known, deliberate tradeoff.
-- ============================================================================


-- ============================================================================
-- JEI — Seed data (run AFTER 01_schema.sql)
-- Safe to re-run: clears tables first.
-- ============================================================================
truncate orders, shipment_costs, shipments, customers, couriers, fx_rates restart identity cascade;

-- FX
insert into fx_rates (id, usd_idr, sgd_idr) values (1, 16250, 12050);

-- Couriers (divisor lives here, per your FedEx=5000 / others=6000 rule)
insert into couriers (id, name, divisor) values
  ('fedex', 'FedEx',   5000),
  ('dhl',   'DHL',     6000),
  ('sea',   'Sea LCL', 6000);

-- Customers (flat owner-set rate per kg in IDR)
insert into customers (id, name, rate_per_kg, notes) values
  ('11111111-1111-1111-1111-111111111111', 'PT Maju Jaya',  120000, 'Long-term account'),
  ('22222222-2222-2222-2222-222222222222', 'CV Sentosa',    135000, ''),
  ('33333333-3333-3333-3333-333333333333', 'PT Bumi Tekno', 105000, 'High volume'),
  ('44444444-4444-4444-4444-444444444444', 'PT Andalan',    128000, '');

-- Shipments (new checkpoint vocabulary + payment track)
insert into shipments (id, courier_id, stage, eta_id, payment) values
  ('SHP-2401', 'fedex', 'Received in SG',         '2026-06-18', 'Unpaid'),
  ('SHP-2402', 'dhl',   'Sent to ID',             '2026-06-14', 'Invoiced'),
  ('SHP-2403', 'fedex', 'Delivered to customer',  '2026-06-05', 'Paid'),
  ('SHP-2404', 'sea',   'Package received in US', '2026-06-25', 'Unpaid');

-- Shipment costs (multi-currency; owner-only)
insert into shipment_costs (shipment_id, label, amount, currency) values
  ('SHP-2401','US freight',1200,'USD'),('SHP-2401','SG handling',340,'SGD'),('SHP-2401','ID delivery',850000,'IDR'),
  ('SHP-2402','US freight',640,'USD'), ('SHP-2402','SG handling',180,'SGD'),('SHP-2402','ID delivery',400000,'IDR'),
  ('SHP-2403','US freight',980,'USD'), ('SHP-2403','SG handling',250,'SGD'),('SHP-2403','ID delivery',600000,'IDR'),
  ('SHP-2404','US freight',1500,'USD');

-- Orders (dims in cm, weight in kg)
insert into orders (id, customer_id, shipment_id, product, qty, weight_kg, dim_l_cm, dim_w_cm, dim_h_cm, sell_idr) values
  ('ORD-1001','11111111-1111-1111-1111-111111111111','SHP-2401','Industrial pumps',4,62,80,60,55,92000000),
  ('ORD-1002','22222222-2222-2222-2222-222222222222','SHP-2401','Valve assemblies',20,18,50,40,35,48000000),
  ('ORD-1003','33333333-3333-3333-3333-333333333333','SHP-2402','Bearings (bulk)',500,140,60,50,50,35000000),
  ('ORD-1004','44444444-4444-4444-4444-444444444444','SHP-2403','Control panels',6,48,90,70,60,78000000),
  ('ORD-1005','11111111-1111-1111-1111-111111111111','SHP-2404','Motors 3-phase',10,210,70,60,60,120000000),
  ('ORD-1006','22222222-2222-2222-2222-222222222222','SHP-2404','Sensor kits',50,9,55,45,40,26000000);


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


-- ============================================================================
-- JEI — Migration 06: per-user login passcode (second factor for everyone)
-- Run in Supabase → SQL Editor after the earlier files.
-- Replaces the single owner passcode (migration 05) with one passcode PER user.
-- ============================================================================
-- Each user (owner or admin) has their own passcode, stored hashed on their
-- profile row and verified by a database function so the secret never reaches
-- the browser. After entering email + password, each user enters their passcode.

create extension if not exists pgcrypto;

-- Add a hashed-passcode column to profiles (nullable until set).
alter table profiles add column if not exists pass_hash text;

-- Set / change the CURRENT user's own passcode. A user can only set their own.
create or replace function set_my_passcode(new_code text)
returns void
language plpgsql
security definer
as $$
begin
  update profiles set pass_hash = crypt(new_code, gen_salt('bf'))
  where id = auth.uid();
end;
$$;

-- Verify the current user's passcode candidate. Returns true/false only.
create or replace function verify_my_passcode(candidate text)
returns boolean
language plpgsql
security definer
as $$
declare ok boolean;
begin
  select pass_hash = crypt(candidate, pass_hash) into ok
  from profiles where id = auth.uid();
  return coalesce(ok, false);
end;
$$;

-- Does the current user have a passcode set yet? (drives first-time setup UI)
create or replace function my_passcode_set()
returns boolean
language sql
security definer
stable
as $$
  select pass_hash is not null from profiles where id = auth.uid();
$$;

-- ── Clean up the old single-owner passcode mechanism (migration 05) ──
drop function if exists set_owner_passcode(text);
drop function if exists verify_owner_passcode(text);
drop table if exists owner_secret;

-- ── OPTIONAL first-time passcodes ────────────────────────────────────────────
-- You can let each user set their own passcode on first login (the app prompts
-- them). OR seed initial ones here by email — change the codes, then run:
--
--   update profiles set pass_hash = crypt('CHANGE-ME-merry', gen_salt('bf'))
--   where id = (select id from auth.users where email = 'MERRY_EMAIL');
--
--   update profiles set pass_hash = crypt('CHANGE-ME-angie', gen_salt('bf'))
--   where id = (select id from auth.users where email = 'ANGIE_EMAIL');
--
-- If you skip this, each user is prompted to create their passcode on first login.
