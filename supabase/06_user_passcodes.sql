-- ============================================================================
-- JEI — Migration 06: per-user login passcode (second factor for everyone)
-- Run in Supabase → SQL Editor after the earlier files.
-- Replaces the single owner passcode (migration 05) with one passcode PER user.
-- ============================================================================
-- Each user (owner or admin) has their own passcode, stored hashed on their
-- profile row and verified by a database function so the secret never reaches
-- the browser. After entering email + password, each user enters their passcode.

create extension if not exists pgcrypto;

-- Add a hashed-passcode column to profiles (nullable until set).
alter table profiles add column if not exists pass_hash text;

-- Set / change the CURRENT user's own passcode. A user can only set their own.
create or replace function set_my_passcode(new_code text)
returns void
language plpgsql
security definer
as $$
begin
  update profiles set pass_hash = crypt(new_code, gen_salt('bf'))
  where id = auth.uid();
end;
$$;

-- Verify the current user's passcode candidate. Returns true/false only.
create or replace function verify_my_passcode(candidate text)
returns boolean
language plpgsql
security definer
as $$
declare ok boolean;
begin
  select pass_hash = crypt(candidate, pass_hash) into ok
  from profiles where id = auth.uid();
  return coalesce(ok, false);
end;
$$;

-- Does the current user have a passcode set yet? (drives first-time setup UI)
create or replace function my_passcode_set()
returns boolean
language sql
security definer
stable
as $$
  select pass_hash is not null from profiles where id = auth.uid();
$$;

-- ── Clean up the old single-owner passcode mechanism (migration 05) ──
drop function if exists set_owner_passcode(text);
drop function if exists verify_owner_passcode(text);
drop table if exists owner_secret;

-- ── OPTIONAL first-time passcodes ────────────────────────────────────────────
-- You can let each user set their own passcode on first login (the app prompts
-- them). OR seed initial ones here by email — change the codes, then run:
--
--   update profiles set pass_hash = crypt('CHANGE-ME-merry', gen_salt('bf'))
--   where id = (select id from auth.users where email = 'MERRY_EMAIL');
--
--   update profiles set pass_hash = crypt('CHANGE-ME-angie', gen_salt('bf'))
--   where id = (select id from auth.users where email = 'ANGIE_EMAIL');
--
-- If you skip this, each user is prompted to create their passcode on first login.
