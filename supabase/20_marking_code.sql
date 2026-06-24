-- JEI — Migration 20: marking code field on orders
-- Used to label packages in transit (e.g. "AUDIO / JKT-01")
-- Displayed prominently (gold badge) in the Shipments tab ORDER SHIPMENT STATUS section

alter table orders add column if not exists marking_code text;
