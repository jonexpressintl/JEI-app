-- JEI — Migration 12: custom divisor + invoice extra costs + invoice FX rates
alter table orders add column if not exists divisor numeric default 5000;

-- Extra cost lines per invoice (order). Format: [{"label":"Handling fee","amount":50,"currency":"USD"}]
alter table orders add column if not exists extra_costs jsonb default '[]'::jsonb;

-- Per-invoice manual conversion rates (used only at invoice time)
alter table orders add column if not exists invoice_usd_rate numeric;
alter table orders add column if not exists invoice_sgd_rate numeric;
