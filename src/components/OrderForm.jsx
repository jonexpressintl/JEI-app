import { useState, useMemo, useRef, useEffect } from "react";
import { X, Trash2, Plus, ArrowRight, ArrowLeft, Check } from "lucide-react";
import { chargeable, fmtIDR, IN_TO_CM, LB_TO_KG } from "../lib/pricing";
import { addOrder, updateOrder, cascadeDeleteOrder, nextOrderId, addShipment, nextShipmentId, addCustomer, updateCustomer } from "../lib/data";
import ConfirmDialog from "./ConfirmDialog";

const STAGES = ["Package received in US","Sent from US","Received in SG","Sent to ID","Received in ID","Delivered to customer"];

export default function OrderForm({ ctx, order, onClose, onSaved }) {
  const { D } = ctx;
  const editing = !!order;

  const existingCust = D.customers.find(c => c.id === order?.customer_id);

  const [step, setStep] = useState(1);
  const [f, setF] = useState(() => ({
    // step 1: customer
    customer_id: order?.customer_id ?? "",
    customer_name: existingCust?.name ?? "",
    order_date: order?.order_date ?? new Date().toISOString().slice(0, 10),
    states: existingCust?.states ?? "",
    shipping_mark: existingCust?.shipping_mark ?? "",
    contact_person: existingCust?.contact_person ?? "",
    contact_number: existingCust?.contact_number ?? "",
    address: existingCust?.address ?? "",
    // step 2: goods
    product: order?.product ?? "",
    qty: order?.qty ?? 1,
    packages: (order?.packages && order.packages.length > 0) ? order.packages.map(p => ({ ...p, unit: p.unit || "metric" })) : [{ weight: order?.weight_kg ?? 0, l: order?.dim_l_cm ?? 0, w: order?.dim_w_cm ?? 0, h: order?.dim_h_cm ?? 0, unit: "metric" }],
    sell_idr: order?.sell_idr ?? 0,
    sell_currency: order?.sell_currency ?? "IDR",
    sell_input: order?.sell_currency === "USD" ? (order?.sell_idr / (ctx.liveFx?.usd_idr || 15850)).toFixed(2) : (order?.sell_idr ?? 0),
    price_per_kg: order?.price_per_kg ?? (existingCust?.rate_per_kg ?? 0),
    price_currency: order?.price_currency ?? "IDR",
    unit: "metric",
    // shipment
    shipment_mode: order ? "existing" : "new",
    shipment_id: order?.shipment_id ?? (D.shipments[0]?.id ?? ""),
    new_courier: D.couriers[0]?.id ?? "",
    new_eta: "",
  }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const setN = (k) => (e) => setF({ ...f, [k]: e.target.value });

  // convert sell price when currency changes
  function setCurrency(cur) {
    const fx = ctx.liveFx ?? { usd_idr: 15850 };
    let sellIdr = +f.sell_input;
    if (cur === "USD") sellIdr = +f.sell_input * fx.usd_idr;
    else sellIdr = +f.sell_input;
    setF({ ...f, sell_currency: cur, sell_idr: sellIdr });
  }
  function setSellInput(val) {
    const fx = ctx.liveFx ?? { usd_idr: 15850 };
    let sellIdr = +val;
    if (f.sell_currency === "USD") sellIdr = +val * fx.usd_idr;
    setF({ ...f, sell_input: val, sell_idr: sellIdr });
  }

  // Package helpers
  function setPkg(idx, key, val) {
    const pkgs = [...f.packages];
    pkgs[idx] = { ...pkgs[idx], [key]: val };
    setF({ ...f, packages: pkgs });
  }
  function addPkg() { setF({ ...f, packages: [...f.packages, { weight: 0, l: 0, w: 0, h: 0, unit: "metric" }] }); }
  function removePkg(idx) { if (f.packages.length <= 1) return; setF({ ...f, packages: f.packages.filter((_, i) => i !== idx) }); }

  // Convert each package to metric using its own unit
  const metricPkgs = f.packages.map(p => {
    const u = p.unit || "metric";
    return {
      weight: u === "metric" ? +p.weight : +p.weight * LB_TO_KG,
      l: u === "metric" ? +p.l : +p.l * IN_TO_CM,
      w: u === "metric" ? +p.w : +p.w * IN_TO_CM,
      h: u === "metric" ? +p.h : +p.h * IN_TO_CM,
    };
  });

  const courier = D.couriers.find(c => c.id === (f.shipment_mode === "new" ? f.new_courier : D.shipments.find(s => s.id === f.shipment_id)?.courier_id));
  const div = courier?.divisor ?? 5000;
  // Sum chargeable across all packages
  let totalCharged = 0;
  metricPkgs.forEach(p => { const ch = chargeable({ l: p.l, w: p.w, h: p.h }, p.weight, div); totalCharged += ch.charged; });
  const quote = totalCharged * (+f.price_per_kg);

  async function save() {
    setErr(""); setBusy(true);
    try {
      // resolve customer
      let customerId = f.customer_id;
      const custProfile = { states: f.states, shipping_mark: f.shipping_mark, contact_person: f.contact_person, contact_number: f.contact_number, address: f.address };
      if (!customerId && f.customer_name.trim()) {
        const { data, error } = await addCustomer(f.customer_name.trim(), +f.price_per_kg || 0);
        if (error) throw error;
        customerId = data?.[0]?.id;
        if (customerId) await updateCustomer(customerId, custProfile);
      } else if (customerId) {
        // update existing customer profile if fields changed
        await updateCustomer(customerId, { ...custProfile, rate_per_kg: +f.price_per_kg || undefined });
      }
      if (!customerId) throw new Error("Customer name is required.");

      let shipmentId = f.shipment_id;
      if (f.shipment_mode === "new") {
        shipmentId = nextShipmentId(D.shipments);
        const { error } = await addShipment({ id: shipmentId, courier_id: f.new_courier, stage: "Package received in US", eta_id: f.new_eta || null });
        if (error) throw error;
      }
      const payload = {
        customer_id: customerId, shipment_id: shipmentId,
        product: f.product.trim(), qty: +f.qty,
        weight_kg: metricPkgs[0]?.weight || 0,
        dim_l_cm: metricPkgs[0]?.l || 0, dim_w_cm: metricPkgs[0]?.w || 0, dim_h_cm: metricPkgs[0]?.h || 0,
        packages: metricPkgs,
        sell_idr: +f.sell_idr, sell_currency: f.sell_currency,
        price_per_kg: +f.price_per_kg, price_currency: f.price_currency,
        order_date: f.order_date,
      };
      if (editing) {
        payload.id = order.id;
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

  function requestClose() {
    setConfirmDiscard(false);
    onClose();
  }

  return (
    <div style={S.overlay} onClick={requestClose}>
      <div style={S.modal} onClick={e => e.stopPropagation()}>
        <div style={S.head}>
          <div style={S.title}>{editing ? `Edit ${order.id}` : "New order"}</div>
          <div style={S.steps}>
            <span style={step === 1 ? S.stepOn : S.stepOff}>1 · Customer</span>
            <span style={step === 2 ? S.stepOn : S.stepOff}>2 · Goods & pricing</span>
          </div>
          <button style={S.x} onClick={requestClose}><X size={18} /></button>
        </div>

        <div style={S.body}>
          {err && <div style={S.err}>{err}</div>}

          {step === 1 && (<>
            <CustAutocomplete customers={D.customers} value={f.customer_name} selectedId={f.customer_id}
              onChange={(name, id) => {
                const c = D.customers.find(x => x.id === id);
                setF({ ...f, customer_name: name, customer_id: id,
                  states: c?.states || f.states, shipping_mark: c?.shipping_mark || f.shipping_mark,
                  contact_person: c?.contact_person || f.contact_person, contact_number: c?.contact_number || f.contact_number,
                  address: c?.address || f.address, price_per_kg: c?.rate_per_kg || f.price_per_kg });
              }} />
            <Field label="Order date"><input style={S.input} type="date" value={f.order_date} onChange={set("order_date")} /></Field>
            <div style={S.row2}>
              <Field label="States"><input style={S.input} value={f.states} onChange={set("states")} placeholder="e.g. California" /></Field>
              <Field label="Shipping mark"><input style={S.input} value={f.shipping_mark} onChange={set("shipping_mark")} placeholder="Mark / label" /></Field>
            </div>
            <Field label="Contact person"><input style={S.input} value={f.contact_person} onChange={set("contact_person")} placeholder="Name of contact" /></Field>
            <Field label="Contact number"><input style={S.input} value={f.contact_number} onChange={set("contact_number")} placeholder="+1 234 567 8900" /></Field>
            <Field label="Address"><input style={S.input} value={f.address} onChange={set("address")} placeholder="Full shipping address" /></Field>
          </>)}

          {step === 2 && (<>
            <Field label="Product"><input style={S.input} value={f.product} onChange={set("product")} placeholder="e.g. Hydraulic pump" /></Field>

            {/* packages with per-package units */}
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-3)", marginBottom: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>PACKAGES ({f.packages.length})</span>
              <button style={S.togOff} onClick={addPkg}><Plus size={12} /> Add package</button>
            </div>
            {f.packages.map((p, i) => (
              <div key={i} style={S.pkgRow}>
                <span style={{ fontSize: 11, color: "var(--ink-3)", fontWeight: 700, minWidth: 20 }}>#{i + 1}</span>
                <select style={{ ...S.pkgInput, width: 52 }} value={p.unit || "metric"} onChange={e => setPkg(i, "unit", e.target.value)}>
                  <option value="metric">kg</option>
                  <option value="imperial">lb</option>
                </select>
                <input style={S.pkgInput} type="number" placeholder={p.unit === "imperial" ? "lbs" : "kg"} value={p.weight} onChange={e => setPkg(i, "weight", e.target.value)} title="Weight" />
                <input style={S.pkgInput} type="number" placeholder="L" value={p.l} onChange={e => setPkg(i, "l", e.target.value)} />
                <span style={{ color: "var(--ink-3)", fontSize: 12 }}>×</span>
                <input style={S.pkgInput} type="number" placeholder="W" value={p.w} onChange={e => setPkg(i, "w", e.target.value)} />
                <span style={{ color: "var(--ink-3)", fontSize: 12 }}>×</span>
                <input style={S.pkgInput} type="number" placeholder="H" value={p.h} onChange={e => setPkg(i, "h", e.target.value)} />
                <span style={{ fontSize: 11, color: "var(--ink-3)" }}>{p.unit === "imperial" ? "in" : "cm"}</span>
                {f.packages.length > 1 && <button style={S.pkgDel} onClick={() => removePkg(i)}><Trash2 size={12} /></button>}
              </div>
            ))}

            <Field label="Qty (items)"><input style={S.input} type="number" value={f.qty} onChange={set("qty")} /></Field>

            {/* price per kg with currency */}
            <div style={S.row2}>
              <Field label="Price per kg">
                <div style={{ display: "flex", gap: 6 }}>
                  <input style={{ ...S.input, flex: 1 }} type="number" value={f.price_per_kg} onChange={set("price_per_kg")} />
                  <select style={{ ...S.input, width: 75 }} value={f.price_currency} onChange={e => setF({ ...f, price_currency: e.target.value })}>
                    <option value="IDR">IDR</option>
                    <option value="USD">USD</option>
                  </select>
                </div>
              </Field>
              <Field label="Sell price">
                <div style={{ display: "flex", gap: 6 }}>
                  <input style={{ ...S.input, flex: 1 }} type="number" value={f.sell_input} onChange={e => setSellInput(e.target.value)} />
                  <select style={{ ...S.input, width: 75 }} value={f.sell_currency} onChange={e => setCurrency(e.target.value)}>
                    <option value="IDR">IDR</option>
                    <option value="USD">USD</option>
                  </select>
                </div>
                {f.sell_currency === "USD" && <div style={S.fxNote}>≈ {fmtIDR(+f.sell_idr)}</div>}
              </Field>
            </div>

            {/* shipment */}
            <div style={S.shipToggle}>
              <button style={f.shipment_mode === "new" ? S.togOn : S.togOff} onClick={() => setF({ ...f, shipment_mode: "new" })}>Create new shipment</button>
              {D.shipments.length > 0 && <button style={f.shipment_mode === "existing" ? S.togOn : S.togOff} onClick={() => setF({ ...f, shipment_mode: "existing" })}>Add to existing</button>}
            </div>
            {f.shipment_mode === "new" ? (
              <div style={S.row2}>
                <Field label="Courier"><select style={S.input} value={f.new_courier} onChange={set("new_courier")}>
                  {D.couriers.map(c => <option key={c.id} value={c.id}>{c.name} (÷{c.divisor})</option>)}
                </select></Field>
                <Field label="ETA Indonesia"><input style={S.input} type="date" value={f.new_eta} onChange={set("new_eta")} /></Field>
              </div>
            ) : (
              <Field label="Shipment"><select style={S.input} value={f.shipment_id} onChange={set("shipment_id")}>
                {D.shipments.map(s => <option key={s.id} value={s.id}>{s.id} · {D.couriers.find(c => c.id === s.courier_id)?.name} · {s.stage}</option>)}
              </select></Field>
            )}

            {/* live quote */}
            <div style={S.quote}>
              <span>Charged: <b>{totalCharged.toFixed(1)} kg</b> ({f.packages.length} pkg{f.packages.length > 1 ? "s" : ""}, ÷{div})</span>
              <span>Quote: <b style={{ color: "var(--accent)" }}>{fmtIDR(quote)}</b></span>
            </div>
          </>)}
        </div>

        {/* footer */}
        <div style={S.foot}>
          {editing && <button style={S.delBtn} onClick={() => setConfirmDelete(true)} disabled={busy}><Trash2 size={14} /> Delete</button>}
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            {step === 2 && <button style={S.backBtn} onClick={() => setStep(1)}><ArrowLeft size={14} /> Back</button>}
            {step === 1 && <button style={S.nextBtn} onClick={() => { if (!f.customer_name.trim()) { setErr("Customer name is required."); return; } setErr(""); setStep(2); }}> Next <ArrowRight size={14} /></button>}
            {step === 2 && <button style={S.saveBtn} onClick={save} disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Create order"}</button>}
          </div>
        </div>
      </div>

      {confirmDelete && <ConfirmDialog danger title={`Delete ${order.id}?`}
        message="This permanently removes the order. If the shipment has no other orders, it will also be removed."
        confirmLabel="Delete order" busy={busy} onConfirm={doDelete} onCancel={() => setConfirmDelete(false)} />}
      {confirmDiscard && <ConfirmDialog title="Discard changes?"
        message="Close without saving?" confirmLabel="Discard"
        onConfirm={() => { setConfirmDiscard(false); onClose(); }} onCancel={() => setConfirmDiscard(false)} />}
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
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  return (
    <div ref={ref} style={{ position: "relative", marginBottom: 8 }}>
      <Field label="Customer">
        <input style={{ ...S.input, ...(selectedId ? { borderColor: "var(--good)" } : {}) }}
          value={value} onChange={e => { onChange(e.target.value, ""); setOpen(true); }}
          onFocus={() => setOpen(true)} placeholder="Type customer name…" autoComplete="off" />
      </Field>
      {selectedId && <div style={{ fontSize: 11.5, color: "var(--good)", fontWeight: 600, marginTop: 2 }}>✓ Existing customer</div>}
      {!selectedId && value.trim() && <div style={{ fontSize: 11.5, color: "var(--accent)", fontWeight: 600, marginTop: 2 }}><Plus size={11} /> New customer will be created</div>}
      {open && (
        <div style={S.dropdown}>
          {matches.map(c => (
            <button key={c.id} style={S.ddItem} onClick={() => { onChange(c.name, c.id); setOpen(false); }}>
              <span style={{ fontWeight: 600 }}>{c.name}</span>
              <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{c.rate_per_kg ? `${(c.rate_per_kg / 1000).toFixed(0)}k/kg` : ""}</span>
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
  modal: { background: "var(--card)", borderRadius: 16, width: "100%", maxWidth: 520, maxHeight: "90vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,.25)" },
  head: { padding: "18px 20px 14px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" },
  title: { fontFamily: "var(--display)", fontWeight: 800, fontSize: 17 },
  steps: { display: "flex", gap: 6, marginLeft: "auto", marginRight: 8 },
  stepOn: { fontSize: 12, fontWeight: 700, color: "var(--accent)", background: "var(--good-bg)", padding: "4px 10px", borderRadius: 20 },
  stepOff: { fontSize: 12, fontWeight: 600, color: "var(--ink-3)", padding: "4px 10px" },
  x: { background: "transparent", border: "none", cursor: "pointer", color: "var(--ink-3)" },
  body: { padding: "16px 20px", overflowY: "auto", flex: 1 },
  err: { background: "var(--bad-bg)", color: "var(--bad)", padding: "9px 13px", borderRadius: 9, marginBottom: 12, fontSize: 13 },
  field: { display: "block", marginBottom: 10 },
  fLabel: { display: "block", fontSize: 12, fontWeight: 600, color: "var(--ink-3)", marginBottom: 4 },
  input: { width: "100%", border: "1px solid var(--line)", borderRadius: 9, padding: "9px 11px", fontSize: 14, fontFamily: "var(--body)", background: "var(--head)", color: "var(--ink)", outline: "none", boxSizing: "border-box" },
  row2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
  row3: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 },
  toggleRow: { display: "flex", alignItems: "center", gap: 6, marginBottom: 12 },
  toggleLabel: { fontSize: 12, fontWeight: 600, color: "var(--ink-3)" },
  togOn: { fontSize: 12.5, fontWeight: 600, padding: "7px 13px", borderRadius: 8, border: "1px solid var(--accent)", background: "var(--accent)", color: "#fff", cursor: "pointer", fontFamily: "var(--body)" },
  togOff: { fontSize: 12.5, fontWeight: 600, padding: "7px 13px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--card)", color: "var(--ink-2)", cursor: "pointer", fontFamily: "var(--body)" },
  shipToggle: { display: "flex", gap: 8, marginBottom: 12, marginTop: 6 },
  fxNote: { fontSize: 11.5, color: "var(--accent)", fontWeight: 600, marginTop: 2 },
  quote: { display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--head)", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 14px", fontSize: 13, marginTop: 8, flexWrap: "wrap", gap: 8 },
  foot: { padding: "14px 20px", borderTop: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 8 },
  delBtn: { display: "flex", alignItems: "center", gap: 5, background: "var(--bad-bg)", color: "var(--bad)", border: "none", borderRadius: 9, padding: "9px 13px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "var(--body)" },
  backBtn: { display: "flex", alignItems: "center", gap: 5, background: "var(--card)", border: "1px solid var(--line)", color: "var(--ink-2)", borderRadius: 9, padding: "9px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "var(--body)" },
  nextBtn: { display: "flex", alignItems: "center", gap: 5, background: "var(--accent)", color: "#fff", border: "none", borderRadius: 9, padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "var(--body)" },
  saveBtn: { background: "var(--accent)", color: "#fff", border: "none", borderRadius: 9, padding: "9px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "var(--body)" },
  dropdown: { position: "absolute", top: "100%", left: 0, right: 0, background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, marginTop: 4, maxHeight: 160, overflowY: "auto", zIndex: 10, boxShadow: "0 8px 24px rgba(0,0,0,.12)" },
  ddItem: { display: "flex", justifyContent: "space-between", width: "100%", padding: "10px 12px", border: "none", background: "transparent", cursor: "pointer", fontFamily: "var(--body)", fontSize: 13.5, textAlign: "left", borderBottom: "1px solid var(--line)" },
  pkgRow: { display: "flex", alignItems: "center", gap: 6, marginBottom: 8, background: "var(--head)", border: "1px solid var(--line)", borderRadius: 9, padding: "8px 10px" },
  pkgInput: { width: 58, border: "1px solid var(--line)", borderRadius: 7, padding: "7px 6px", fontSize: 13, fontFamily: "var(--body)", background: "var(--card)", color: "var(--ink)", outline: "none", textAlign: "center", boxSizing: "border-box" },
  pkgDel: { display: "grid", placeItems: "center", background: "transparent", border: "none", color: "var(--bad)", cursor: "pointer", padding: 4 },
};
