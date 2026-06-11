import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { chargeable, fmtIDR } from "./pricing";

const INK = [33, 33, 33];
const GRAY = [120, 120, 120];
const ACCENT = [0, 128, 128];

const COMPANY = {
  name: "JON EXPRESS INTERNATIONAL LLC",
  pic: "PIC: Merry Toh",
  addr: ["17826 19th Ave W", "Lynnwood, Washington", "98037, USA"],
  phone: "425-240-3607",
  email: "jonexpressintl@gmail.com",
  banks: [
    { title: "Indonesian Account", lines: ["BCA", "Account name: Merry", "Account number: 5830208790"] },
    { title: "BCA Dollar Account", lines: ["Account name: Merry", "Account number: 5830503333"] },
    { title: "USA Account:", lines: ["Jon Express International LLC", "JPMorgan Chase Bank, N.A", "Account number: 680321962", "Routing Number: 325070760", "Venmo: merrytoh16; Chase: jonexpressintl@gmail.com"] },
  ],
};

function fmtUSD(n) { return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtRp(n) { return "Rp" + Number(Math.round(n)).toLocaleString("id-ID") + ".00"; }

export function generateInvoicePDF(order, customer, shipment, courier, liveFx) {
  const doc = new jsPDF();

  // ── HEADER ──
  doc.setFontSize(22); doc.setFont("helvetica", "bold"); doc.setTextColor(...ACCENT);
  doc.text("Invoice", 195, 18, { align: "right" });

  doc.setFontSize(10); doc.setFont("helvetica", "bold"); doc.setTextColor(...INK);
  doc.text(COMPANY.name, 15, 18);
  doc.setFontSize(9); doc.setFont("helvetica", "normal");
  let y = 25;
  doc.text(COMPANY.pic, 15, y); y += 5;
  COMPANY.addr.forEach(l => { doc.text(l, 15, y); y += 4; });
  doc.text(COMPANY.phone, 15, y); y += 5;
  doc.setTextColor(0, 0, 180); doc.text(COMPANY.email, 15, y);
  doc.setTextColor(...INK);

  // ── INFO BOX ──
  const bx = 108, by = 22, bw = 87, bh = 32;
  doc.setDrawColor(180, 180, 180); doc.setLineWidth(0.3); doc.rect(bx, by, bw, bh);
  doc.line(bx, by + 10, bx + bw, by + 10);
  doc.line(bx, by + 20, bx + bw, by + 20);
  doc.line(bx + 35, by, bx + 35, by + bh);

  const invNo = "INV-JEI/" + String(order.id).replace("ORD-", "");
  doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.setTextColor(...GRAY);
  doc.text("Invoice No.", bx + 2, by + 4);
  doc.text("Invoice Date:", bx + 2, by + 9);
  doc.text("Bill To:", bx + 2, by + 16);
  doc.text("Ship to", bx + 2, by + 24);
  doc.text("Address:", bx + 2, by + 29);

  doc.setFont("helvetica", "bold"); doc.setTextColor(...INK); doc.setFontSize(9);
  doc.text(invNo, bx + 37, by + 5);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8);
  doc.text(order.order_date || "", bx + 37, by + 9);
  doc.setFont("helvetica", "bold"); doc.setFontSize(9);
  doc.text(customer?.name || "—", bx + 37, by + 16);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8);
  const addr = customer?.address || "";
  const addrLines = doc.splitTextToSize(addr, bw - 38);
  addrLines.forEach((l, i) => doc.text(l, bx + 37, by + 25 + i * 4));

  // ── LINE ITEMS ──
  const pkgs = order.packages && order.packages.length > 0
    ? order.packages
    : [{ weight: +order.weight_kg, l: +order.dim_l_cm, w: +order.dim_w_cm, h: +order.dim_h_cm }];
  const div = courier?.divisor || 5000;
  let totalKg = 0;
  pkgs.forEach(p => { const ch = chargeable({ l: +p.l, w: +p.w, h: +p.h }, +p.weight, div); totalKg += ch.charged; });

  const rate = +order.price_per_kg || customer?.rate_per_kg || 0;
  const isUSD = (order.price_currency || order.sell_currency || "IDR") === "USD";
  const sellAmt = isUSD ? totalKg * rate : +order.sell_idr || totalKg * rate;
  const shipDesc = `Shipment ${shipment?.id || "—"} ( USA - JKT by ${courier?.name || "Air"} , ${pkgs.length} ctn${pkgs.length > 1 ? "s" : ""} )`;

  autoTable(doc, {
    startY: 62,
    head: [["Description", "Units", "Price/kg", "Amount"]],
    body: [[shipDesc, totalKg.toFixed(1), isUSD ? fmtUSD(rate) : fmtIDR(rate), isUSD ? fmtUSD(sellAmt) : fmtIDR(sellAmt)]],
    styles: { fontSize: 9, cellPadding: 5, textColor: INK, lineColor: [200, 200, 200], lineWidth: 0.3 },
    headStyles: { fillColor: [235, 235, 235], textColor: INK, fontStyle: "bold", fontSize: 9 },
    columnStyles: { 0: { cellWidth: 85 }, 1: { halign: "right", cellWidth: 25 }, 2: { halign: "right", cellWidth: 35 }, 3: { halign: "right", fontStyle: "bold", cellWidth: 40 } },
    theme: "grid",
    margin: { left: 15, right: 15 },
  });

  // ── TOTALS ──
  const fx = liveFx || { usd_idr: 15850 };
  const convRate = fx.usd_idr || 15850;
  const totalIDR = isUSD ? Math.round(sellAmt * convRate) : Math.round(sellAmt);

  const totData = [
    ["Invoice Subtotal", isUSD ? fmtUSD(sellAmt) : fmtIDR(sellAmt)],
    ["Conversion Rate", isUSD ? fmtRp(convRate) : "—"],
    ["Sales Tax", ""],
    ["Discount", ""],
    ["Deposit Received", ""],
  ];

  autoTable(doc, {
    startY: (doc.lastAutoTable?.finalY ?? 85) + 5,
    body: [
      ...totData.map(([l, v]) => [{ content: l, styles: { halign: "right" } }, v]),
      [{ content: "TOTAL", styles: { halign: "right", fontStyle: "bold", fillColor: [235, 235, 235] } },
       { content: fmtRp(totalIDR), styles: { fontStyle: "bold", fillColor: [235, 235, 235] } }],
    ],
    columnStyles: { 0: { cellWidth: 120 }, 1: { halign: "right", cellWidth: 50 } },
    styles: { fontSize: 9, cellPadding: 4, textColor: INK, lineColor: [200, 200, 200], lineWidth: 0.3 },
    theme: "grid",
    margin: { left: 15, right: 15 },
  });

  // ── BANK DETAILS ──
  let py = (doc.lastAutoTable?.finalY ?? 160) + 10;
  doc.setFontSize(9); doc.setFont("helvetica", "bold"); doc.setTextColor(...ACCENT);
  doc.text("Please remit payment to account:", 15, py); py += 7;

  COMPANY.banks.forEach(bank => {
    doc.setFont("helvetica", "bold"); doc.setTextColor(...INK);
    doc.text(bank.title, 15, py); py += 5;
    doc.setFont("helvetica", "normal");
    bank.lines.forEach(l => { doc.text(l, 15, py); py += 4; });
    py += 3;
  });

  py += 5;
  doc.setFontSize(11); doc.setFont("helvetica", "bold"); doc.setTextColor(...ACCENT);
  doc.text("Thank You for Your Business!", 105, py, { align: "center" });

  return doc;
}

