# Daily Google Sheets Backup — Setup Guide (100% Free)

This sets up an automated daily sync that copies your Orders, Customers,
Shipments, and Couriers tables from Supabase into a Google Sheet, so you
always have a readable backup even if the website is down.

**This entire setup is free** — it runs as a Google Apps Script attached to
your Sheet, on Google's free daily trigger quota (well within limits for
one run/day). No Supabase CLI, no service account, no paid Supabase plan
needed.

---

## Step 1 — Run the database migration

In Supabase → SQL Editor, run `14_anon_backup_read.sql`. This gives
read-only access to the Orders, Customers, Shipments, and Couriers tables
using your public "anon" key — the same key visible in your app's
JavaScript bundle, so this isn't a new exposure. Financial data
(`shipment_costs`, `fx_rates`) stays protected and is NOT included in the
backup.

---

## Step 2 — Create the Google Sheet

1. Create a new Google Sheet (any name, e.g. "JEI Daily Backup").
2. That's it for this step — the script will create the tabs for you.

---

## Step 3 — Add the script

1. In your new Sheet, go to **Extensions → Apps Script**.
2. Delete any starter code (`function myFunction() {...}`) in the editor.
3. Open `SyncFromSupabase.gs` (provided alongside this guide) and paste its
   entire contents into the Apps Script editor.
4. Near the top, fill in:
   ```js
   const SUPABASE_URL = "https://YOUR_PROJECT_REF.supabase.co";
   const SUPABASE_ANON_KEY = "YOUR_ANON_KEY_HERE";
   ```
   - `SUPABASE_URL`: Supabase → Project Settings → API → Project URL
   - `SUPABASE_ANON_KEY`: same page → `anon` `public` key
5. Click the **Save** icon (or Ctrl+S / Cmd+S).

---

## Step 4 — Run setup once

1. In the Apps Script toolbar, find the function dropdown (next to the ▶ Run
   button) and select **setup**.
2. Click **Run** (▶).
3. The first time, Google will show a permissions screen:
   - Click **Review permissions**
   - Choose your Google account
   - You may see "Google hasn't verified this app" — click **Advanced** →
     **Go to [project name] (unsafe)** → **Allow**.
   - This warning appears because it's your own private script, not a
     published app — it's normal and safe.
4. After it runs, you'll see a popup: "Setup complete!"
5. Go back to your Sheet — you should now see tabs: **Orders**, **Customers**,
   **Shipments**, **Couriers**, **Sync Info** — all populated with today's
   data.

That's it. A daily trigger is now active, running every day at **9 AM
Jakarta time (WIB)**.

---

## Checking it's working

- Open the **Sync Info** tab any time — it shows the last sync timestamp and
  row counts for each table.
- In Apps Script, go to the clock icon (Triggers) on the left sidebar —
  you should see one trigger for `syncAll`, running daily.

---

## Manual sync / troubleshooting

- To force a sync immediately (e.g. to test), select **manualSync** in the
  function dropdown and click Run.
- To stop the daily sync, select **removeTrigger** and click Run.
- If a sync fails (e.g. wrong URL/key), check **Executions** (left sidebar,
  clock-with-arrow icon) in Apps Script for the error log.

---

## Changing the sync time

Edit this part of the script and re-run `setup()`:
```js
ScriptApp.newTrigger("syncAll")
  .timeBased()
  .everyDays(1)
  .atHour(9) // <- change this (24-hour format, Jakarta time)
  .create();
```

---

## What Gets Synced

Each day, the script overwrites these tabs with a fresh full export:
- **Orders** — every column from the `orders` table (packages, fees,
  pricing, AES/pickup notes, etc.)
- **Customers** — every column from `customers`
- **Shipments** — every column from `shipments`
- **Couriers** — every column from `couriers`
- **Sync Info** — last sync time and row counts

JSON columns (like `packages` and `extra_costs`) are stored as raw JSON
text in their cells — readable but not split into separate columns.

This is a **read-only backup** — nothing in the app writes back to the
sheet, and the sheet doesn't affect the live app. It's purely "if Supabase
or Vercel goes down, here's what the data looked like as of this morning."
