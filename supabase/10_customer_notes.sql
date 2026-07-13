-- JEI — Migration 10: customer notes + rate currency
alter table customers add column if not exists notes text;
alter table customers add column if not exists rate_currency text default 'IDR';

-- Add completed flag for invoice archiving
alter table orders add column if not exists completed boolean default false;