export function generateQuotationPDF({ customerName, packages, divisor, courierName, ratePerKg, priceCurrency }) {
  const doc = new jsPDF();
  const isUSD = priceCurrency === "USD";

  doc.setFontSize(22); doc.setFont("helvetica", "bold"); doc.setTextColor(...ACCENT);
  doc.text("Quotation", 195, 18, { align: "right" });
  doc.setFontSize(10); doc.setFont("helvetica", "bold"); doc.setTextColor(...INK);
  doc.text(COMPANY.name, 15, 18);
  doc.setFontSize(9); doc.setFont("helvetica", "normal");
  doc.text(`Date: ${new Date().toLocaleDateString("en-US")}`, 15, 25);
  doc.text(`Customer: ${customerName || "—"}`, 15, 30);
  doc.text(`Courier: ${courierName} (÷${divisor})`, 15, 35);

  const body = [];
  let totalCharged = 0;
  (packages || []).forEach((p, i) => {
    const ch = chargeable({ l: +p.l, w: +p.w, h: +p.h }, +p.weight, divisor);
    totalCharged += ch.charged;
    body.push([`Pkg ${i + 1}`, `${(+p.weight).toFixed(1)} kg`, `${(+p.l).toFixed(0)}×${(+p.w).toFixed(0)}×${(+p.h).toFixed(0)} cm`, `${ch.vol.toFixed(1)} kg`, `${ch.charged.toFixed(1)} kg`, ch.basis]);
  });

  autoTable(doc, {
    startY: 42, head: [["", "Actual", "Dimensions", "Volumetric", "Charged", "Basis"]], body,
    styles: { fontSize: 9, cellPadding: 4, textColor: INK, lineColor: [200, 200, 200], lineWidth: 0.3 },
    headStyles: { fillColor: [235, 235, 235], textColor: INK, fontStyle: "bold" },
    theme: "grid", margin: { left: 15, right: 15 },
  });

  const total = totalCharged * ratePerKg;
  autoTable(doc, {
    startY: (doc.lastAutoTable?.finalY ?? 80) + 6,
    body: [
      ["Total chargeable", `${totalCharged.toFixed(1)} kg`],
      ["Rate/kg", isUSD ? fmtUSD(ratePerKg) : fmtIDR(ratePerKg)],
      [{ content: "Estimated total", styles: { fontStyle: "bold" } }, { content: isUSD ? fmtUSD(total) : fmtIDR(total), styles: { fontStyle: "bold" } }],
    ],
    columnStyles: { 0: { cellWidth: 100 }, 1: { halign: "right", cellWidth: 50 } },
    styles: { fontSize: 10, cellPadding: 4, textColor: INK, lineColor: [200, 200, 200], lineWidth: 0.3 },
    theme: "grid", margin: { left: 80, right: 15 },
  });

  const fy = (doc.lastAutoTable?.finalY ?? 120) + 8;
  doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.setTextColor(...GRAY);
  doc.text("Estimate only. Final charges based on actual/volumetric weight at shipment. Valid 7 days.", 15, fy);
  return doc;
}
