-- ============================================================================
-- JEI — Migration 09: multi-piece packages
-- Run in Supabase → SQL Editor
-- ============================================================================

-- Multi-piece: each order can have multiple packages, each with its own
-- weight and dimensions. Stored as JSONB array on the order.
-- Format: [{"weight":5,"l":30,"w":20,"h":15}, ...]
-- The existing weight_kg and dim_l/w/h_cm become the first package for
-- backward compatibility. New orders use the packages array.

alter table orders add column if not exists packages jsonb default '[]'::jsonb;

-- Add notes field for order-level notes
alter table orders add column if not exists notes text;

-- price_per_kg currency (USD or IDR)
alter table orders add column if not exists price_currency text default 'IDR';
