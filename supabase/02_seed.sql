-- ============================================================================
-- JEI — Seed data (run AFTER 01_schema.sql)
-- Safe to re-run: clears tables first.
-- ============================================================================
truncate orders, shipment_costs, shipments, customers, couriers, fx_rates restart identity cascade;

-- FX
insert into fx_rates (id, usd_idr, sgd_idr) values (1, 16250, 12050);

-- Couriers (divisor lives here, per your FedEx=5000 / others=6000 rule)
insert into couriers (id, name, divisor) values
  ('fedex', 'FedEx',   5000),
  ('dhl',   'DHL',     6000),
  ('sea',   'Sea LCL', 6000);

-- Customers (flat owner-set rate per kg in IDR)
insert into customers (id, name, rate_per_kg, notes) values
  ('11111111-1111-1111-1111-111111111111', 'PT Maju Jaya',  120000, 'Long-term account'),
  ('22222222-2222-2222-2222-222222222222', 'CV Sentosa',    135000, ''),
  ('33333333-3333-3333-3333-333333333333', 'PT Bumi Tekno', 105000, 'High volume'),
  ('44444444-4444-4444-4444-444444444444', 'PT Andalan',    128000, '');

-- Shipments (new checkpoint vocabulary + payment track)
insert into shipments (id, courier_id, stage, eta_id, payment) values
  ('SHP-2401', 'fedex', 'Received in SG',         '2026-06-18', 'Unpaid'),
  ('SHP-2402', 'dhl',   'Sent to ID',             '2026-06-14', 'Invoiced'),
  ('SHP-2403', 'fedex', 'Delivered to customer',  '2026-06-05', 'Paid'),
  ('SHP-2404', 'sea',   'Package received in US', '2026-06-25', 'Unpaid');

-- Shipment costs (multi-currency; owner-only)
insert into shipment_costs (shipment_id, label, amount, currency) values
  ('SHP-2401','US freight',1200,'USD'),('SHP-2401','SG handling',340,'SGD'),('SHP-2401','ID delivery',850000,'IDR'),
  ('SHP-2402','US freight',640,'USD'), ('SHP-2402','SG handling',180,'SGD'),('SHP-2402','ID delivery',400000,'IDR'),
  ('SHP-2403','US freight',980,'USD'), ('SHP-2403','SG handling',250,'SGD'),('SHP-2403','ID delivery',600000,'IDR'),
  ('SHP-2404','US freight',1500,'USD');

-- Orders (dims in cm, weight in kg)
insert into orders (id, customer_id, shipment_id, product, qty, weight_kg, dim_l_cm, dim_w_cm, dim_h_cm, sell_idr) values
  ('ORD-1001','11111111-1111-1111-1111-111111111111','SHP-2401','Industrial pumps',4,62,80,60,55,92000000),
  ('ORD-1002','22222222-2222-2222-2222-222222222222','SHP-2401','Valve assemblies',20,18,50,40,35,48000000),
  ('ORD-1003','33333333-3333-3333-3333-333333333333','SHP-2402','Bearings (bulk)',500,140,60,50,50,35000000),
  ('ORD-1004','44444444-4444-4444-4444-444444444444','SHP-2403','Control panels',6,48,90,70,60,78000000),
  ('ORD-1005','11111111-1111-1111-1111-111111111111','SHP-2404','Motors 3-phase',10,210,70,60,60,120000000),
  ('ORD-1006','22222222-2222-2222-2222-222222222222','SHP-2404','Sensor kits',50,9,55,45,40,26000000);
