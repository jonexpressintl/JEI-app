import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { chargeable, fmtIDR } from "./pricing";

const ACCENT = [0, 128, 128]; // teal
const INK = [33, 33, 33];
const GRAY = [120, 120, 120];
const LTGRAY = [200, 200, 200];

// Company info (editable - could be moved to settings later)
const COMPANY = {
  name: "JON EXPRESS INTERNATIONAL LLC",
  pic: "PIC: Merry Toh",
  address: "17826 19th Ave W\nLynnwood, Washington\n98037, USA",
  phone: "425-240-3607",
  email: "jonexpressintl@gmail.com",
  banks: [
    { title: "Indonesian Account", lines: ["BCA", "Account name: Merry", "Account number: 5830208790"] },
    { title: "BCA Dollar Account", lines: ["Account name: Merry", "Account number: 5830503333"] },
    { title: "USA Account:", lines: ["Jon Express International LLC", "JPMorgan Chase Bank, N.A", "Account number: 680321962", "Routing Number: 325070760", "Venmo: merrytoh16; Chase: jonexpressintl@gmail.com"] },
  ],
};

function fmtUSD(n) { return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 }); }

export function generateInvoicePDF(order, customer, shipment, courier, liveFx, allOrders) {
  const doc = new jsPDF();
  const pw = 190; // page width usable

  // --- HEADER ---
  doc.setFontSize(24); doc.setFont("helvetica", "bold"); doc.setTextColor(...ACCENT);
  doc.text("Invoice", 190, 20, { align: "right" });

  doc.setFontSize(11); doc.setFont("helvetica", "bold"); doc.setTextColor(...INK);
  doc.text(COMPANY.name, 20, 20);

  doc.setFontSize(9); doc.setFont("helvetica", "normal"); doc.setTextColor(...INK);
  doc.text(COMPANY.pic, 20, 28);
  doc.text(COMPANY.address, 20, 33);
  doc.text(COMPANY.phone, 20, 47);
  doc.setTextColor(0, 0, 200);
  doc.text(COMPANY.email, 20, 52);
  doc.setTextColor(...INK);

  // --- INFO BOX ---
  const invNo = "INV-JEI/" + String(order.id).replace("ORD-", "");
  const invDate = order.order_date || new Date().toLocaleDateString("en-US");
  const boxy = 58;

  doc.setDrawColor(...LTGRAY); doc.setLineWidth(0.3);
  doc.rect(105, boxy, 85, 35);
  // labels
  doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.setTextColor(...GRAY);
  doc.text("Invoice No.", 107, boxy + 6);
  doc.text("Invoice Date:", 107, boxy + 12);
  doc.text("Bill To:", 107, boxy + 20);
  doc.text("Ship to", 107, boxy + 26);
  doc.text("Address:", 107, boxy + 31);
  // values
  doc.setFont("helvetica", "bold"); doc.setTextColor(...INK);
  doc.text(invNo, 145, boxy + 6);
  doc.text(invDate, 145, boxy + 12);
  doc.setFontSize(9);
  doc.text(customer?.name || "—", 145, boxy + 20);
  doc.setFontSize(8); doc.setFont("helvetica", "normal");
  doc.text(customer?.address || "", 145, boxy + 31);

  // --- LINE ITEMS TABLE ---
  const packages = order.packages && order.packages.length > 0
    ? order.packages
    : [{ weight: +order.weight_kg, l: +order.dim_l_cm, w: +order.dim_w_cm, h: +order.dim_h_cm }];

  const div = courier?.divisor || 5000;
  let totalChargedKg = 0;
  packages.forEach(p => {
    const ch = chargeable({ l: +p.l, w: +p.w, h: +p.h }, +p.weight, div);
    totalChargedKg += ch.charged;
  });

  const pricePerKg = +order.price_per_kg || customer?.rate_per_kg || 0;
  const priceCur = order.price_currency || "IDR";
  const isUSD = priceCur === "USD" || order.sell_currency === "USD";
  const subtotalUSD = isUSD ? totalChargedKg * pricePerKg : 0;
  const subtotalIDR = +order.sell_idr || 0;

  const shipDesc = `Shipment ${shipment?.id || "—"} (USA - JKT by ${courier?.name || "Air"}, ${packages.length} ctn${packages.length > 1 ? "s" : ""})`;

  autoTable(doc, {
    startY: 100,
    head: [["Description", "Units", "Price/kg", "Amount"]],
    body: [
      [shipDesc, totalChargedKg.toFixed(1), isUSD ? fmtUSD(pricePerKg) : fmtIDR(pricePerKg), isUSD ? fmtUSD(subtotalUSD || subtotalIDR) : fmtIDR(subtotalIDR)],
    ],
    styles: { fontSize: 9, cellPadding: 4, textColor: INK, lineColor: LTGRAY, lineWidth: 0.3 },
    headStyles: { fillColor: [240, 240, 240], textColor: INK, fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: 80 }, 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right", fontStyle: "bold" } },
    theme: "grid",
  });

  // --- TOTALS ---
  const fy = (doc.lastAutoTable?.finalY ?? 130) + 8;
  const fx = liveFx || { usd_idr: 15850 };
  const convRate = fx.usd_idr || 15850;
  const totalIDR = isUSD ? Math.round((subtotalUSD || subtotalIDR) * convRate) : subtotalIDR;

  autoTable(doc, {
    startY: fy,
    body: [
      [{ content: "Invoice Subtotal", styles: { halign: "right" } }, isUSD ? fmtUSD(subtotalUSD || subtotalIDR) : fmtIDR(subtotalIDR)],
      [{ content: "Conversion Rate", styles: { halign: "right" } }, isUSD ? `Rp${convRate.toLocaleString()}.00` : "—"],
      [{ content: "Sales Tax", styles: { halign: "right" } }, ""],
      [{ content: "Discount", styles: { halign: "right" } }, ""],
      [{ content: "Deposit Received", styles: { halign: "right" } }, ""],
      [{ content: "TOTAL", styles: { halign: "right", fontStyle: "bold", fillColor: [240, 240, 240] } }, { content: `Rp${totalIDR.toLocaleString()}.00`, styles: { fontStyle: "bold", fillColor: [240, 240, 240] } }],
    ],
    columnStyles: { 0: { cellWidth: 110 }, 1: { halign: "right", cellWidth: 60 } },
    styles: { fontSize: 9, cellPadding: 3, textColor: INK, lineColor: LTGRAY, lineWidth: 0.3 },
    theme: "grid",
    margin: { left: 105 },
  });

  // --- BANK DETAILS ---
  let by = (doc.lastAutoTable?.finalY ?? 200) + 12;
  doc.setFontSize(9); doc.setFont("helvetica", "bold"); doc.setTextColor(...ACCENT);
  doc.text("Please remit payment to account:", 20, by);
  by += 8;

  COMPANY.banks.forEach(bank => {
    doc.setFont("helvetica", "bold"); doc.setTextColor(...INK);
    doc.text(bank.title, 20, by); by += 5;
    doc.setFont("helvetica", "normal");
    bank.lines.forEach(line => { doc.text(line, 20, by); by += 4.5; });
    by += 3;
  });

  // --- FOOTER ---
  by += 5;
  doc.setFontSize(10); doc.setFont("helvetica", "bold"); doc.setTextColor(...ACCENT);
  doc.text("Thank You for Your Business!", 105, by, { align: "center" });

  return doc;
}

