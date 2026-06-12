import { useState, useMemo, useRef, useEffect } from "react";
import { X, Trash2, Plus, ArrowRight, ArrowLeft, Check, Package } from "lucide-react";
import { chargeable, fmtIDR, IN_TO_CM, LB_TO_KG } from "../lib/pricing";
import { addOrder, updateOrder, cascadeDeleteOrder, nextOrderId, addShipment, nextShipmentId, addCustomer, updateCustomer } from "../lib/data";
import ConfirmDialog from "./ConfirmDialog";

const US_SG_OPTIONS = ["Airfreight", "FedEx Priority", "FedEx Economy", "FedEx Freight", "Seafreight"];
const SG_ID_OPTIONS = ["Airfreight", "Seafreight"];

function isAir(method) { return method && method !== "Seafreight"; }

// Determine fee structure based on shipping combo
function getFeeMode(usSg, sgId) {
  if (isAir(usSg) && isAir(sgId)) return "air_air";
  if (isAir(usSg) && !isAir(sgId)) return "air_sea";
  return "sea_sea";
}

const FEE_LABELS = {
  air_air: [{ key: "fee_1", label: "Price per weight" }, { key: "fee_additional", label: "Additional cost" }],
  air_sea: [{ key: "fee_1", label: "Airfreight fee" }, { key: "fee_clearance", label: "Clearance fee" }, { key: "fee_2", label: "Seafreight fee" }],
  sea_sea: [{ key: "fee_1", label: "Seafreight 1 (USA→SIN)" }, { key: "fee_clearance", label: "Clearance fee" }, { key: "fee_2", label: "Seafreight 2 (SIN→JKT)" }],
};

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
    new_eta: "",
    order_date: order?.order_date ?? new Date().toISOString().slice(0, 10),
  }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const set = (k) => (e) => setF({ ...f, [k]: typeof e === "string" ? e : e.target.value });
  const setV = (k, v) => setF({ ...f, [k]: v });

  // Package helpers
  function setPkg(i, k, v) { const p = [...f.packages]; p[i] = { ...p[i], [k]: v }; setF({ ...f, packages: p }); }
  function addPkg() { setF({ ...f, packages: [...f.packages, { weight: 0, l: 0, w: 0, h: 0, unit: "metric" }] }); }
  function removePkg(i) { if (f.packages.length > 1) setF({ ...f, packages: f.packages.filter((_, j) => j !== i) }); }

  // Convert packages to metric
  const metricPkgs = f.packages.map(p => {
    const u = p.unit || "metric";
    return { weight: u === "imperial" ? +p.weight * LB_TO_KG : +p.weight, l: u === "imperial" ? +p.l * IN_TO_CM : +p.l, w: u === "imperial" ? +p.w * IN_TO_CM : +p.w, h: u === "imperial" ? +p.h * IN_TO_CM : +p.h };
  });

  // Get courier divisor based on shipping method
  const getDivisor = () => {
    const method = f.shipping_us_sg;
    if (method === "Seafreight") return 6000;
    if (method === "FedEx Freight") return 6000;
    return 5000; // FedEx Priority/Economy/Airfreight
  };

  const div = getDivisor();
  let totalCharged = 0;
  metricPkgs.forEach(p => { totalCharged += chargeable({ l: p.l, w: p.w, h: p.h }, p.weight, div).charged; });

  const feeMode = getFeeMode(f.shipping_us_sg, f.shipping_sg_id);
  const feeFields = FEE_LABELS[feeMode];
  const feeTotal = feeFields.reduce((sum, ff) => sum + (+f[ff.key] || 0), 0);
  const weightPrice = totalCharged * (+f.price_per_kg);
  const grandTotal = feeMode === "air_air" ? weightPrice + (+f.fee_additional || 0) : feeTotal;

  const fmtPrice = (n) => f.price_currency === "USD" ? `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : fmtIDR(n);

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
        shipmentId = nextShipmentId(D.shipments);
        const courierId = f.shipping_us_sg.toLowerCase().includes("fedex") ? "fedex" : f.shipping_us_sg === "Seafreight" ? "sea" : "dhl";
        const { error } = await addShipment({ id: shipmentId, courier_id: courierId, stage: "Package received in US", eta_id: f.new_eta || null });
        if (error) throw error;
      }

      const fx = ctx.liveFx ?? { usd_idr: 15850 };
      const sellIdr = f.price_currency === "USD" ? Math.round(grandTotal * fx.usd_idr) : Math.round(grandTotal);

      const payload = {
        customer_id: customerId, shipment_id: shipmentId,
        product: f.product.trim(), qty: +f.qty,
        weight_kg: metricPkgs[0]?.weight || 0,
        dim_l_cm: metricPkgs[0]?.l || 0, dim_w_cm: metricPkgs[0]?.w || 0, dim_h_cm: metricPkgs[0]?.h || 0,
        packages: metricPkgs, sell_idr: sellIdr, sell_currency: f.price_currency,
        price_per_kg: +f.price_per_kg, price_currency: f.price_currency,
        order_date: f.order_date,
        customer_type: f.customer_type, supplier_name: f.supplier_name,
        country_origin: f.country_origin, destination: f.destination,
        shipping_us_sg: f.shipping_us_sg, shipping_sg_id: f.shipping_sg_id,
        fee_1: +f.fee_1, fee_clearance: +f.fee_clearance, fee_2: +f.fee_2, fee_additional: +f.fee_additional,
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
            <Field label="Order date"><input style={S.input} type="date" value={f.order_date} onChange={set("order_date")} /></Field>
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
              <br />Divisor: ÷{div} · Fee mode: {feeMode.replace("_", " + ")}
            </div>
          </>)}

          {/* ═══ STEP 3: Goods & Pricing ═══ */}
          {step === 3 && (<>
            <Field label="Product description"><input style={S.input} value={f.product} onChange={set("product")} placeholder="e.g. Hydraulic pump parts" /></Field>

            {/* Packages */}
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
              const actualKg = mp.weight;
              const volKg = ch.vol;
              const winner = ch.basis;
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
                  {/* Per-package weight comparison */}
                  <div style={S.pkgBreakdown}>
                    <span style={winner === "actual" ? S.pkgWinner : S.pkgDim}>
                      Actual: {isImperial ? `${(+p.weight).toFixed(2)} lb → ` : ""}{actualKg.toFixed(2)} kg
                    </span>
                    <span style={S.pkgVs}>vs</span>
                    <span style={winner === "volumetric" ? S.pkgWinner : S.pkgDim}>
                      Vol: {volKg.toFixed(2)} kg
                    </span>
                    <span style={S.pkgArrow}>→</span>
                    <span style={S.pkgCharged}>
                      Charged: {ch.charged.toFixed(1)} kg
                      {ch.minApplied ? " (min 3kg)" : ` (${winner})`}
                    </span>
                  </div>
                </div>
              );
            })}

            {/* Totals summary */}
            <div style={S.pkgTotals}>
              <div style={S.pkgTotalRow}>
                <span>Total actual: <b>{metricPkgs.reduce((a, p) => a + p.weight, 0).toFixed(2)} kg</b></span>
                <span>Total volumetric: <b>{metricPkgs.reduce((a, p, i) => { const ch = chargeable({ l: p.l, w: p.w, h: p.h }, p.weight, div); return a + ch.vol; }, 0).toFixed(2)} kg</b></span>
                <span style={{ fontWeight: 700, color: "var(--accent)" }}>Total charged: {totalCharged.toFixed(1)} kg</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{f.packages.length} package{f.packages.length > 1 ? "s" : ""} · ÷{div} · rounded up to nearest 0.5 kg</span>
                <button style={S.addPkgBtn} onClick={addPkg}><Plus size={13} /> ADD PACKAGE</button>
              </div>
            </div>

            <Field label="Qty (items)"><input style={S.input} type="number" value={f.qty} onChange={set("qty")} /></Field>

            {/* Pricing based on fee mode */}
            <div style={S.feeSection}>
              <div style={S.feeSectionTitle}>
                Pricing — {feeMode === "air_air" ? "Air + Air" : feeMode === "air_sea" ? "Air + Sea" : "Sea + Sea"}
              </div>

              {feeMode === "air_air" && (<>
                <div style={S.row2}>
                  <Field label="Rate per kg">
                    <div style={{ display: "flex", gap: 6 }}>
                      <input style={{ ...S.input, flex: 1 }} type="number" value={f.price_per_kg} onChange={set("price_per_kg")} />
                      <select style={{ ...S.input, width: 70 }} value={f.price_currency} onChange={set("price_currency")}>
                        <option value="USD">USD</option><option value="IDR">IDR</option>
                      </select>
                    </div>
                  </Field>
                  <Field label="Additional cost">
                    <input style={S.input} type="number" value={f.fee_additional} onChange={set("fee_additional")} placeholder="0" />
                  </Field>
                </div>
                <div style={S.totalBar}>
                  <span>Weight price: {fmtPrice(weightPrice)}</span>
                  <span>+ Additional: {fmtPrice(+f.fee_additional || 0)}</span>
                  <span style={{ fontWeight: 700 }}>Total: {fmtPrice(grandTotal)}</span>
                </div>
              </>)}

              {feeMode !== "air_air" && (<>
                <div style={S.row3}>
                  {feeFields.map(ff => (
                    <Field key={ff.key} label={ff.label}>
                      <div style={{ display: "flex", gap: 6 }}>
                        <input style={{ ...S.input, flex: 1 }} type="number" value={f[ff.key]} onChange={set(ff.key)} placeholder="0" />
                        <select style={{ ...S.input, width: 70 }} value={f.price_currency} onChange={set("price_currency")}>
                          <option value="USD">USD</option><option value="IDR">IDR</option>
                        </select>
                      </div>
                    </Field>
                  ))}
                </div>
                <div style={S.totalBar}>
                  {feeFields.map((ff, i) => (
                    <span key={ff.key}>{i > 0 ? "+ " : ""}{ff.label}: {fmtPrice(+f[ff.key] || 0)}</span>
                  ))}
                  <span style={{ fontWeight: 700, marginLeft: "auto" }}>Total: {fmtPrice(feeTotal)}</span>
                </div>
              </>)}
            </div>

            {/* Shipment */}
            <div style={S.shipToggle}>
              <button style={f.shipment_mode === "new" ? S.togOn : S.togOff} onClick={() => setV("shipment_mode", "new")}>Create new shipment</button>
              {D.shipments.length > 0 && <button style={f.shipment_mode === "existing" ? S.togOn : S.togOff} onClick={() => setV("shipment_mode", "existing")}>Add to existing</button>}
            </div>
            {f.shipment_mode === "new" ? (
              <Field label="ETA Indonesia"><input style={S.input} type="date" value={f.new_eta} onChange={set("new_eta")} /></Field>
            ) : (
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
      {!selectedId && value.trim() && <div style={{ fontSize: 11, color: "var(--accent)", fontWeight: 600, marginTop: -4, marginBottom: 6 }}><Plus size={11} /> New customer</div>}
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

function Field({ label, children }) {
  return <label style={S.field}><span style={S.fLabel}>{label}</span>{children}</label>;
}

const S = {
  overlay: { position: "fixed", inset: 0, background: "rgba(26,43,42,.5)", display: "grid", placeItems: "center", padding: 16, zIndex: 50, fontFamily: "var(--body)" },
  modal: { background: "var(--card)", borderRadius: 16, width: "100%", maxWidth: 560, maxHeight: "92vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,.25)" },
  head: { padding: "16px 20px 10px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 12 },
  title: { fontFamily: "var(--display)", fontWeight: 800, fontSize: 17 },
  steps: { display: "flex", gap: 4, marginLeft: "auto", marginRight: 8 },
  stepOn: { width: 28, height: 28, borderRadius: "50%", fontSize: 12, fontWeight: 700, color: "#fff", background: "var(--accent)", border: "none", cursor: "pointer", fontFamily: "var(--body)" },
  stepOff: { width: 28, height: 28, borderRadius: "50%", fontSize: 12, fontWeight: 600, color: "var(--ink-3)", background: "var(--head)", border: "1px solid var(--line)", cursor: "pointer", fontFamily: "var(--body)" },
  stepLabel: { padding: "10px 20px 0", fontSize: 13, fontWeight: 700, color: "var(--accent)", letterSpacing: ".02em" },
  x: { background: "transparent", border: "none", cursor: "pointer", color: "var(--ink-3)" },
  body: { padding: "12px 20px 16px", overflowY: "auto", flex: 1 },
  err: { background: "var(--bad-bg)", color: "var(--bad)", padding: "9px 13px", borderRadius: 9, marginBottom: 12, fontSize: 13 },
  field: { display: "block", marginBottom: 10 },
  fLabel: { display: "block", fontSize: 12, fontWeight: 600, color: "var(--ink-3)", marginBottom: 4 },
  input: { width: "100%", border: "1px solid var(--line)", borderRadius: 9, padding: "9px 11px", fontSize: 14, fontFamily: "var(--body)", background: "var(--head)", color: "var(--ink)", outline: "none", boxSizing: "border-box" },
  row2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
  row3: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 },
  segRow: { display: "flex", gap: 6 },
  togOn: { fontSize: 13, fontWeight: 600, padding: "8px 14px", borderRadius: 8, border: "1px solid var(--accent)", background: "var(--accent)", color: "#fff", cursor: "pointer", fontFamily: "var(--body)" },
  togOff: { fontSize: 13, fontWeight: 600, padding: "8px 14px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--card)", color: "var(--ink-2)", cursor: "pointer", fontFamily: "var(--body)" },
  radioGroup: { display: "flex", flexWrap: "wrap", gap: 6 },
  radioOn: { fontSize: 12.5, fontWeight: 600, padding: "9px 14px", borderRadius: 9, border: "2px solid var(--accent)", background: "var(--good-bg)", color: "var(--accent)", cursor: "pointer", fontFamily: "var(--body)" },
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
  addPkgBtn: { display: "flex", alignItems: "center", gap: 5, background: "transparent", border: "none", color: "var(--accent)", fontSize: 12, fontWeight: 700, letterSpacing: ".04em", cursor: "pointer", fontFamily: "var(--body)" },
  pkgBreakdown: { display: "flex", alignItems: "center", gap: 8, padding: "4px 12px 10px 40px", fontSize: 12, flexWrap: "wrap" },
  pkgWinner: { fontWeight: 700, color: "var(--accent)", background: "var(--good-bg)", padding: "2px 8px", borderRadius: 6 },
  pkgDim: { color: "var(--ink-3)" },
  pkgVs: { color: "var(--ink-3)", fontSize: 11, fontStyle: "italic" },
  pkgArrow: { color: "var(--ink-3)", fontSize: 13 },
  pkgCharged: { fontWeight: 700, color: "var(--ink)", fontSize: 12.5 },
  pkgTotals: { background: "var(--head)", border: "1px solid var(--line)", borderRadius: 10, padding: "12px 14px", marginBottom: 14 },
  pkgTotalRow: { display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13, marginBottom: 8, flexWrap: "wrap" },
  foot: { padding: "14px 20px", borderTop: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 8 },
  delBtn: { display: "flex", alignItems: "center", gap: 5, background: "var(--bad-bg)", color: "var(--bad)", border: "none", borderRadius: 9, padding: "9px 13px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "var(--body)" },
  backBtn: { display: "flex", alignItems: "center", gap: 5, background: "var(--card)", border: "1px solid var(--line)", color: "var(--ink-2)", borderRadius: 9, padding: "9px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "var(--body)" },
  nextBtn: { display: "flex", alignItems: "center", gap: 5, background: "var(--accent)", color: "#fff", border: "none", borderRadius: 9, padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "var(--body)" },
  saveBtn: { background: "var(--accent)", color: "#fff", border: "none", borderRadius: 9, padding: "9px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "var(--body)" },
  dropdown: { position: "absolute", top: "100%", left: 0, right: 0, background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, marginTop: 4, maxHeight: 160, overflowY: "auto", zIndex: 10, boxShadow: "0 8px 24px rgba(0,0,0,.12)" },
  ddItem: { display: "flex", justifyContent: "space-between", width: "100%", padding: "10px 12px", border: "none", background: "transparent", cursor: "pointer", fontFamily: "var(--body)", fontSize: 13.5, textAlign: "left", borderBottom: "1px solid var(--line)" },
};
