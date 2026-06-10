import { jsPDF } from "jspdf";
import "jspdf-autotable";
import { chargeable, fmtIDR } from "./pricing";

const ACCENT = [14, 110, 92]; // #0E6E5C
const INK = [26, 43, 42];
const GRAY = [138, 151, 148];

function header(doc, title, subtitle) {
  doc.setFontSize(20); doc.setFont("helvetica", "bold"); doc.setTextColor(...INK);
  doc.text("JON EXPRESS INTERNATIONAL", 20, 25);
  doc.setFontSize(9); doc.setFont("helvetica", "normal"); doc.setTextColor(...GRAY);
  doc.text("Freight forwarding · US → Singapore → Indonesia", 20, 32);
  doc.setFontSize(22); doc.setFont("helvetica", "bold"); doc.setTextColor(...ACCENT);
  doc.text(title, 190, 25, { align: "right" });
  if (subtitle) { doc.setFontSize(10); doc.setTextColor(...GRAY); doc.text(subtitle, 190, 32, { align: "right" }); }
  doc.setDrawColor(...ACCENT); doc.setLineWidth(0.6); doc.line(20, 37, 190, 37);
}

function labelValue(doc, x, y, label, value) {
  doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.setTextColor(...GRAY);
  doc.text(label, x, y);
  doc.setFontSize(10); doc.setFont("helvetica", "bold"); doc.setTextColor(...INK);
  doc.text(String(value ?? "—"), x, y + 5);
}

// ── INVOICE PDF ──
export function generateInvoicePDF(order, customer, shipment, courier, fx) {
  const doc = new jsPDF();
  const invNo = "INV-" + String(order.id).replace(/\D/g, "");
  header(doc, "INVOICE", invNo);

  // customer & shipment info
  labelValue(doc, 20, 46, "BILL TO", customer?.name ?? "—");
  labelValue(doc, 80, 46, "SHIPMENT", `${shipment?.id ?? "—"} · ${courier?.name ?? ""}`);
  labelValue(doc, 130, 46, "STATUS", shipment?.stage ?? "—");
  labelValue(doc, 20, 60, "PAYMENT", shipment?.payment ?? "Unpaid");
  labelValue(doc, 80, 60, "DATE", order.order_date ?? "—");

  // order line items
  const ch = chargeable(
    { l: +order.dim_l_cm, w: +order.dim_w_cm, h: +order.dim_h_cm },
    +order.weight_kg, courier?.divisor ?? 5000
  );
  const rate = +order.price_per_kg || customer?.rate_per_kg || 0;

  doc.autoTable({
    startY: 76,
    head: [["Description", "Qty", "Chargeable", "Rate/kg", "Amount"]],
    body: [[
      `${order.product}\n${ch.basis} weight · ${courier?.name ?? ""} ÷${courier?.divisor ?? ""}`,
      String(order.qty),
      `${ch.charged.toFixed(1)} kg`,
      fmtIDR(rate),
      fmtIDR(+order.sell_idr),
    ]],
    styles: { fontSize: 9, cellPadding: 5, textColor: INK, lineColor: [228, 232, 231] },
    headStyles: { fillColor: ACCENT, textColor: [255, 255, 255], fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: 70 }, 4: { halign: "right", fontStyle: "bold" } },
    theme: "grid",
  });

  const finalY = doc.lastAutoTable.finalY + 10;
  doc.setFontSize(12); doc.setFont("helvetica", "bold"); doc.setTextColor(...INK);
  doc.text("Total due", 20, finalY);
  doc.setTextColor(...ACCENT);
  doc.text(fmtIDR(+order.sell_idr), 190, finalY, { align: "right" });

  doc.setFontSize(9); doc.setFont("helvetica", "normal"); doc.setTextColor(...GRAY);
  doc.text("Payment in IDR within 14 days · Bank transfer to JEI account", 20, finalY + 8);

  return doc;
}

// ── QUOTATION PDF ──
export function generateQuotationPDF({ customerName, weight, dims, divisor, courierName, ratePerKg, currency, fx }) {
  const doc = new jsPDF();
  header(doc, "QUOTATION", `QT-${Date.now().toString(36).toUpperCase()}`);

  labelValue(doc, 20, 46, "CUSTOMER", customerName || "—");
  labelValue(doc, 80, 46, "COURIER", `${courierName} ÷${divisor}`);
  labelValue(doc, 130, 46, "DATE", new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }));

  const ch = chargeable(dims, weight, divisor);
  const amount = ch.charged * ratePerKg;

  doc.autoTable({
    startY: 62,
    head: [["Detail", "Value"]],
    body: [
      ["Actual weight", `${weight.toFixed(2)} kg`],
      ["Dimensions (L×W×H)", `${dims.l.toFixed(1)} × ${dims.w.toFixed(1)} × ${dims.h.toFixed(1)} cm`],
      ["Volumetric weight", `${(dims.l * dims.w * dims.h / divisor).toFixed(2)} kg`],
      ["Basis", ch.basis + (ch.minApplied ? " (3 kg minimum applied)" : "")],
      ["Chargeable weight", `${ch.charged.toFixed(1)} kg`],
      ["Rate per kg", fmtIDR(ratePerKg)],
      ["Estimated cost", fmtIDR(amount)],
    ],
    styles: { fontSize: 10, cellPadding: 5, textColor: INK, lineColor: [228, 232, 231] },
    headStyles: { fillColor: ACCENT, textColor: [255, 255, 255], fontStyle: "bold" },
    columnStyles: { 1: { fontStyle: "bold", halign: "right" } },
    theme: "grid",
  });

  const finalY = doc.lastAutoTable.finalY + 12;
  doc.setFontSize(13); doc.setFont("helvetica", "bold"); doc.setTextColor(...INK);
  doc.text("Estimated total", 20, finalY);
  doc.setTextColor(...ACCENT);
  doc.text(fmtIDR(amount), 190, finalY, { align: "right" });

  doc.setFontSize(9); doc.setFont("helvetica", "normal"); doc.setTextColor(...GRAY);
  doc.text("This is an estimate. Final charges based on actual/volumetric weight at shipment.", 20, finalY + 8);
  doc.text("Prices valid for 7 days from date of quotation.", 20, finalY + 14);

  return doc;
}
