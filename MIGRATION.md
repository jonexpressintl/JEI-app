# Moving JEI off Google Sheets

You asked two things: (1) full add/edit/delete so Merry and Angie can stop using
the Sheet, and (2) whether to link Google files or whether that would blow the
free limits. Here's the plain answer and the plan.

## Do you need Google Sheets at all? No — and here's the math.

Worry: "full use will eat the Supabase free tier."

Reality: the free tier is **500 MB of database**. One order row is ~300 bytes.
That's room for **well over 1,000,000 orders**. At ~50 orders/month it would take
roughly 1,600 years to fill. Database *rows* are tiny. What actually fills storage
is uploaded files and images — and this app stores none. So:

- **Keep all data in Supabase.** It is the cheaper, safer home for this data than
  Google Sheets, not the more expensive one.
- **Don't link Google Sheets as a live backend.** Two systems holding the same
  data is how you get two versions of the truth — the exact problem you're leaving.

The one good use for Google here is a **one-time import** of your existing history,
and an occasional **export** for backup. Both are below.

## One-time import of your existing Sheet

1. In Google Sheets: **File → Download → Comma-separated values (.csv)**.
2. Make sure the columns are named so the import can map them. Easiest: match
   these headers exactly (order doesn't matter, extra columns are ignored):

   `customer, product, qty, weight_kg, dim_l_cm, dim_w_cm, dim_h_cm, sell_idr, courier, stage, eta_id`

   - `customer` = the customer's name (must already exist in the Customers list,
     or add them first in the Pricing tab).
   - `courier` = `fedex`, `dhl`, or `sea`.
   - `stage` = one of the lifecycle stages, e.g. `Delivered`. Leave blank for new.
   - dimensions in cm, weight in kg, price in IDR.
3. In Supabase → **Table Editor**, you can import a CSV directly into a table
   ("Insert → Import data from CSV"). For `orders` you'll need the `customer_id`
   and `shipment_id` rather than names — so for a messy historical sheet, the
   simpler path is below.

### Simpler path for a real, messy sheet
Send me (in our chat) the column headers from your actual Sheet and 2–3 sample
rows (no need for the whole thing). I'll generate a tailored SQL insert script
that maps your columns to the right tables and creates the shipments + customer
links for you. That's usually faster than wrestling a CSV into the right shape.

## Backups (optional, free)
Supabase → Table Editor → any table → **Export to CSV**. Do this monthly and keep
the file in Google Drive if you want a familiar safety net. This is export-only,
so there's no "two sources of truth" risk.

## What the app now does (this build)
- **New order** button (Orders tab) — create an order, assign it to an existing
  shipment or spin up a new one in the same step.
- **Edit** (pencil on each row) — change any field mid-flight; changes save to the
  database immediately.
- **Delete** — inside the edit dialog, with a confirm prompt.
- **Stage transitions** — change a shipment's stage straight from the dropdown in
  the Orders table; it updates every order on that shipment.

Both Merry and Angie can do all of the above. Only the owner sees cost and margin.
