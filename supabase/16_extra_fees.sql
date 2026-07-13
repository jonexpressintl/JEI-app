-- JEI — Migration 16: per-leg weight basis + multi-line extra fees in orders
-- Run in Supabase → SQL Editor

-- Multi-line additional costs in the order form
-- Format: [{"label":"Clearance fee","amount":36,"currency":"SGD"}, ...]
alter table orders add column if not exists order_extra_fees jsonb default '[]'::jsonb;

-- Per-leg weight basis selection for Air+Sea breakdown
-- 'volumetric' | 'actual' | 'charged' (default: charged = greater-of)
alter table orders add column if not exists air_weight_basis text default 'charged';
alter table orders add column if not exists sea_weight_basis text default 'charged';

-- Date when an order/shipment was completed (for Completed tab sorting)
alter table orders add column if not exists completed_at timestamptz;
