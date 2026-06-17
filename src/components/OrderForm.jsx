import { useState, useMemo, useRef, useEffect } from "react";
import { X, Trash2, Plus, ArrowRight, ArrowLeft, Check, Package } from "lucide-react";
import { chargeable, finalizeCharged, fmtIDR, IN_TO_CM, LB_TO_KG } from "../lib/pricing";
import { addOrder, updateOrder, cascadeDeleteOrder, nextOrderId, addShipmentSafe, nextShipmentId, addCustomer, updateCustomer, updateShipment } from "../lib/data";
import ConfirmDialog from "./ConfirmDialog";

const US_SG_OPTIONS = ["Airfreight", "FedEx Priority", "FedEx Economy", "FedEx Freight", "Seafreight"];
const SG_ID_OPTIONS = ["Airfreight", "Seafreight"];

function isAir(method) { return method && method !== "Seafreight"; }

export default function OrderForm({ ctx, order, onClose, onSaved }) {
  const { D } = ctx;
  const editing = !!order;
  const existingCust = D.customers.find(c => c.id === order?.customer_id);

  const [step, setStep] = useState(1);
  const [f, setF] = useState(() => ({
    // Step 1: Shipping info
    customer_type: order?.customer_type ?? "direct",
    customer_id: order?.customer_id ?? "",
    customer_name: existingCust?.name ?? "",
    supplier_name: order?.supplier_name ?? "",
    country_origin: order?.country_origin ?? "USA",
    destination: order?.destination ?? "Indonesia",
    contact_person: existingCust?.contact_person ?? "",
    contact_number: existingCust?.contact_number ?? "",
    // Step 2: Means of shipping
    shipping_us_sg: order?.shipping_us_sg ?? "FedEx Priority",
    shipping_sg_id: order?.shipping_sg_id ?? "Airfreight",
    // Step 3: Goods & pricing
    product: order?.product ?? "",
    packages: (order?.packages?.length > 0) ? order.packages.map(p => ({ ...p, unit: p.unit || "metric" })) : [{ weight: 0, l: 0, w: 0, h: 0, unit: "metric" }],
    qty: order?.qty ?? 1,
    price_per_kg: order?.price_per_kg ?? (existingCust?.rate_per_kg ?? 0),
    price_currency: order?.price_currency ?? "USD",
    fee_1: order?.fee_1 ?? 0,
    fee_clearance: order?.fee_clearance ?? 0,
    fee_2: order?.fee_2 ?? 0,
    fee_additional: order?.fee_additional ?? 0,
    fee_1_cur: "USD",
    fee_clearance_cur: "USD",
    fee_2_cur: "IDR",
    fee_additional_cur: "USD",
    air_sea_option: "weight",
    cbm_us_sg: "",
    cbm_sg_id: "",
    charged_override: order?.charged_override ?? "",
    divisor: order?.divisor ?? "",
    order_extra_fees: order?.order_extra_fees ?? [],
    air_weight_basis: order?.air_weight_basis ?? "charged",
    sea_weight_basis: order?.sea_weight_basis ?? "charged",
    // Step 4: Additional notes
    aes_required: order?.aes_required ?? false,
    aes_details: order?.aes_details ?? "",
    pickup_required: order?.pickup_required ?? false,
    pickup_details: order?.pickup_details ?? "",
    additional_info: order?.additional_info ?? "",
    // Shipment
    shipment_mode: order ? "existing" : "new",
    shipment_id: order?.shipment_id ?? (D.shipments[0]?.id ?? ""),
    new_courier: D.couriers[0]?.id ?? "",
    new_eta: (() => { const s = D.shipments.find(s => s.id === order?.shipment_id); return s?.eta_id ?? ""; })(),
    order_date: order?.order_date ?? new Date().toISOString().slice(0, 10),
  }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const set = (k) => (e) => setF({ ...f, [k]: typeof e === "string" ? e : e.target.value });
  const setV = (k, v) => setF({ ...f, [k]: v });

  // Extra fee helpers (multi-line additional costs)
  function addExtraFee() { setF({ ...f, order_extra_fees: [...f.order_extra_fees, { label: "", amount: 0, currency: "USD" }] }); }
  function setExtraFee(i, k, v) { const fees = [...f.order_extra_fees]; fees[i] = { ...fees[i], [k]: v }; setF({ ...f, order_extra_fees: fees }); }
  function removeExtraFee(i) { setF({ ...f, order_extra_fees: f.order_extra_fees.filter((_, j) => j !== i) }); }

  // Package helpers
  function setPkg(i, k, v) { const p = [...f.packages]; p[i] = { ...p[i], [k]: v }; setF({ ...f, packages: p }); }
  function addPkg() { setF({ ...f, packages: [...f.packages, { weight: 0, l: 0, w: 0, h: 0, unit: "metric" }] }); }
  function removePkg(i) { if (f.packages.length > 1) setF({ ...f, packages: f.packages.filter((_, j) => j !== i) }); }

  // Convert packages to metric
  const metricPkgs = f.packages.map(p => {
    const u = p.unit || "metric";
    return { weight: u === "imperial" ? +p.weight * LB_TO_KG : +p.weight, l: u === "imperial" ? +p.l * IN_TO_CM : +p.l, w: u === "imperial" ? +p.w * IN_TO_CM : +p.w, h: u === "imperial" ? +p.h * IN_TO_CM : +p.h };
  });

  // Divisor is now user-selected, not auto-derived
  const div = +f.divisor || 5000;
  // Sum RAW chargeable (unrounded) across all packages, then round total once
  let totalRaw = 0;
  let totalActualKg = 0;
  let totalVolKg = 0;
  metricPkgs.forEach(p => {
    const ch = chargeable({ l: p.l, w: p.w, h: p.h }, p.weight, div);
    totalRaw += ch.raw; totalActualKg += p.weight; totalVolKg += ch.vol;
  });
  const totalChargedAuto = finalizeCharged(totalRaw).charged;
  const totalCharged = +f.charged_override || totalChargedAuto;

  // Per-leg weight for Air+Sea breakdown (user selects basis per leg)
  const getKgByBasis = (basis) => {
    if (basis === "actual") return finalizeCharged(totalActualKg).charged;
    if (basis === "volumetric") return finalizeCharged(totalVolKg).charged;
    return totalCharged; // 'charged' = default greater-of
  };
  const airKg = getKgByBasis(f.air_weight_basis);
  const seaKg = getKgByBasis(f.sea_weight_basis);

  // Fee mode based on shipping combo
  const feeMode = isAir(f.shipping_us_sg) && isAir(f.shipping_sg_id) ? "air_air"
    : isAir(f.shipping_us_sg) && !isAir(f.shipping_sg_id) ? "air_sea" : "sea_sea";

  const weightPrice = totalCharged * (+f.price_per_kg);

  // CBM auto-calculated from packages (L×W×H in cm → cubic meters)
  const autoCBM = metricPkgs.reduce((a, p) => a + (p.l * p.w * p.h) / 1000000, 0);
  const cbmUsSg = +f.cbm_us_sg || autoCBM;
  const cbmSgId = +f.cbm_sg_id || autoCBM;

  // Seafreight totals = rate/CBM × CBM
  const sf1Total = (+f.fee_1 || 0) * cbmUsSg;
  const sf2Total = (+f.fee_2 || 0) * cbmSgId;

  // Air per-kg totals for Air+Sea breakdown
  const airTotal = (+f.fee_1 || 0) * airKg;
  const seaPerKgTotal = (+f.fee_2 || 0) * seaKg;

  // Extra fees total (summed for display; no conversion — that's invoice tab)
  const extraFeesTotal = f.order_extra_fees.reduce((a, ef) => a + (+ef.amount || 0), 0);

  const fmtPrice = (n) => f.price_currency === "USD" ? `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : f.price_currency === "SGD" ? `S$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : fmtIDR(n);
  const fmtFee = (n, cur) => cur === "USD" ? `$${Number(n||0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : cur === "SGD" ? `S$${Number(n||0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : fmtIDR(n||0);

  // No conversion at order time — fees stay in their entered currencies.
  // Conversion happens later in the Invoice tab using per-invoice manual rates.

  async function save() {
    setErr(""); setBusy(true);
    try {
      let customerId = f.customer_id;
      const custProfile = { contact_person: f.contact_person, contact_number: f.contact_number };
      if (!customerId && f.customer_name.trim()) {
        const { data, error } = await addCustomer(f.customer_name.trim(), +f.price_per_kg || 0);
        if (error) throw error;
        customerId = data?.[0]?.id;
        if (customerId) await updateCustomer(customerId, custProfile);
      } else if (customerId) {
        await updateCustomer(customerId, { ...custProfile, rate_per_kg: +f.price_per_kg || undefined });
      }
      if (!customerId) throw new Error("Customer name is required.");

      let shipmentId = f.shipment_id;
      if (f.shipment_mode === "new") {
        const startId = nextShipmentId(D.shipments);
        const courierId = f.shipping_us_sg.toLowerCase().includes("fedex") ? "fedex" : f.shipping_us_sg === "Seafreight" ? "sea" : "dhl";
        const { id, error } = await addShipmentSafe({ id: startId, courier_id: courierId, stage: "Package received in US", eta_id: f.new_eta || null }, D.shipments);
        if (error) throw error;
        shipmentId = id;
      } else if (f.new_eta && f.shipment_id) {
        // Update ETA on existing shipment when editing
        await updateShipment(f.shipment_id, { eta_id: f.new_eta });
      }

      // sell_idr is no longer computed here — conversion happens in the Invoice tab.
      // Store 0 for now; the invoice will calculate and persist the final IDR total.
      const sellIdr = order?.sell_idr || 0;

      const payload = {
        customer_id: customerId, shipment_id: shipmentId,
        product: f.product.trim(), qty: +f.qty,
        weight_kg: metricPkgs[0]?.weight || 0,
        dim_l_cm: metricPkgs[0]?.l || 0, dim_w_cm: metricPkgs[0]?.w || 0, dim_h_cm: metricPkgs[0]?.h || 0,
        packages: metricPkgs, sell_idr: sellIdr, sell_currency: f.price_currency,
        price_per_kg: +f.price_per_kg, price_currency: f.price_currency,
        order_date: f.order_date, divisor: +f.divisor || 5000,
        charged_override: f.charged_override ? +f.charged_override : null,
        customer_type: f.customer_type, supplier_name: f.supplier_name,
        country_origin: f.country_origin, destination: f.destination,
        shipping_us_sg: f.shipping_us_sg, shipping_sg_id: f.shipping_sg_id,
        fee_1: +f.fee_1, fee_clearance: +f.fee_clearance, fee_2: +f.fee_2, fee_additional: +f.fee_additional,
        fee_1_cur: f.fee_1_cur, fee_clearance_cur: f.fee_clearance_cur, fee_2_cur: f.fee_2_cur, fee_additional_cur: f.fee_additional_cur,
        air_sea_option: f.air_sea_option, cbm_us_sg: f.cbm_us_sg ? +f.cbm_us_sg : null, cbm_sg_id: f.cbm_sg_id ? +f.cbm_sg_id : null,
        order_extra_fees: f.order_extra_fees,
        air_weight_basis: f.air_weight_basis, sea_weight_basis: f.sea_weight_basis,
        aes_required: f.aes_required, aes_details: f.aes_details,
        pickup_required: f.pickup_required, pickup_details: f.pickup_details,
        additional_info: f.additional_info,
      };
      if (editing) {
        const { error } = await updateOrder(order.id, payload);
        if (error) throw error;
      } else {
        payload.id = nextOrderId(D.orders);
        const { error } = await addOrder(payload);
        if (error) throw error;
      }
      onSaved();
    } catch (e) { setErr(e.message || "Save failed"); setBusy(false); }
  }

  async function doDelete() {
    setBusy(true);
    const { error } = await cascadeDeleteOrder(order.id, order.shipment_id, D.orders);
    if (error) { setErr(error.message); setBusy(false); setConfirmDelete(false); return; }
    onSaved();
  }

  const STEPS = ["Shipping info", "Means of shipping", "Goods & pricing", "Additional notes"];

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={e => e.stopPropagation()}>
        <div style={S.head}>
          <div style={S.title}>{editing ? `Edit ${order.id}` : "New order"}</div>
          <div style={S.steps}>
            {STEPS.map((s, i) => (
              <button key={i} onClick={() => setStep(i + 1)} style={step === i + 1 ? S.stepOn : S.stepOff}>{i + 1}</button>
            ))}
          </div>
          <button style={S.x} onClick={onClose}><X size={18} /></button>
        </div>
        <div style={S.stepLabel}>{step}. {STEPS[step - 1]}</div>

        <div style={S.body}>
          {err && <div style={S.err}>{err}</div>}

          {/* ═══ STEP 1: Shipping Information ═══ */}
          {step === 1 && (<>
            <Field label="Type of customer">
              <div style={S.segRow}>
                {["direct", "forwarder"].map(t => (
                  <button key={t} style={f.customer_type === t ? S.togOn : S.togOff} onClick={() => setV("customer_type", t)}>
                    {t === "direct" ? "Direct" : "Forwarder customer"}
                  </button>
                ))}
              </div>
            </Field>
            <CustAutocomplete customers={D.customers} value={f.customer_name} selectedId={f.customer_id}
              onChange={(name, id) => {
                const c = D.customers.find(x => x.id === id);
                setF({ ...f, customer_name: name, customer_id: id,
                  contact_person: c?.contact_person || f.contact_person,
                  contact_number: c?.contact_number || f.contact_number,
                  price_per_kg: c?.rate_per_kg || f.price_per_kg });
              }} />
            <Field label="Supplier name (US sender)"><input style={S.input} value={f.supplier_name} onChange={set("supplier_name")} placeholder="Who is shipping from the US?" /></Field>
            <div style={S.row2}>
              <Field label="Country of origin"><input style={S.input} value={f.country_origin} onChange={set("country_origin")} /></Field>
              <Field label="Destination">
                <select style={S.input} value={f.destination} onChange={set("destination")}>
                  <option value="Indonesia">Indonesia</option>
                  <option value="Singapore">Singapore</option>
                </select>
              </Field>
            </div>
            <div style={S.row2}>
              <Field label="Contact person"><input style={S.input} value={f.contact_person} onChange={set("contact_person")} /></Field>
              <Field label="Contact number"><input style={S.input} value={f.contact_number} onChange={set("contact_number")} /></Field>
            </div>
            <div style={S.row2}>
              <Field label="Order date"><input style={S.input} type="date" value={f.order_date} onChange={set("order_date")} /></Field>
              <Field label={`ETA ${f.destination}`}><input style={S.input} type="date" value={f.new_eta} onChange={set("new_eta")} /></Field>
            </div>
          </>)}

          {/* ═══ STEP 2: Means of Shipping ═══ */}
          {step === 2 && (<>
            <Field label="USA → Singapore">
              <div style={S.radioGroup}>
                {US_SG_OPTIONS.map(opt => (
                  <button key={opt} style={f.shipping_us_sg === opt ? S.radioOn : S.radioOff} onClick={() => setV("shipping_us_sg", opt)}>
                    {opt}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Singapore → Jakarta">
              <div style={S.radioGroup}>
                {SG_ID_OPTIONS.map(opt => (
                  <button key={opt} style={f.shipping_sg_id === opt ? S.radioOn : S.radioOff} onClick={() => setV("shipping_sg_id", opt)}>
                    {opt}
                  </button>
                ))}
              </div>
            </Field>
            <div style={S.infoBox}>
              <Package size={14} /> Route: {f.shipping_us_sg} (USA→SIN) + {f.shipping_sg_id} (SIN→JKT)
            </div>
          </>)}

          {/* ═══ STEP 3: Goods & Pricing ═══ */}
          {step === 3 && (<>
            <Field label="Product description"><input style={S.input} value={f.product} onChange={set("product")} placeholder="e.g. Hydraulic pump parts" /></Field>

            <Field label="Volumetric divisor *">
              <select style={{...S.input, ...(!f.divisor ? {borderColor:"var(--bad)"} : {})}} value={f.divisor} onChange={set("divisor")}>
                <option value="">Select divisor…</option>
                <option value="5000">÷ 5000 (Air standard)</option>
                <option value="6000">÷ 6000 (Sea / Freight)</option>
              </select>
              {!f.divisor && <div style={{fontSize:11.5,color:"var(--bad)",marginTop:3}}>Required — pick a divisor before continuing</div>}
            </Field>

            {/* Packages — ADD PACKAGE button prominent at top */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={S.pkgColLabel}>PACKAGES ({f.packages.length})</div>
              <button style={S.addPkgBtnLg} onClick={addPkg}><Plus size={14} /> Add new package</button>
            </div>
            <div style={S.pkgHeader}>
              <span style={{ flex: "0 0 28px" }}></span>
              <span style={S.pkgColLabel}>WEIGHT</span>
              <span style={{ ...S.pkgColLabel, flex: 3, textAlign: "center" }}>DIMENSIONS  L × W × H</span>
              <span style={{ width: 28 }}></span>
            </div>
            {f.packages.map((p, i) => {
              const u = p.unit || "metric";
              const mp = metricPkgs[i];
              const ch = chargeable({ l: mp.l, w: mp.w, h: mp.h }, mp.weight, div);
              const isImperial = u === "imperial";
              return (
                <div key={i}>
                  <div style={S.pkgRow}>
                    <span style={{ flex: "0 0 28px", fontSize: 12, color: "var(--ink-3)", fontWeight: 700 }}>{i + 1}</span>
                    <div style={S.pkgCell}>
                      <input style={S.pkgInput} type="number" value={p.weight} onChange={e => setPkg(i, "weight", e.target.value)} placeholder="0" />
                      <select style={S.pkgUnit} value={u} onChange={e => setPkg(i, "unit", e.target.value)}>
                        <option value="metric">kg</option><option value="imperial">lb</option>
                      </select>
                    </div>
                    <div style={{ ...S.pkgCell, flex: 3, gap: 4 }}>
                      <input style={S.pkgDimInput} type="number" value={p.l} onChange={e => setPkg(i, "l", e.target.value)} placeholder="L" />
                      <span style={S.pkgX}>×</span>
                      <input style={S.pkgDimInput} type="number" value={p.w} onChange={e => setPkg(i, "w", e.target.value)} placeholder="W" />
                      <span style={S.pkgX}>×</span>
                      <input style={S.pkgDimInput} type="number" value={p.h} onChange={e => setPkg(i, "h", e.target.value)} placeholder="H" />
                      <select style={S.pkgUnit} value={u} onChange={e => setPkg(i, "unit", e.target.value)}>
                        <option value="metric">cm</option><option value="imperial">in</option>
                      </select>
                    </div>
                    {f.packages.length > 1 ? <button style={S.pkgDel} onClick={() => removePkg(i)}><Trash2 size={14} /></button> : <span style={{ width: 28 }} />}
                  </div>
                  <div style={S.pkgBreakdown}>
                    <span style={ch.basis === "actual" ? S.pkgWinner : S.pkgDim}>
                      Actual: {isImperial ? `${(+p.weight).toFixed(2)} lb → ` : ""}{mp.weight.toFixed(2)} kg
                    </span>
                    <span style={S.pkgVs}>vs</span>
                    <span style={ch.basis === "volumetric" ? S.pkgWinner : S.pkgDim}>Vol: {ch.vol.toFixed(2)} kg</span>
                    <span style={S.pkgArrow}>→</span>
                    <span style={S.pkgCharged}>{ch.raw.toFixed(2)} kg ({ch.basis})</span>
                  </div>
                </div>
              );
            })}

            <div style={S.pkgTotals}>
              <div style={S.pkgTotalRow}>
                <span>Total actual: <b>{metricPkgs.reduce((a, p) => a + p.weight, 0).toFixed(2)} kg</b></span>
                <span>Total vol: <b>{metricPkgs.reduce((a, p) => a + chargeable({ l: p.l, w: p.w, h: p.h }, p.weight, div).vol, 0).toFixed(2)} kg</b></span>
                <span>Auto charged: <b>{totalChargedAuto.toFixed(1)} kg</b>{totalRaw < 3 ? <span style={{color:"var(--navy)",fontWeight:600}}> (3kg min applied)</span> : ""}</span>
              </div>
              <div style={{...S.pkgTotalRow, alignItems:"center", borderTop:"1px solid var(--line)", paddingTop:8, marginTop:2}}>
                <label style={{display:"flex",alignItems:"center",gap:8,flex:1}}>
                  <span style={{fontSize:12.5,fontWeight:600,color:"var(--ink-2)"}}>Override charged weight (kg)</span>
                  <input type="number" value={f.charged_override} onChange={set("charged_override")}
                    placeholder={totalChargedAuto.toFixed(1)} style={{...S.input,width:90,textAlign:"center",padding:"6px 8px",fontSize:13,fontWeight:700,
                    ...(f.charged_override ? {borderColor:"var(--navy)",color:"var(--navy)"} : {})}} />
                </label>
                <span style={{ fontWeight: 700, color: "var(--navy)", fontSize: 14 }}>
                  Final: {totalCharged.toFixed(1)} kg
                  {f.charged_override && totalCharged < totalChargedAuto ? ` (↓${(totalChargedAuto - totalCharged).toFixed(1)} discount)` : ""}
                </span>
              </div>
              <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{f.packages.length} pkg · ÷{div} · rounded ↑ 0.5 kg</span>
            </div>

            <Field label="Qty (items)"><input style={S.input} type="number" value={f.qty} onChange={set("qty")} /></Field>

            {/* ── PRICING SECTION ── */}
            <div style={S.feeSection}>
              <div style={S.feeSectionTitle}>
                Pricing — {feeMode === "air_air" ? "Air + Air" : feeMode === "air_sea" ? "Air + Sea" : "Sea + Sea"}
              </div>

              {/* ── AIR + AIR: rate per kg + additional ── */}
              {/* Reusable extra fees block */}
              <ExtraFees fees={f.order_extra_fees} onAdd={addExtraFee} onChange={setExtraFee} onRemove={removeExtraFee} fmtFee={fmtFee} S={S}/>

              {feeMode === "air_air" && (<>
                <div style={S.row2}>
                  <Field label="Rate per kg">
                    <div style={{ display: "flex", gap: 4 }}>
                      <input style={{ ...S.input, flex: 1 }} type="number" value={f.price_per_kg} onChange={set("price_per_kg")} />
                      <select style={{ ...S.input, width: 65 }} value={f.price_currency} onChange={set("price_currency")}>
                        <option value="USD">USD</option><option value="SGD">SGD</option><option value="IDR">IDR</option>
                      </select>
                    </div>
                  </Field>
                </div>
                <div style={S.totalBar}>
                  <span>Weight: {fmtFee(weightPrice, f.price_currency)}</span>
                  {f.order_extra_fees.map((ef,i)=><span key={i}>+ {ef.label||"Extra"}: {fmtFee(+ef.amount||0,ef.currency)}</span>)}
                </div>
              </>)}

              {feeMode === "air_sea" && (<>
                <Field label="Pricing method">
                  <select style={S.input} value={f.air_sea_option} onChange={set("air_sea_option")}>
                    <option value="weight">Price per weight</option>
                    <option value="breakdown">Airfreight per-kg + Seafreight</option>
                  </select>
                </Field>

                {f.air_sea_option === "weight" ? (<>
                  <div style={S.row2}>
                    <Field label="Rate per kg">
                      <div style={{ display: "flex", gap: 4 }}>
                        <input style={{ ...S.input, flex: 1 }} type="number" value={f.price_per_kg} onChange={set("price_per_kg")} />
                        <select style={{ ...S.input, width: 65 }} value={f.price_currency} onChange={set("price_currency")}>
                          <option value="USD">USD</option><option value="SGD">SGD</option><option value="IDR">IDR</option>
                        </select>
                      </div>
                    </Field>
                  </div>
                  <div style={S.totalBar}>
                    <span>Weight: {fmtFee(weightPrice, f.price_currency)}</span>
                    {f.order_extra_fees.map((ef,i)=><span key={i}>+ {ef.label||"Extra"}: {fmtFee(+ef.amount||0,ef.currency)}</span>)}
                  </div>
                </>) : (<>
                  {/* Air leg — rate per kg with weight basis selector */}
                  <div style={S.feeSectionTitle}>Airfreight leg (USA→SIN)</div>
                  <div style={S.row2}>
                    <Field label="Rate per kg (air)">
                      <div style={{display:"flex",gap:4}}>
                        <input style={{...S.input,flex:1}} type="number" value={f.fee_1} onChange={set("fee_1")} placeholder="0"/>
                        <select style={{...S.input,width:65}} value={f.fee_1_cur} onChange={set("fee_1_cur")}><option value="USD">USD</option><option value="SGD">SGD</option><option value="IDR">IDR</option></select>
                      </div>
                    </Field>
                    <Field label="Weight basis (air)">
                      <select style={S.input} value={f.air_weight_basis} onChange={set("air_weight_basis")}>
                        <option value="charged">Greater-of ({totalCharged.toFixed(1)} kg)</option>
                        <option value="volumetric">Volumetric ({finalizeCharged(totalVolKg).charged.toFixed(1)} kg)</option>
                        <option value="actual">Actual ({finalizeCharged(totalActualKg).charged.toFixed(1)} kg)</option>
                      </select>
                    </Field>
                  </div>
                  <div style={S.totalBar}><span>Air: {fmtFee(+f.fee_1,f.fee_1_cur)}/kg × {airKg.toFixed(1)} kg = {fmtFee((+f.fee_1||0)*airKg,f.fee_1_cur)}</span></div>

                  {/* Sea leg — rate per CBM */}
                  <div style={{...S.feeSectionTitle,marginTop:10}}>Seafreight leg (SIN→JKT)</div>
                  <div style={S.row2}>
                    <Field label="SF rate/CBM (SIN→JKT)">
                      <div style={{display:"flex",gap:4}}>
                        <input style={{...S.input,flex:1}} type="number" value={f.fee_2} onChange={set("fee_2")} placeholder="0"/>
                        <select style={{...S.input,width:65}} value={f.fee_2_cur} onChange={set("fee_2_cur")}><option value="USD">USD</option><option value="SGD">SGD</option><option value="IDR">IDR</option></select>
                      </div>
                    </Field>
                    <Field label={`CBM SIN→JKT (auto: ${autoCBM.toFixed(3)})`}>
                      <input style={S.input} type="number" value={f.cbm_sg_id} onChange={set("cbm_sg_id")} placeholder={autoCBM.toFixed(3)}/>
                    </Field>
                  </div>
                  <div style={S.totalBar}>
                    <span>Air total: {fmtFee((+f.fee_1||0)*airKg,f.fee_1_cur)}</span>
                    <span>+ SF: {fmtFee(+f.fee_2,f.fee_2_cur)}/CBM × {cbmSgId.toFixed(2)} = {fmtFee(sf2Total,f.fee_2_cur)}</span>
                    {f.order_extra_fees.map((ef,i)=><span key={i}>+ {ef.label||"Extra"}: {fmtFee(+ef.amount||0,ef.currency)}</span>)}
                  </div>
                </>)}
              </>)}

              {feeMode === "sea_sea" && (<>
                <div style={S.row2}>
                  <Field label="SF1 rate/CBM (USA→SIN)">
                    <div style={{display:"flex",gap:4}}>
                      <input style={{...S.input,flex:1}} type="number" value={f.fee_1} onChange={set("fee_1")} placeholder="0"/>
                      <select style={{...S.input,width:65}} value={f.fee_1_cur} onChange={set("fee_1_cur")}><option value="USD">USD</option><option value="SGD">SGD</option><option value="IDR">IDR</option></select>
                    </div>
                  </Field>
                  <Field label="SF2 rate/CBM (SIN→JKT)">
                    <div style={{display:"flex",gap:4}}>
                      <input style={{...S.input,flex:1}} type="number" value={f.fee_2} onChange={set("fee_2")} placeholder="0"/>
                      <select style={{...S.input,width:65}} value={f.fee_2_cur} onChange={set("fee_2_cur")}><option value="USD">USD</option><option value="SGD">SGD</option><option value="IDR">IDR</option></select>
                    </div>
                  </Field>
                </div>
                <div style={S.row2}>
                  <Field label={`CBM USA→SIN (auto: ${autoCBM.toFixed(3)})`}>
                    <input style={S.input} type="number" value={f.cbm_us_sg} onChange={set("cbm_us_sg")} placeholder={autoCBM.toFixed(3)}/>
                  </Field>
                  <Field label={`CBM SIN→JKT (auto: ${autoCBM.toFixed(3)})`}>
                    <input style={S.input} type="number" value={f.cbm_sg_id} onChange={set("cbm_sg_id")} placeholder={autoCBM.toFixed(3)}/>
                  </Field>
                </div>
                <div style={S.totalBar}>
                  <span>SF1: {fmtFee(+f.fee_1,f.fee_1_cur)}/CBM × {cbmUsSg.toFixed(2)} = {fmtFee(sf1Total,f.fee_1_cur)}</span>
                  <span>+ SF2: {fmtFee(+f.fee_2,f.fee_2_cur)}/CBM × {cbmSgId.toFixed(2)} = {fmtFee(sf2Total,f.fee_2_cur)}</span>
                  {f.order_extra_fees.map((ef,i)=><span key={i}>+ {ef.label||"Extra"}: {fmtFee(+ef.amount||0,ef.currency)}</span>)}
                </div>
              </>)}
            </div>

            {/* Shipment */}
            <div style={S.shipToggle}>
              <button style={f.shipment_mode === "new" ? S.togOn : S.togOff} onClick={() => setV("shipment_mode", "new")}>Create new shipment</button>
              {D.shipments.length > 0 && <button style={f.shipment_mode === "existing" ? S.togOn : S.togOff} onClick={() => setV("shipment_mode", "existing")}>Add to existing</button>}
            </div>
            {f.shipment_mode === "existing" && (
              <Field label="Shipment"><select style={S.input} value={f.shipment_id} onChange={set("shipment_id")}>
                {D.shipments.map(s => <option key={s.id} value={s.id}>{s.id} · {s.stage}</option>)}
              </select></Field>
            )}
          </>)}

          {/* ═══ STEP 4: Additional Notes ═══ */}
          {step === 4 && (<>
            <Field label="AES Filing required?">
              <div style={S.segRow}>
                <button style={f.aes_required ? S.togOn : S.togOff} onClick={() => setV("aes_required", true)}>Yes</button>
                <button style={!f.aes_required ? S.togOn : S.togOff} onClick={() => setV("aes_required", false)}>No</button>
              </div>
            </Field>
            {f.aes_required && (
              <Field label="AES Filing details"><textarea style={{ ...S.input, minHeight: 60 }} value={f.aes_details} onChange={set("aes_details")} placeholder="Filing details, reference numbers…" /></Field>
            )}

            <Field label="Pickup Details?">
              <div style={S.segRow}>
                <button style={f.pickup_required ? S.togOn : S.togOff} onClick={() => setV("pickup_required", true)}>Yes</button>
                <button style={!f.pickup_required ? S.togOn : S.togOff} onClick={() => setV("pickup_required", false)}>No</button>
              </div>
            </Field>
            {f.pickup_required && (
              <Field label="Pickup details"><textarea style={{ ...S.input, minHeight: 60 }} value={f.pickup_details} onChange={set("pickup_details")} placeholder="Pickup address, time, instructions…" /></Field>
            )}

            <Field label="Additional Information">
              <textarea style={{ ...S.input, minHeight: 100 }} value={f.additional_info} onChange={set("additional_info")} placeholder="Links, notes, special instructions… This field supports long text and links." />
            </Field>
          </>)}
        </div>

        {/* Footer */}
        <div style={S.foot}>
          {editing && <button style={S.delBtn} onClick={() => setConfirmDelete(true)} disabled={busy}><Trash2 size={14} /> Delete</button>}
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            {step > 1 && <button style={S.backBtn} onClick={() => setStep(step - 1)}><ArrowLeft size={14} /> Back</button>}
            {step < 4 && <button style={S.nextBtn} onClick={() => {
              if (step === 1 && !f.customer_name.trim()) { setErr("Customer name is required."); return; }
              if (step === 3 && !f.divisor) { setErr("Please select a volumetric divisor before continuing."); return; }
              setErr(""); setStep(step + 1);
            }}>Next <ArrowRight size={14} /></button>}
            {step === 4 && <button style={S.saveBtn} onClick={save} disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Create order"}</button>}
          </div>
        </div>
      </div>

      {confirmDelete && <ConfirmDialog danger title={`Delete ${order.id}?`}
        message="This permanently removes the order and any empty shipment."
        confirmLabel="Delete" busy={busy} onConfirm={doDelete} onCancel={() => setConfirmDelete(false)} />}
    </div>
  );
}

// ── Customer autocomplete ──
function CustAutocomplete({ customers, value, selectedId, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const matches = useMemo(() => {
    if (!value.trim()) return customers;
    return customers.filter(c => c.name.toLowerCase().includes(value.toLowerCase()));
  }, [value, customers]);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, []);
  return (
    <div ref={ref} style={{ position: "relative", marginBottom: 8 }}>
      <Field label="Customer name (recipient)">
        <input style={{ ...S.input, ...(selectedId ? { borderColor: "var(--good)" } : {}) }}
          value={value} onChange={e => { onChange(e.target.value, ""); setOpen(true); }}
          onFocus={() => setOpen(true)} placeholder="Type customer name…" autoComplete="off" />
      </Field>
      {selectedId && <div style={{ fontSize: 11, color: "var(--good)", fontWeight: 600, marginTop: -4, marginBottom: 6 }}>✓ Existing customer</div>}
      {!selectedId && value.trim() && <div style={{ fontSize: 11, color: "var(--navy)", fontWeight: 600, marginTop: -4, marginBottom: 6 }}><Plus size={11} /> New customer</div>}
      {open && (
        <div style={S.dropdown}>
          {matches.map(c => (
            <button key={c.id} style={S.ddItem} onClick={() => { onChange(c.name, c.id); setOpen(false); }}>
              <span style={{ fontWeight: 600 }}>{c.name}</span>
              <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{c.rate_per_kg ? `${c.rate_currency === "USD" ? "$" : ""}${c.rate_per_kg.toLocaleString()}/kg` : ""}</span>
            </button>
          ))}
          {matches.length === 0 && <div style={{ padding: "10px 12px", fontSize: 13, color: "var(--ink-3)" }}>No matches</div>}
        </div>
      )}
    </div>
  );
}

// ── Reusable multi-line extra fees block ──
function ExtraFees({ fees, onAdd, onChange, onRemove, fmtFee, S }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-3)", letterSpacing: ".04em" }}>ADDITIONAL COSTS</span>
        <button style={S.addPkgBtn} onClick={onAdd}><Plus size={12} /> Add cost</button>
      </div>
      {fees.length === 0 && (
        <div style={{ fontSize: 12.5, color: "var(--ink-3)", padding: "8px 0" }}>No additional costs. Click "Add cost" to add one.</div>
      )}
      {fees.map((ef, i) => (
        <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
          <input style={{ ...S.input, flex: 2 }} placeholder="Description (e.g. Clearance fee, Handling...)" value={ef.label} onChange={e => onChange(i, "label", e.target.value)} />
          <input style={{ ...S.input, width: 90, textAlign: "right" }} type="number" placeholder="0" value={ef.amount} onChange={e => onChange(i, "amount", e.target.value)} />
          <select style={{ ...S.input, width: 65 }} value={ef.currency} onChange={e => onChange(i, "currency", e.target.value)}>
            <option value="USD">USD</option><option value="SGD">SGD</option><option value="IDR">IDR</option>
          </select>
          <button style={{ background: "transparent", border: "none", color: "var(--bad)", cursor: "pointer", padding: 4 }} onClick={() => onRemove(i)}><Trash2 size={14} /></button>
        </div>
      ))}
    </div>
  );
}

function Field({ label, children }) {
  return <label style={S.field}><span style={S.fLabel}>{label}</span>{children}</label>;
}

const S = {
  overlay: { position: "fixed", inset: 0, background: "rgba(26,43,42,.5)", display: "grid", placeItems: "center", padding: 16, zIndex: 50, fontFamily: "var(--body)" },
  modal: { background: "var(--card)", borderRadius: 16, width: "100%", maxWidth: 560, maxHeight: "92vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,.25)" },
  head: { padding: "16px 20px 10px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 12 },
  title: { fontFamily: "var(--display)", fontWeight: 800, fontSize: 17 },
  steps: { display: "flex", gap: 4, marginLeft: "auto", marginRight: 8 },
  stepOn: { width: 28, height: 28, borderRadius: "50%", fontSize: 12, fontWeight: 700, color: "#fff", background: "var(--navy)", border: "none", cursor: "pointer", fontFamily: "var(--body)" },
  stepOff: { width: 28, height: 28, borderRadius: "50%", fontSize: 12, fontWeight: 600, color: "var(--ink-3)", background: "var(--head)", border: "1px solid var(--line)", cursor: "pointer", fontFamily: "var(--body)" },
  stepLabel: { padding: "10px 20px 0", fontSize: 13, fontWeight: 700, color: "var(--navy)", letterSpacing: ".02em" },
  x: { background: "transparent", border: "none", cursor: "pointer", color: "var(--ink-3)" },
  body: { padding: "12px 20px 16px", overflowY: "auto", flex: 1 },
  err: { background: "var(--bad-bg)", color: "var(--bad)", padding: "9px 13px", borderRadius: 9, marginBottom: 12, fontSize: 13 },
  field: { display: "block", marginBottom: 10 },
  fLabel: { display: "block", fontSize: 12, fontWeight: 600, color: "var(--ink-3)", marginBottom: 4 },
  input: { width: "100%", border: "1px solid var(--line)", borderRadius: 9, padding: "9px 11px", fontSize: 14, fontFamily: "var(--body)", background: "var(--head)", color: "var(--ink)", outline: "none", boxSizing: "border-box" },
  row2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
  row3: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 },
  segRow: { display: "flex", gap: 6 },
  togOn: { fontSize: 13, fontWeight: 600, padding: "8px 14px", borderRadius: 8, border: "1px solid var(--navy)", background: "var(--navy)", color: "#fff", cursor: "pointer", fontFamily: "var(--body)" },
  togOff: { fontSize: 13, fontWeight: 600, padding: "8px 14px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--card)", color: "var(--ink-2)", cursor: "pointer", fontFamily: "var(--body)" },
  radioGroup: { display: "flex", flexWrap: "wrap", gap: 6 },
  radioOn: { fontSize: 12.5, fontWeight: 600, padding: "9px 14px", borderRadius: 9, border: "2px solid var(--navy)", background: "var(--good-bg)", color: "var(--navy)", cursor: "pointer", fontFamily: "var(--body)" },
  radioOff: { fontSize: 12.5, fontWeight: 500, padding: "9px 14px", borderRadius: 9, border: "1px solid var(--line)", background: "var(--card)", color: "var(--ink-2)", cursor: "pointer", fontFamily: "var(--body)" },
  infoBox: { background: "var(--head)", border: "1px solid var(--line)", borderRadius: 10, padding: "12px 14px", fontSize: 13, color: "var(--ink-2)", display: "flex", alignItems: "flex-start", gap: 8, lineHeight: 1.6, marginTop: 8 },
  feeSection: { background: "var(--head)", border: "1px solid var(--line)", borderRadius: 12, padding: 16, marginBottom: 12 },
  feeSectionTitle: { fontSize: 12, fontWeight: 700, color: "var(--ink-3)", letterSpacing: ".04em", marginBottom: 10, textTransform: "uppercase" },
  totalBar: { display: "flex", flexWrap: "wrap", gap: "8px 16px", alignItems: "center", background: "var(--card)", border: "1px solid var(--line)", borderRadius: 9, padding: "10px 14px", fontSize: 13, marginTop: 10 },
  shipToggle: { display: "flex", gap: 8, marginBottom: 10, marginTop: 6 },
  pkgHeader: { display: "flex", alignItems: "center", gap: 8, padding: "0 12px", marginBottom: 6 },
  pkgColLabel: { fontSize: 11, fontWeight: 700, color: "var(--ink-3)", letterSpacing: ".04em", flex: 1 },
  pkgRow: { display: "flex", alignItems: "center", gap: 8, marginBottom: 8, background: "var(--head)", border: "1px solid var(--line)", borderRadius: 9, padding: "10px 12px" },
  pkgCell: { display: "flex", alignItems: "center", gap: 4, flex: 1 },
  pkgInput: { width: "100%", flex: 1, border: "1px solid var(--line)", borderRadius: 7, padding: "8px 6px", fontSize: 13, fontFamily: "var(--body)", background: "var(--card)", color: "var(--ink)", outline: "none", textAlign: "center", boxSizing: "border-box" },
  pkgDimInput: { width: "100%", flex: 1, border: "1px solid var(--line)", borderRadius: 7, padding: "8px 4px", fontSize: 13, fontFamily: "var(--body)", background: "var(--card)", color: "var(--ink)", outline: "none", textAlign: "center", boxSizing: "border-box" },
  pkgUnit: { border: "1px solid var(--line)", borderRadius: 7, padding: "7px 2px", fontSize: 12, fontFamily: "var(--body)", background: "var(--card)", color: "var(--ink-3)", outline: "none", cursor: "pointer", width: 42, flexShrink: 0 },
  pkgX: { color: "var(--ink-3)", fontSize: 13, fontWeight: 600, flexShrink: 0 },
  pkgDel: { display: "grid", placeItems: "center", background: "transparent", border: "none", color: "var(--bad)", cursor: "pointer", padding: 4, width: 28, flexShrink: 0 },
  addPkgBtn: { display: "flex", alignItems: "center", gap: 5, background: "transparent", border: "none", color: "var(--navy)", fontSize: 12, fontWeight: 700, letterSpacing: ".04em", cursor: "pointer", fontFamily: "var(--body)" },
  addPkgBtnLg: { display: "flex", alignItems: "center", gap: 6, background: "var(--navy)", color: "#fff", border: "none", borderRadius: 9, padding: "8px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "var(--body)" },
  pkgBreakdown: { display: "flex", alignItems: "center", gap: 8, padding: "4px 12px 10px 40px", fontSize: 12, flexWrap: "wrap" },
  pkgWinner: { fontWeight: 700, color: "var(--navy)", background: "var(--good-bg)", padding: "2px 8px", borderRadius: 6 },
  pkgDim: { color: "var(--ink-3)" },
  pkgVs: { color: "var(--ink-3)", fontSize: 11, fontStyle: "italic" },
  pkgArrow: { color: "var(--ink-3)", fontSize: 13 },
  pkgCharged: { fontWeight: 700, color: "var(--ink)", fontSize: 12.5 },
  pkgTotals: { background: "var(--head)", border: "1px solid var(--line)", borderRadius: 10, padding: "12px 14px", marginBottom: 14 },
  pkgTotalRow: { display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13, marginBottom: 8, flexWrap: "wrap" },
  foot: { padding: "14px 20px", borderTop: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 8 },
  delBtn: { display: "flex", alignItems: "center", gap: 5, background: "var(--bad-bg)", color: "var(--bad)", border: "none", borderRadius: 9, padding: "9px 13px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "var(--body)" },
  backBtn: { display: "flex", alignItems: "center", gap: 5, background: "var(--card)", border: "1px solid var(--line)", color: "var(--ink-2)", borderRadius: 9, padding: "9px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "var(--body)" },
  nextBtn: { display: "flex", alignItems: "center", gap: 5, background: "var(--navy)", color: "#fff", border: "none", borderRadius: 9, padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "var(--body)" },
  saveBtn: { background: "var(--navy)", color: "#fff", border: "none", borderRadius: 9, padding: "9px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "var(--body)" },
  dropdown: { position: "absolute", top: "100%", left: 0, right: 0, background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, marginTop: 4, maxHeight: 160, overflowY: "auto", zIndex: 10, boxShadow: "0 8px 24px rgba(0,0,0,.12)" },
  ddItem: { display: "flex", justifyContent: "space-between", width: "100%", padding: "10px 12px", border: "none", background: "transparent", cursor: "pointer", fontFamily: "var(--body)", fontSize: 13.5, textAlign: "left", borderBottom: "1px solid var(--line)" },
};
