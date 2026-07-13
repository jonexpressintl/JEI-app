// ─── JEI Google Sheets Backup ────────────────────────────────────────────────
// Pulls Orders, Customers, Shipments, Couriers from Supabase daily.
// Setup: Extensions → Apps Script, paste this file, fill credentials below,
//        run setup() once, then enable the daily trigger.

const SUPABASE_URL     = "https://YOUR_PROJECT.supabase.co";
const SUPABASE_ANON_KEY = "YOUR_ANON_KEY_HERE";

function setup() {
  // Create a daily time-based trigger at 9am WIB (UTC+7 = 2am UTC)
  ScriptApp.newTrigger("syncAll")
    .timeBased()
    .everyDays(1)
    .atHour(2)
    .create();
  Logger.log("Trigger created — syncAll will run daily at ~9am WIB.");
}

function syncAll() {
  syncOrders();
  syncCustomers();
  syncShipments();
  syncCouriers();
  updateSyncInfo();
}

function fetchAll(table, select) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?select=${select || "*"}&limit=10000`;
  const resp = UrlFetchApp.fetch(url, {
    headers: {
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": "Bearer " + SUPABASE_ANON_KEY,
    },
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() !== 200) {
    Logger.log("Error fetching " + table + ": " + resp.getContentText());
    return [];
  }
  return JSON.parse(resp.getContentText());
}

function writeSheet(sheetName, rows, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);
  sheet.clearContents();
  if (!rows.length) { sheet.getRange(1,1).setValue("No data"); return; }
  const cols = headers || Object.keys(rows[0]);
  sheet.getRange(1, 1, 1, cols.length).setValues([cols]);
  const data = rows.map(r => cols.map(c => {
    const v = r[c];
    if (v === null || v === undefined) return "";
    if (typeof v === "object") return JSON.stringify(v);
    return v;
  }));
  sheet.getRange(2, 1, data.length, cols.length).setValues(data);
  // Style header
  sheet.getRange(1, 1, 1, cols.length)
    .setBackground("#1B3A6B").setFontColor("#FFFFFF").setFontWeight("bold");
}

function syncOrders() {
  const rows = fetchAll("orders");
  writeSheet("Orders", rows, [
    "id","customer_id","shipment_id","product","qty","order_date",
    "weight_kg","dim_l_cm","dim_w_cm","dim_h_cm","divisor",
    "price_per_kg","price_currency","sell_idr","sell_currency",
    "destination","shipping_us_sg","shipping_sg_id",
    "invoice_usd_rate","invoice_sgd_rate",
    "invoiced","invoiced_at","completed","completed_at",
    "customer_type","supplier_name","additional_info",
  ]);
  Logger.log("Orders synced: " + rows.length + " rows");
}

function syncCustomers() {
  const rows = fetchAll("customers");
  writeSheet("Customers", rows, [
    "id","name","rate_per_kg","rate_currency","states","shipping_mark",
    "contact_person","contact_number","address","notes",
  ]);
  Logger.log("Customers synced: " + rows.length + " rows");
}

function syncShipments() {
  const rows = fetchAll("shipments");
  writeSheet("Shipments", rows, [
    "id","courier_id","stage","payment","eta_id",
    "track_us_sg","track_us_sg_carrier",
    "track_sg_id","track_sg_id_carrier",
    "track_id_cust","track_id_cust_carrier",
    "stage_updated_at","payment_updated_at",
  ]);
  Logger.log("Shipments synced: " + rows.length + " rows");
}

function syncCouriers() {
  const rows = fetchAll("couriers");
  writeSheet("Couriers", rows, ["id","name","divisor"]);
  Logger.log("Couriers synced: " + rows.length + " rows");
}

function updateSyncInfo() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("Sync Info");
  if (!sheet) sheet = ss.insertSheet("Sync Info");
  sheet.clearContents();
  sheet.getRange("A1:B3").setValues([
    ["Last sync", new Date().toLocaleString("en-GB", {timeZone:"Asia/Jakarta"})],
    ["Source", SUPABASE_URL],
    ["Tables", "Orders, Customers, Shipments, Couriers"],
  ]);
}
