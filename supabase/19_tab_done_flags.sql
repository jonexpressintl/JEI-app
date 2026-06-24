-- JEI — Migration 19: parallel tab completion flags
-- New flow: order created → appears in Shipment, Invoice, Cost tabs simultaneously
-- Each tab has its own done flag. Once all three are done, order can be Completed.

alter table orders add column if not exists shipment_done boolean default false;
alter table orders add column if not exists invoice_done  boolean default false;
alter table orders add column if not exists cost_done     boolean default false;

-- Backfill: orders that were already invoiced → treat invoice_done = true, cost_done = true
update orders set invoice_done = true, cost_done = true where invoiced = true;
-- Backfill: orders that were completed → all three done
update orders set shipment_done = true, invoice_done = true, cost_done = true where completed = true;
