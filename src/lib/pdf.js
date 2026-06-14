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

  // Line items — from feeLines (multi-currency, computed by quote())
  const isAirM = (m) => m && m !== "Seafreight";
  const div = +order.divisor || 5000;
  const pkgs = order.packages?.length > 0 ? order.packages : [{ weight: +order.weight_kg, l: +order.dim_l_cm, w: +order.dim_w_cm, h: +order.dim_h_cm }];
  let totalRaw = 0;
  pkgs.forEach(p => { totalRaw += chargeable({ l: +p.l, w: +p.w, h: +p.h }, +p.weight, div).raw; });
  const chargedAuto = Math.ceil(totalRaw * 2) / 2;
  const charged = +order.charged_override || chargedAuto;
  const rate = +order.price_per_kg || customer?.rate_per_kg || 0;

  const feeMode = isAirM(order.shipping_us_sg) && isAirM(order.shipping_sg_id) ? "air_air"
    : isAirM(order.shipping_us_sg) && !isAirM(order.shipping_sg_id) ? "air_sea" : "sea_sea";
  const autoCBM = pkgs.reduce((a,p)=>a+((+p.l)*(+p.w)*(+p.h))/1000000,0);
  const cbmA = +order.cbm_us_sg || autoCBM;
  const cbmB = +order.cbm_sg_id || autoCBM;
  const sf1Total = (+order.fee_1||0) * cbmA;
  const sf2Total = (+order.fee_2||0) * cbmB;

  let feeLines = [];
  const weightPrice = charged * rate;
  if (feeMode === "air_air" || (feeMode === "air_sea" && order.air_sea_option !== "breakdown")) {
    feeLines.push({ label: `Shipment ${shipment?.id || "—"} (${order.shipping_us_sg||"Air"} / ${order.shipping_sg_id||"Air"}, ${pkgs.length} pkg, ${charged.toFixed(1)}kg)`, amount: weightPrice, currency: order.price_currency || "USD" });
    if (+order.fee_additional) feeLines.push({ label: "Additional cost", amount: +order.fee_additional, currency: order.fee_additional_cur || "USD" });
  } else if (feeMode === "air_sea") {
    if (+order.fee_1) feeLines.push({ label: "Airfreight fee", amount: +order.fee_1, currency: order.fee_1_cur || "USD" });
    if (+order.fee_clearance) feeLines.push({ label: "Clearance fee", amount: +order.fee_clearance, currency: order.fee_clearance_cur || "SGD" });
    if (+order.fee_2) feeLines.push({ label: `Seafreight (${cbmB.toFixed(2)} CBM)`, amount: sf2Total, currency: order.fee_2_cur || "IDR" });
    if (+order.fee_additional) feeLines.push({ label: "Additional cost", amount: +order.fee_additional, currency: order.fee_additional_cur || "USD" });
  } else {
    if (+order.fee_1) feeLines.push({ label: `Seafreight USA→SIN (${cbmA.toFixed(2)} CBM)`, amount: sf1Total, currency: order.fee_1_cur || "USD" });
    if (+order.fee_clearance) feeLines.push({ label: "Clearance fee", amount: +order.fee_clearance, currency: order.fee_clearance_cur || "SGD" });
    if (+order.fee_2) feeLines.push({ label: `Seafreight SIN→JKT (${cbmB.toFixed(2)} CBM)`, amount: sf2Total, currency: order.fee_2_cur || "IDR" });
    if (+order.fee_additional) feeLines.push({ label: "Additional cost", amount: +order.fee_additional, currency: order.fee_additional_cur || "USD" });
  }
  (order.extra_costs||[]).forEach(ec => feeLines.push({ label: ec.label, amount: +ec.amount, currency: ec.currency || "IDR" }));

  const fx = liveFx || { usd_idr: 15850, sgd_idr: 11900 };
  const toIDR = (amt, c) => c === "USD" ? (+amt||0) * fx.usd_idr : c === "SGD" ? (+amt||0) * fx.sgd_idr : (+amt||0);

  const t1 = autoTable(doc, {
    startY: Math.max(cy, by + 40) + 2,
    head: [["Description", "Amount", "In IDR"]],
    body: feeLines.length > 0 ? feeLines.map(l => [l.label, fmtAmt(l.amount, l.currency), fmtRp(toIDR(l.amount, l.currency))]) : [["No fee lines recorded", "", ""]],
    styles: { fontSize: 8.5, cellPadding: 5, textColor: INK, lineColor: LN, lineWidth: 0.3 },
    headStyles: { fillColor: BG, textColor: INK, fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: 100 }, 1: { halign: "right", cellWidth: 40 }, 2: { halign: "right", cellWidth: 40 } },
    theme: "grid", margin: M,
  });

  // Totals
  const totalIDR = feeLines.reduce((a,l)=>a+toIDR(l.amount,l.currency),0);

  autoTable(doc, {
    startY: (t1?.finalY ?? 100) + 4,
    body: [
      [{ content: "USD → IDR rate", styles: { halign: "right" } }, fmtRp(fx.usd_idr)],
      [{ content: "SGD → IDR rate", styles: { halign: "right" } }, fmtRp(fx.sgd_idr)],
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

  // Title bar
  doc.setFillColor(...ACCENT);
  doc.rect(0, 0, 210, 12, "F");
  doc.setFontSize(16); doc.setFont("helvetica", "bold"); doc.setTextColor(255, 255, 255);
  doc.text("Quotation", 105, 9, { align: "center" });

  // Company info (left)
  let y = 22;
  doc.setFontSize(10); doc.setFont("helvetica", "bold"); doc.setTextColor(...INK);
  doc.text(COMPANY.name, M.left, y); y += 5;
  doc.setFontSize(8); doc.setFont("helvetica", "normal");
  doc.text(COMPANY.pic, M.left, y); y += 4;
  COMPANY.addr.forEach(l => { doc.text(l, M.left, y); y += 4; });
  doc.text(COMPANY.phone, M.left, y); y += 4;
  doc.setTextColor(0, 0, 180); doc.text(COMPANY.email, M.left, y);
  doc.setTextColor(...INK);

  // Quote info box (right)
  const bx = 120, by = 20, bw = 75, bh = 24;
  doc.setDrawColor(...LN); doc.setLineWidth(0.3);
  doc.rect(bx, by, bw, bh);
  doc.line(bx, by + 6, bx + bw, by + 6);
  doc.line(bx, by + 12, bx + bw, by + 12);
  doc.line(bx, by + 18, bx + bw, by + 18);
  doc.line(bx + 28, by, bx + 28, by + bh);

  const qno = "QT-" + Date.now().toString(36).toUpperCase().slice(-6);
  doc.setFontSize(7.5); doc.setFont("helvetica", "normal"); doc.setTextColor(...GRAY);
  doc.text("Quote No:", bx + 2, by + 4.5);
  doc.text("Date:", bx + 2, by + 10.5);
  doc.text("Customer:", bx + 2, by + 16.5);
  doc.text("Courier:", bx + 2, by + 22.5);
  doc.setFont("helvetica", "bold"); doc.setTextColor(...INK); doc.setFontSize(8);
  doc.text(qno, bx + 30, by + 4.5);
  doc.setFont("helvetica", "normal");
  doc.text(new Date().toLocaleDateString("en-US"), bx + 30, by + 10.5);
  doc.setFont("helvetica", "bold");
  doc.text(customerName || "—", bx + 30, by + 16.5);
  doc.setFont("helvetica", "normal");
  doc.text(`${courierName} (÷${divisor})`, bx + 30, by + 22.5);

  // Separator
  const sepY = 50;
  doc.setDrawColor(...ACCENT); doc.setLineWidth(0.5);
  doc.line(M.left, sepY, 195, sepY);

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
    startY: sepY + 6,
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
