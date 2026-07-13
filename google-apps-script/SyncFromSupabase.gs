/**
 * JEI Daily Backup — Google Apps Script
 * ======================================
 * Pulls Orders, Customers, Shipments, and Couriers from Supabase and writes
 * them into tabs of THIS spreadsheet, overwriting the previous snapshot.
 *
 * 100% FREE — runs entirely inside Google's infrastructure on a time-based
 * trigger. No Supabase CLI, no service account, no Edge Function needed.
 *
 * SETUP:
 * 1. Open your Google Sheet → Extensions → Apps Script
 * 2. Delete any starter code, paste this whole file in
 * 3. Fill in SUPABASE_URL and SUPABASE_ANON_KEY below (Step "Configuration")
 * 4. Run `setup()` once (top toolbar ▶ button, pick "setup" from dropdown)
 *    - This creates the tabs and runs a first sync immediately
 *    - Google will ask for permissions the first time — click through/Allow
 * 5. That's it — a daily trigger is now scheduled automatically by setup()
 *
 * To change the sync time or remove the trigger, see the bottom of this file.
 */

// ───────────────────────── Configuration ─────────────────────────
const SUPABASE_URL = "https://YOUR_PROJECT_REF.supabase.co"; // <-- fill in
const SUPABASE_ANON_KEY = "YOUR_ANON_KEY_HERE";               // <-- fill in

const TABLES = ["orders", "customers", "shipments", "couriers"];
const TAB_NAMES = { orders: "Orders", customers: "Customers", shipments: "Shipments", couriers: "Couriers" };

// ───────────────────────── One-time setup ─────────────────────────
function setup() {
  // Create tabs if they don't exist
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  TABLES.forEach(t => {
    const name = TAB_NAMES[t];
    if (!ss.getSheetByName(name)) ss.insertSheet(name);
  });
  if (!ss.getSheetByName("Sync Info")) ss.insertSheet("Sync Info");

  // Remove the default "Sheet1" if it's empty and unused
  const sheet1 = ss.getSheetByName("Sheet1");
  if (sheet1 && ss.getSheets().length > 1) {
    try { ss.deleteSheet(sheet1); } catch (e) { /* ignore */ }
  }

  // Run an initial sync right away
  syncAll();

  // Schedule the daily trigger (removes any existing one first to avoid duplicates)
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === "syncAll") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("syncAll")
    .timeBased()
    .everyDays(1)
    .atHour(9) // 9 AM in the script's timezone (set below)
    .create();

  // Set timezone to Jakarta so "9 AM" means 9 AM WIB
  ss.setSpreadsheetTimeZone("Asia/Jakarta");

  Logger.log("Setup complete! Tabs created, first sync done, and daily sync scheduled for 9 AM WIB.");
}

// ───────────────────────── Main sync ─────────────────────────
function syncAll() {
  Logger.log("syncAll: starting");
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const counts = {};

  TABLES.forEach(table => {
    Logger.log("syncAll: fetching " + table);
    const data = fetchTable(table);
    Logger.log("syncAll: got " + data.length + " rows from " + table + ", writing sheet");
    writeSheet(ss, TAB_NAMES[table], data);
    counts[table] = data.length;
  });

  // Sync Info tab
  Logger.log("syncAll: writing Sync Info");
  const infoSheet = ss.getSheetByName("Sync Info") || ss.insertSheet("Sync Info");
  infoSheet.clear();
  infoSheet.getRange(1, 1, 6, 2).setValues([
    ["Last synced", new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" }) + " WIB"],
    ["Orders", counts.orders],
    ["Customers", counts.customers],
    ["Shipments", counts.shipments],
    ["Couriers", counts.couriers],
    ["Status", "OK"],
  ]);
  Logger.log("syncAll: done");
}

// ───────────────────────── Helpers ─────────────────────────

// Fetch all rows from a Supabase table via its REST API
function fetchTable(table) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?select=*`;
  const res = UrlFetchApp.fetch(url, {
    method: "get",
    headers: {
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": "Bearer " + SUPABASE_ANON_KEY,
    },
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code !== 200) {
    throw new Error(`Failed to fetch ${table}: HTTP ${code} — ${res.getContentText()}`);
  }
  return JSON.parse(res.getContentText());
}

// Write an array of row-objects into a sheet, replacing all existing content
function writeSheet(ss, sheetName, records) {
  const sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
  sheet.clear();

  if (!records || records.length === 0) {
    sheet.getRange(1, 1).setValue("(no data)");
    return;
  }

  const headers = Object.keys(records[0]);
  const rows = [headers];
  records.forEach(rec => {
    rows.push(headers.map(h => {
      const v = rec[h];
      if (v === null || v === undefined) return "";
      if (typeof v === "object") return JSON.stringify(v); // jsonb columns (packages, extra_costs, etc.)
      return v;
    }));
  });

  sheet.getRange(1, 1, rows.length, headers.length).setValues(rows);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold"); // bold header row
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, headers.length);
}

// ───────────────────────── Maintenance ─────────────────────────

// Run this manually any time you want to force a sync (e.g. for testing)
function manualSync() {
  syncAll();
  Logger.log("Sync complete — check the tabs and Sync Info.");
}

// Run this to remove the daily trigger (stop automatic syncing)
function removeTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === "syncAll") ScriptApp.deleteTrigger(t);
  });
  Logger.log("Daily sync trigger removed.");
}
