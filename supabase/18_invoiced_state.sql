-- JEI — Migration 18: add invoiced state to orders
-- This creates an intermediate state between active (invoices tab) and completed (completed tab).
-- Flow: active → invoiced (Costs tab) → completed

alter table orders add column if not exists invoiced boolean default false;
alter table orders add column if not exists invoiced_at timestamptz;

-- cost_entries: link to order directly (not just shipment), store locked rates per order
alter table cost_entries add column if not exists order_id text references orders(id) on delete cascade;
alter table cost_entries add column if not exists cost_usd_rate numeric;
alter table cost_entries add column if not exists cost_sgd_rate numeric;
