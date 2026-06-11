-- ============================================================================
-- JEI — Migration 08: contact_person + live FX
-- Run in Supabase → SQL Editor
-- ============================================================================

alter table customers add column if not exists contact_person text;
