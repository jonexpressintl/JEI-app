import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { chargeable, fmtIDR } from "./pricing";

const INK = [33, 33, 33];
const GRAY = [120, 120, 120];
const ACCENT = [0, 128, 128];
const LN = [200, 200, 200];
const BG = [245, 245, 245];
const M = { left: 15, right: 15 }; // page margins
const PW = 180; // usable page width (210 - 15 - 15)

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
function fmtRp(n) { return "Rp " + Number(Math.round(n)).toLocaleString("id-ID"); }
function fmtAmt(n, cur) { return cur === "USD" ? fmtUSD(n) : fmtRp(n); }

function companyBlock(doc, startY) {
  let y = startY;
  doc.setFontSize(10); doc.setFont("helvetica", "bold"); doc.setTextColor(...INK);
  doc.text(COMPANY.name, M.left, y); y += 6;
  doc.setFontSize(8); doc.setFont("helvetica", "normal");
  doc.text(COMPANY.pic, M.left, y); y += 4;
  COMPANY.addr.forEach(l => { doc.text(l, M.left, y); y += 4; });
  doc.text(COMPANY.phone, M.left, y); y += 4;
  doc.setTextColor(0, 0, 180); doc.text(COMPANY.email, M.left, y);
  doc.setTextColor(...INK);
  return y + 6;
}

// ═══════════════════════ INVOICE ═══════════════════════

