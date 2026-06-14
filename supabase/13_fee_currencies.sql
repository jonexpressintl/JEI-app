-- JEI — Migration 13: per-fee currencies, CBM overrides, charged weight override
alter table orders add column if not exists fee_1_cur text default 'USD';
alter table orders add column if not exists fee_clearance_cur text default 'SGD';
alter table orders add column if not exists fee_2_cur text default 'IDR';
alter table orders add column if not exists fee_additional_cur text default 'USD';
alter table orders add column if not exists air_sea_option text default 'weight';
alter table orders add column if not exists cbm_us_sg numeric;
alter table orders add column if not exists cbm_sg_id numeric;
alter table orders add column if not exists charged_override numeric;