export function generateQuotationPDF({ customerName, weight, dims, divisor, courierName, ratePerKg, packages }) {
  const doc = new jsPDF();

  doc.setFontSize(24); doc.setFont("helvetica", "bold"); doc.setTextColor(...ACCENT);
  doc.text("Quotation", 190, 20, { align: "right" });
  doc.setFontSize(11); doc.setFont("helvetica", "bold"); doc.setTextColor(...INK);
  doc.text(COMPANY.name, 20, 20);
  doc.setFontSize(9); doc.setFont("helvetica", "normal");
  doc.text(COMPANY.pic, 20, 28);
  doc.text(`Date: ${new Date().toLocaleDateString("en-US")}`, 20, 33);
  doc.text(`Customer: ${customerName || "—"}`, 20, 40);
  doc.text(`Courier: ${courierName} (div ${divisor})`, 20, 45);

  const pkgs = packages && packages.length > 0 ? packages : [{ weight, l: dims.l, w: dims.w, h: dims.h }];
  const body = [];
  let totalCharged = 0;

  pkgs.forEach((p, i) => {
    const ch = chargeable({ l: +p.l, w: +p.w, h: +p.h }, +p.weight, divisor);
    totalCharged += ch.charged;
    body.push([
      `Package ${i + 1}`,
      `${(+p.weight).toFixed(1)} kg`,
      `${(+p.l).toFixed(0)} x ${(+p.w).toFixed(0)} x ${(+p.h).toFixed(0)} cm`,
      `${ch.vol.toFixed(1)} kg`,
      `${ch.charged.toFixed(1)} kg`,
      ch.basis + (ch.minApplied ? " (min)" : ""),
    ]);
  });

  autoTable(doc, {
    startY: 52,
    head: [["", "Actual", "Dimensions", "Volumetric", "Charged", "Basis"]],
    body: body,
    styles: { fontSize: 9, cellPadding: 4, textColor: INK, lineColor: LTGRAY, lineWidth: 0.3 },
    headStyles: { fillColor: [240, 240, 240], textColor: INK, fontStyle: "bold" },
    theme: "grid",
  });

  const fy = (doc.lastAutoTable?.finalY ?? 100) + 8;
  const total = totalCharged * ratePerKg;

  autoTable(doc, {
    startY: fy,
    body: [
      ["Total chargeable weight", `${totalCharged.toFixed(1)} kg`],
      ["Rate per kg", fmtIDR(ratePerKg)],
      [{ content: "Estimated total", styles: { fontStyle: "bold" } }, { content: fmtIDR(total), styles: { fontStyle: "bold" } }],
    ],
    columnStyles: { 0: { cellWidth: 100 }, 1: { halign: "right" } },
    styles: { fontSize: 10, cellPadding: 4, textColor: INK, lineColor: LTGRAY, lineWidth: 0.3 },
    theme: "grid",
    margin: { left: 80 },
  });

  const fy2 = (doc.lastAutoTable?.finalY ?? 140) + 10;
  doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.setTextColor(...GRAY);
  doc.text("This is an estimate. Final charges based on actual/volumetric weight at shipment.", 20, fy2);
  doc.text("Prices valid for 7 days from date of quotation.", 20, fy2 + 5);

  return doc;
}
