-- JEI — Migration 17: cost entries table
-- Stores operational costs (shipping costs, handling fees, etc.)
-- linked to completed shipments, subtracted from revenue in Finance tab.

create table if not exists cost_entries (
  id            text primary key default ('COST-' || to_char(now(),'YYYYMMDD-HH24MISS') || '-' || floor(random()*9000+1000)::text),
  shipment_id   text references shipments(id) on delete set null,
  label         text not null,
  amount        numeric not null default 0,
  currency      text not null default 'USD',
  cost_date     date default current_date,
  notes         text,
  created_at    timestamptz default now()
);

alter table cost_entries enable row level security;
create policy "auth users full access on cost_entries" on cost_entries for all to authenticated using (true) with check (true);

-- Per-shipment USD and SGD rates for cost conversion (mirrors invoice_usd_rate pattern)
alter table shipments add column if not exists cost_usd_rate numeric;
alter table shipments add column if not exists cost_sgd_rate numeric;
