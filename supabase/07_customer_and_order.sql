-- ============================================================================
-- JEI — Migration 07: customer profile + order-level pricing
-- Run in Supabase → SQL Editor after previous migrations.
-- ============================================================================

-- Customer profile fields (all optional, populated from order form or Customer tab)
alter table customers add column if not exists states text;
alter table customers add column if not exists shipping_mark text;
alter table customers add column if not exists contact_number text;
alter table customers add column if not exists address text;

-- Order-level fields
alter table orders add column if not exists order_date date default current_date;
alter table orders add column if not exists price_per_kg numeric default 0;
alter table orders add column if not exists sell_currency text default 'IDR';
