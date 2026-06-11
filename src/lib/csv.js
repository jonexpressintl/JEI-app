// CSV export: generates a CSV string and triggers download
export function exportCSV(rows, filename) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(","),
    ...rows.map(r => headers.map(h => {
      const v = r[h] ?? "";
      const s = String(v).replace(/"/g, '""');
      return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s}"` : s;
    }).join(","))
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// CSV import: parses a CSV file into an array of objects
export function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = parseLine(lines[0]);
  return lines.slice(1).map(line => {
    const vals = parseLine(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h.trim()] = vals[i]?.trim() ?? ""; });
    return obj;
  });
}

function parseLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else current += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { result.push(current); current = ""; }
      else current += ch;
    }
  }
  result.push(current);
  return result;
}

// Export ALL data with shipment info
export function exportOrders(orders, customers, shipments) {
  const custMap = Object.fromEntries(customers.map(c => [c.id, c]));
  const shipMap = Object.fromEntries(shipments.map(s => [s.id, s]));
  return orders.map(o => {
    const c = custMap[o.customer_id] || {};
    const s = shipMap[o.shipment_id] || {};
    return {
      order_id: o.id,
      order_date: o.order_date || "",
      customer: c.name || "",
      contact_person: c.contact_person || "",
      contact_number: c.contact_number || "",
      address: c.address || "",
      states: c.states || "",
      product: o.product,
      qty: o.qty,
      weight_kg: o.weight_kg,
      dim_l_cm: o.dim_l_cm,
      dim_w_cm: o.dim_w_cm,
      dim_h_cm: o.dim_h_cm,
      packages: o.packages ? JSON.stringify(o.packages) : "",
      sell_idr: o.sell_idr,
      sell_currency: o.sell_currency || "IDR",
      price_per_kg: o.price_per_kg || 0,
      price_currency: o.price_currency || "IDR",
      shipment_id: o.shipment_id || "",
      shipment_stage: s.stage || "",
      shipment_payment: s.payment || "",
      shipment_courier: s.courier_id || "",
      tracking_us_sg: s.track_us_sg || "",
      tracking_sg_id: s.track_sg_id || "",
      tracking_id_cust: s.track_id_cust || "",
    };
  });
}

export function exportCustomers(customers) {
  return customers.map(c => ({
    name: c.name,
    states: c.states || "",
    shipping_mark: c.shipping_mark || "",
    contact_person: c.contact_person || "",
    contact_number: c.contact_number || "",
    address: c.address || "",
    rate_per_kg: c.rate_per_kg || 0,
  }));
}
