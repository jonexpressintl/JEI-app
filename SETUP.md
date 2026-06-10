# JEI Dashboard — Setup & Deployment Guide

This gets you from these files to a live web app that Merry and Angie can log into.
Work through the stages in order. Steps marked **[YOU]** must be done by you
(creating accounts, pasting keys) — I can't do those, and you should never share
those keys or passwords with anyone, including me.

Total time: about 45–60 minutes the first time.

---

## What you have

```
jei-app/
├── supabase/
│   ├── 01_schema.sql      ← database tables + security rules
│   └── 02_seed.sql        ← sample data
├── src/                   ← the React app (already builds cleanly)
├── .env.example           ← template for your keys
└── package.json
```

---

## STAGE 1 — Create the Supabase project  **[YOU]**

1. Go to https://supabase.com and sign up (free, GitHub login is easiest).
2. Click **New project**. Pick a name (e.g. `jei`), set a strong database
   password (save it somewhere safe), choose the **Singapore** region
   (closest to your users). Click **Create** and wait ~2 minutes.

## STAGE 2 — Create the database

1. In your Supabase project, open **SQL Editor** (left sidebar).
2. Click **New query**, paste the entire `supabase/00_complete_setup.sql`,
   click **RUN**. You should see "Success." This creates every table, loads
   sample data, and sets up status tracking, tracking numbers, and the per-user
   passcode system in one go. (No need to edit the file — each user sets their
   own passcode the first time they log in.)
3. Open **Table Editor** — you should see your tables filled with data.

## STAGE 3 — Create the two user accounts  **[YOU]**

1. Left sidebar → **Authentication** → **Users** → **Add user** →
   **Create new user**.
2. Create Merry: enter her email + a temporary password, tick
   **Auto Confirm User**. Click create. Do the same for Angie.
3. Now tell the database who is the owner. Open **SQL Editor**, new query, and
   run this — replacing the emails with the real ones you just used:

   ```sql
   -- create profile rows and set roles
   insert into profiles (id, full_name, role)
   select id, 'Merry Toh', 'owner'  from auth.users where email = 'merry@example.com';

   insert into profiles (id, full_name, role)
   select id, 'Angie', 'admin' from auth.users where email = 'angie@example.com';
   ```

   (If you re-run this, add `on conflict (id) do update set role = excluded.role`.)

## STAGE 4 — Get your API keys

1. Left sidebar → **Project Settings** → **API**.
2. Copy two things:
   - **Project URL** (looks like `https://abcd1234.supabase.co`)
   - **anon public** key (a long string under "Project API keys")
   These are safe to use in a frontend — the security rules protect your data.
   Do **not** copy the `service_role` key.

## STAGE 5 — Run it locally first  **[YOU]**

```bash
cd jei-app
cp .env.example .env
# open .env and paste your real URL and anon key
npm install
npm run dev
```

Open the URL it prints (usually http://localhost:5173). Log in as Merry —
you should see revenue and margin. Log out, log in as Angie — those columns
should be gone. That confirms the role split works end to end.

## STAGE 6 — Deploy to Vercel  **[YOU]**

1. Put this project on GitHub:
   - Create a free GitHub account if needed.
   - Create a new **private** repository.
   - Follow GitHub's instructions to push this folder
     (`git init`, `git add .`, `git commit`, `git remote add`, `git push`).
   - `.gitignore` already keeps your `.env` and secrets out — good.
2. Go to https://vercel.com, sign up with GitHub.
3. **Add New → Project**, import your repo. Vercel auto-detects Vite.
4. Before deploying, expand **Environment Variables** and add the same two:
   - `VITE_SUPABASE_URL` = your project URL
   - `VITE_SUPABASE_ANON_KEY` = your anon key
5. Click **Deploy**. In ~1 minute you get a live URL like
   `https://jei.vercel.app`. Share it with Merry and Angie.

---

## Cost

Everything above is **$0** on free tiers. At a two-person volume you can stay
free indefinitely. Upgrade only if you outgrow it (Supabase Pro ~$25/mo gives
no-pause + bigger DB; Vercel Pro ~$20/mo only matters for commercial scale).

## What's NOT built yet (honest list — next steps)

- **Adding/editing orders & shipments from the UI** — right now you'd add new
  rows via Supabase Table Editor. A proper "New order" form is the natural
  next build.
- **Editing FX rates and couriers from the UI** (owner-only).
- **Stage updates** — moving a shipment along the lifecycle with a click.
- **Revenue DB-enforcement** — currently revenue is hidden from admin in the
  app layer; costs are hidden at the database. See the note at the bottom of
  `01_schema.sql` if you want revenue walled off at the DB too.

These are all straightforward additions on top of this foundation.
