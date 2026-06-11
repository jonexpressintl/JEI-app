// ── Pure business logic. No UI, no DB. Easy to reason about and test. ──
export const MIN_KG = 3;
export const IN_TO_CM = 2.54;
export const LB_TO_KG = 0.453592;

// chargeable weight = max(actual, volumetric), floored at 3kg
export function chargeable(dims, wtKg, divisor) {
  const vol = (dims.l * dims.w * dims.h) / divisor;
  const greater = Math.max(wtKg, vol);
  const basis = vol > wtKg ? "volumetric" : "actual";
  const raw = Math.max(greater, MIN_KG);
  // Round UP to nearest 0.5 kg (e.g. 3.2 → 3.5, 3.7 → 4.0)
  const charged = Math.ceil(raw * 2) / 2;
  return { vol, greater, charged, basis, minApplied: greater < MIN_KG };
}

export function fmtIDR(n) {
  return "Rp " + Math.round(n).toLocaleString("id-ID");
}
export function fmtShort(n) {
  if (n >= 1e9) return "Rp " + (n / 1e9).toFixed(1) + "M";
  if (n >= 1e6) return "Rp " + (n / 1e6).toFixed(0) + "jt";
  return fmtIDR(n);
}

// Convert a cost line to IDR using current FX
export function toIDR(amount, currency, fx) {
  if (currency === "IDR") return amount;
  if (currency === "USD") return amount * fx.usd_idr;
  if (currency === "SGD") return amount * fx.sgd_idr;
  return amount;
}

// Build a carrier's public tracking URL for a given number.
// Returns null if we don't have a known link for that carrier (still copyable).
export function trackingUrl(carrier, number) {
  if (!number) return null;
  const n = encodeURIComponent(number.trim());
  switch (carrier) {
    case "fedex": return `https://www.fedex.com/fedextrack/?trknbr=${n}`;
    case "dhl":   return `https://www.dhl.com/track?tracking-id=${n}`;
    case "ups":   return `https://www.ups.com/track?tracknum=${n}`;
    case "sea":   return null; // sea freight: usually no public web tracker
    default:      return null;
  }
}

// Multi-piece: calculate total chargeable weight across all packages
export function multiChargeable(packages, divisor) {
  if (!packages || packages.length === 0) return { total: 0, details: [] };
  const details = packages.map((p, i) => {
    const ch = chargeable({ l: +p.l, w: +p.w, h: +p.h }, +p.weight, divisor);
    return { ...ch, index: i };
  });
  const total = details.reduce((a, d) => a + d.charged, 0);
  return { total, details };
}
