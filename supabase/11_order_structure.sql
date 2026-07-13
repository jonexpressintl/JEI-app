-- ============================================================================
-- JEI — Migration 11: 4-step order structure
-- Run in Supabase → SQL Editor
-- ============================================================================

-- Step 1: Shipping information
alter table orders add column if not exists customer_type text default 'direct';  -- 'forwarder' or 'direct'
alter table orders add column if not exists supplier_name text;                    -- US-side sender
alter table orders add column if not exists country_origin text default 'USA';
alter table orders add column if not exists destination text default 'Indonesia';  -- 'Singapore' or 'Indonesia'

-- Step 2: Means of shipping
alter table orders add column if not exists shipping_us_sg text;  -- Airfreight/FedEx Priority/FedEx Economy/FedEx Freight/Seafreight
alter table orders add column if not exists shipping_sg_id text;  -- Airfreight/Seafreight

-- Step 3: Fee breakdown (auto-summed)
alter table orders add column if not exists fee_1 numeric default 0;           -- airfreight fee or seafreight 1
alter table orders add column if not exists fee_clearance numeric default 0;   -- clearance fee (middle leg)
alter table orders add column if not exists fee_2 numeric default 0;           -- seafreight fee (second leg)
alter table orders add column if not exists fee_additional numeric default 0;  -- additional cost

-- Step 4: Additional notes
alter table orders add column if not exists aes_required boolean default false;
alter table orders add column if not exists aes_details text;
alter table orders add column if not exists pickup_required boolean default false;
alter table orders add column if not exists pickup_details text;
alter table orders add column if not exists additional_info text;