export function generateInvoicePDF(order, customer, shipment, courier, liveFx) {
  const doc = new jsPDF();

  // Title
  doc.setFontSize(24); doc.setFont("helvetica", "bold"); doc.setTextColor(...ACCENT);
  doc.text("Invoice", 195, 20, { align: "right" });

  const cy = companyBlock(doc, 18);

  // Info box
  const bx = 110, by = 18;
  doc.setDrawColor(...LN); doc.setLineWidth(0.3);
  doc.rect(bx, by, 85, 30);
  doc.line(bx, by + 10, bx + 85, by + 10);
  doc.line(bx, by + 20, bx + 85, by + 20);
  doc.line(bx + 32, by, bx + 32, by + 30);

  const invNo = "INV-JEI/" + String(order.id).replace("ORD-", "");
  doc.setFontSize(7.5); doc.setFont("helvetica", "normal"); doc.setTextColor(...GRAY);
  doc.text("Invoice No.", bx + 2, by + 5);
  doc.text("Invoice Date:", bx + 2, by + 15);
  doc.text("Bill To:", bx + 2, by + 25);
  doc.setFont("helvetica", "bold"); doc.setTextColor(...INK); doc.setFontSize(8.5);
  doc.text(invNo, bx + 34, by + 5);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8);
  doc.text(order.order_date || "", bx + 34, by + 15);
  doc.setFont("helvetica", "bold");
  doc.text(customer?.name || "—", bx + 34, by + 25);

  // Ship to address below box
  if (customer?.address) {
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...GRAY);
    doc.text("Ship to: " + customer.address, bx, by + 36);
  }

  // Line items
  const pkgs = order.packages?.length > 0 ? order.packages : [{ weight: +order.weight_kg, l: +order.dim_l_cm, w: +order.dim_w_cm, h: +order.dim_h_cm }];
  const div = courier?.divisor || 5000;
  let totalKg = 0;
  pkgs.forEach(p => { totalKg += chargeable({ l: +p.l, w: +p.w, h: +p.h }, +p.weight, div).charged; });

  const rate = +order.price_per_kg || customer?.rate_per_kg || 0;
  const cur = order.price_currency || "IDR";
  const amt = totalKg * rate;
  const shipDesc = `Shipment ${shipment?.id || "—"} ( USA - JKT by ${courier?.name || "Air"} , ${pkgs.length} ctn${pkgs.length > 1 ? "s" : ""} )`;

  const t1 = autoTable(doc, {
    startY: Math.max(cy, by + 40) + 2,
    head: [["Description", "Units", "Price/kg", "Amount"]],
    body: [[shipDesc, totalKg.toFixed(1), fmtAmt(rate, cur), fmtAmt(amt, cur)]],
    styles: { fontSize: 9, cellPadding: 5, textColor: INK, lineColor: LN, lineWidth: 0.3 },
    headStyles: { fillColor: BG, textColor: INK, fontStyle: "bold" },
    columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right", fontStyle: "bold" } },
    theme: "grid", margin: M,
  });

  // Totals
  const fx = liveFx || { usd_idr: 15850 };
  const totalIDR = cur === "USD" ? Math.round(amt * fx.usd_idr) : Math.round(amt);

  autoTable(doc, {
    startY: (t1?.finalY ?? 100) + 4,
    body: [
      [{ content: "Invoice Subtotal", styles: { halign: "right" } }, fmtAmt(amt, cur)],
      [{ content: "Conversion Rate", styles: { halign: "right" } }, cur === "USD" ? fmtRp(fx.usd_idr) : "—"],
      [{ content: "Sales Tax", styles: { halign: "right" } }, ""],
      [{ content: "Discount", styles: { halign: "right" } }, ""],
      [{ content: "Deposit Received", styles: { halign: "right" } }, ""],
      [{ content: "TOTAL", styles: { halign: "right", fontStyle: "bold", fillColor: BG } },
       { content: fmtRp(totalIDR), styles: { fontStyle: "bold", fillColor: BG } }],
    ],
    columnStyles: { 0: { cellWidth: 110 }, 1: { halign: "right", cellWidth: 70 } },
    styles: { fontSize: 9, cellPadding: 4, textColor: INK, lineColor: LN, lineWidth: 0.3 },
    theme: "grid", margin: M,
  });

  // Bank details
  let py = (doc.lastAutoTable?.finalY ?? 170) + 10;
  doc.setFontSize(9); doc.setFont("helvetica", "bold"); doc.setTextColor(...ACCENT);
  doc.text("Please remit payment to account:", M.left, py); py += 7;
  COMPANY.banks.forEach(bank => {
    doc.setFont("helvetica", "bold"); doc.setTextColor(...INK);
    doc.text(bank.title, M.left, py); py += 4.5;
    doc.setFont("helvetica", "normal");
    bank.lines.forEach(l => { doc.text(l, M.left, py); py += 4; });
    py += 3;
  });
  py += 4;
  doc.setFontSize(11); doc.setFont("helvetica", "bold"); doc.setTextColor(...ACCENT);
  doc.text("Thank You for Your Business!", 105, py, { align: "center" });

  return doc;
}

// ═══════════════════════ QUOTATION ═══════════════════════

