-- ============================================================
-- JEI — COMPLETE DATABASE SETUP (all migrations combined)
-- Paste this entire file into Supabase SQL Editor and click RUN.
-- Creates tables, sample data, status tracks, tracking, and
-- per-user login passcodes.
-- ============================================================

-- ══════════════════════════════════════════════════════════════
-- PHASE 1: ALL SCHEMA (tables + columns + functions)
-- ══════════════════════════════════════════════════════════════

-- ── 01: core tables ──
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
  stage      text not null default 'Package received in US',
  eta_id     date,                     -- ETA Indonesia
  payment    text not null default 'Unpaid',
  stage_updated_at    timestamptz default now(),
  payment_updated_at  timestamptz default now(),
  track_us_sg          text,
  track_us_sg_carrier  text,
  track_sg_id          text,
  track_sg_id_carrier  text,
  track_id_cust        text,
  track_id_cust_carrier text,
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

-- ── 03: add payment + stage timestamp columns ──
do $$ begin
  create type payment_status as enum ('Unpaid', 'Invoiced', 'Paid');
exception when duplicate_object then null; end $$;

alter table shipments
  add column if not exists payment payment_status not null default 'Unpaid';
alter table shipments
  add column if not exists stage_updated_at timestamptz default now();
alter table shipments
  add column if not exists payment_updated_at timestamptz default now();

-- ── 04: per-leg tracking number columns ──
alter table shipments add column if not exists track_us_sg     text;
alter table shipments add column if not exists track_us_sg_carrier text;
alter table shipments add column if not exists track_sg_id     text;
alter table shipments add column if not exists track_sg_id_carrier text;
alter table shipments add column if not exists track_id_cust   text;
alter table shipments add column if not exists track_id_cust_carrier text;

-- ── 06: per-user login passcodes ──
create extension if not exists pgcrypto;

alter table profiles add column if not exists pass_hash text;

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

create or replace function my_passcode_set()
returns boolean
language sql
security definer
stable
as $$
  select pass_hash is not null from profiles where id = auth.uid();
$$;

-- clean up legacy single-owner passcode if it exists
drop function if exists set_owner_passcode(text);
drop function if exists verify_owner_passcode(text);
drop table if exists owner_secret;


-- ══════════════════════════════════════════════════════════════
-- PHASE 2: ESSENTIAL CONFIGURATION (no sample data)
-- Safe to re-run: clears any partial data from a previous attempt.
-- ══════════════════════════════════════════════════════════════

truncate orders, shipments, customers, couriers, fx_rates cascade;

-- Couriers (required config — the app needs these to create shipments and
-- calculate volumetric weight). Edit divisors here if your rates differ.
insert into couriers (id, name, divisor) values
  ('fedex', 'FedEx',   5000),
  ('dhl',   'DHL',     6000),
  ('sea',   'Sea LCL', 6000);

-- FX rates (required — used for cost conversion). Update these from
-- the app once you're live; these are reasonable starting values.
insert into fx_rates (id, usd_idr, sgd_idr) values (1, 15850, 11900);