export function generateQuotationPDF({ customerName, packages, divisor, courierName, ratePerKg, priceCurrency }) {
  const doc = new jsPDF();
  const cur = priceCurrency || "IDR";

  // Title
  doc.setFontSize(24); doc.setFont("helvetica", "bold"); doc.setTextColor(...ACCENT);
  doc.text("Quotation", 195, 20, { align: "right" });

  // Company info (left)
  doc.setFontSize(10); doc.setFont("helvetica", "bold"); doc.setTextColor(...INK);
  doc.text(COMPANY.name, M.left, 18);
  doc.setFontSize(8); doc.setFont("helvetica", "normal");
  doc.text(COMPANY.pic, M.left, 24);
  COMPANY.addr.forEach((l, i) => doc.text(l, M.left, 28 + i * 4));

  // Quote info (right)
  doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.setTextColor(...GRAY);
  const qno = "QT-" + Date.now().toString(36).toUpperCase().slice(-6);
  const items = [
    ["Quote No:", qno],
    ["Date:", new Date().toLocaleDateString("en-US")],
    ["Customer:", customerName || "—"],
    ["Courier:", `${courierName} (÷${divisor})`],
  ];
  items.forEach(([label, val], i) => {
    doc.setTextColor(...GRAY); doc.text(label, 130, 18 + i * 5);
    doc.setTextColor(...INK); doc.setFont("helvetica", "bold");
    doc.text(val, 160, 18 + i * 5);
    doc.setFont("helvetica", "normal");
  });

  // Separator
  doc.setDrawColor(...ACCENT); doc.setLineWidth(0.5);
  doc.line(M.left, 44, 195, 44);

  // Package breakdown table
  const pkgs = packages || [];
  const body = [];
  let totalCharged = 0, totalActual = 0, totalVol = 0;
  pkgs.forEach((p, i) => {
    const ch = chargeable({ l: +p.l, w: +p.w, h: +p.h }, +p.weight, divisor);
    totalCharged += ch.charged; totalActual += +p.weight; totalVol += ch.vol;
    body.push([
      `Package ${i + 1}`,
      `${(+p.weight).toFixed(1)} kg`,
      `${(+p.l).toFixed(0)} × ${(+p.w).toFixed(0)} × ${(+p.h).toFixed(0)} cm`,
      `${ch.vol.toFixed(1)} kg`,
      `${ch.charged.toFixed(1)} kg`,
      ch.basis + (ch.minApplied ? " (min 3kg)" : ""),
    ]);
  });

  const t1 = autoTable(doc, {
    startY: 50,
    head: [["Package", "Actual Weight", "Dimensions (L×W×H)", "Volumetric", "Charged", "Basis"]],
    body: body,
    styles: { fontSize: 8.5, cellPadding: 5, textColor: INK, lineColor: LN, lineWidth: 0.3 },
    headStyles: { fillColor: BG, textColor: INK, fontStyle: "bold", fontSize: 8 },
    theme: "grid",
    margin: M,
  });

  // Summary totals table
  const total = totalCharged * ratePerKg;
  const t2 = autoTable(doc, {
    startY: (t1?.finalY ?? 80) + 8,
    head: [["", ""]],
    showHead: false,
    body: [
      [{ content: "Total Actual Weight", styles: { fontStyle: "bold" } }, `${totalActual.toFixed(1)} kg`],
      ["Total Volumetric Weight", `${totalVol.toFixed(1)} kg`],
      [{ content: "Total Chargeable Weight", styles: { fontStyle: "bold", fillColor: [220, 245, 240] } },
       { content: `${totalCharged.toFixed(1)} kg`, styles: { fontStyle: "bold", fillColor: [220, 245, 240] } }],
      ["", ""],
      [{ content: "Rate per kg", styles: { fontStyle: "bold" } }, fmtAmt(ratePerKg, cur)],
      [{ content: "Estimated Total", styles: { fontStyle: "bold", fontSize: 11, fillColor: BG } },
       { content: fmtAmt(total, cur), styles: { fontStyle: "bold", fontSize: 11, fillColor: BG } }],
    ],
    columnStyles: { 0: { cellWidth: 100 }, 1: { halign: "right", cellWidth: 80 } },
    styles: { fontSize: 9, cellPadding: 4, textColor: INK, lineColor: LN, lineWidth: 0.3 },
    theme: "grid",
    margin: M,
  });

  // Footer
  const fy = (t2?.finalY ?? 160) + 12;
  doc.setDrawColor(...ACCENT); doc.setLineWidth(0.3);
  doc.line(M.left, fy - 4, 195, fy - 4);

  doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.setTextColor(...GRAY);
  doc.text("This is an estimate only. Final charges are based on actual/volumetric weight at time of shipment.", M.left, fy);
  doc.text("Prices are valid for 7 days from date of quotation.", M.left, fy + 5);

  doc.setFontSize(9); doc.setFont("helvetica", "bold"); doc.setTextColor(...ACCENT);
  doc.text(COMPANY.name, M.left, fy + 16);
  doc.setFont("helvetica", "normal"); doc.setTextColor(...GRAY);
  doc.text(`${COMPANY.phone}  |  ${COMPANY.email}`, M.left, fy + 21);

  return doc;
}
