import { useState, useMemo } from "react";
import { X, Trash2 } from "lucide-react";
import { chargeable, fmtIDR } from "../lib/pricing";
import { addOrder, updateOrder, deleteOrder, nextOrderId, addShipment, nextShipmentId } from "../lib/data";
import ConfirmDialog from "./ConfirmDialog";

const STAGES = ["Package received in US","Sent from US","Received in SG","Sent to ID","Received in ID","Delivered to customer"];

// snapshot used to detect unsaved changes
function initialState(order, D) {
  return {
    customer_id: order?.customer_id ?? D.customers[0]?.id ?? "",
    product: order?.product ?? "",
    qty: order?.qty ?? 1,
    weight_kg: order?.weight_kg ?? 0,
    dim_l_cm: order?.dim_l_cm ?? 0,
    dim_w_cm: order?.dim_w_cm ?? 0,
    dim_h_cm: order?.dim_h_cm ?? 0,
    sell_idr: order?.sell_idr ?? 0,
    shipment_mode: order ? "existing" : "new",
    shipment_id: order?.shipment_id ?? (D.shipments[0]?.id ?? ""),
    new_courier: D.couriers[0]?.id ?? "",
    new_eta: "",
  };
}

// order = null  → create mode; order = {...} → edit mode
export default function OrderForm({ ctx, order, onClose, onSaved }) {
  const { D } = ctx;
  const editing = !!order;

  const [initial] = useState(() => initialState(order, D));
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  // dirty = any field differs from what we opened with
  const dirty = useMemo(
    () => JSON.stringify(f) !== JSON.stringify(initial),
    [f, initial]
  );

  // close handler: if there are unsaved edits, ask first
  function requestClose() {
    if (dirty) setConfirmDiscard(true);
    else onClose();
  }

  // live quote preview
  const divisor = D.couriers.find(c =>
    c.id === (f.shipment_mode === "new"
      ? f.new_courier
      : D.shipments.find(s => s.id === f.shipment_id)?.courier_id))?.divisor ?? 5000;
  const rate = D.customers.find(c => c.id === f.customer_id)?.rate_per_kg ?? 0;
  const qd = chargeable({ l:+f.dim_l_cm, w:+f.dim_w_cm, h:+f.dim_h_cm }, +f.weight_kg, divisor);

  async function save() {
    setErr("");
    if (!f.product.trim()) return setErr("Product name is required.");
    if (!f.customer_id) return setErr("Pick a customer.");
    setBusy(true);
    try {
      let shipmentId = f.shipment_id;
      // create a new shipment if requested
      if (f.shipment_mode === "new") {
        shipmentId = nextShipmentId(D.shipments);
        const { error } = await addShipment({
          id: shipmentId,
          courier_id: f.new_courier,
          stage: "Package received in US",
          eta_id: f.new_eta || null,
        });
        if (error) throw error;
      }
      const payload = {
        customer_id: f.customer_id,
        shipment_id: shipmentId,
        product: f.product.trim(),
        qty: +f.qty,
        weight_kg: +f.weight_kg,
        dim_l_cm: +f.dim_l_cm,
        dim_w_cm: +f.dim_w_cm,
        dim_h_cm: +f.dim_h_cm,
        sell_idr: +f.sell_idr,
      };
      if (editing) {
        const { error } = await updateOrder(order.id, payload);
        if (error) throw error;
      } else {
        const { error } = await addOrder({ id: nextOrderId(D.orders), ...payload });
        if (error) throw error;
      }
      onSaved();
    } catch (e) {
      setErr(e.message ?? "Couldn't save.");
      setBusy(false);
    }
  }

  async function doDelete() {
    setBusy(true);
    const { error } = await deleteOrder(order.id);
    if (error) { setErr(error.message); setBusy(false); setConfirmDelete(false); return; }
    onSaved();
  }

  return (
    <div style={S.overlay} onClick={requestClose}>
      <div style={S.modal} onClick={e=>e.stopPropagation()}>
        <div style={S.head}>
          <div style={S.title}>{editing ? `Edit ${order.id}` : "New order"}</div>
          <button style={S.x} onClick={requestClose}><X size={18}/></button>
        </div>

        <div style={S.body}>
          <Field label="Customer">
            <select style={S.input} value={f.customer_id} onChange={set("customer_id")}>
              {D.customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Product">
            <input style={S.input} value={f.product} onChange={set("product")} placeholder="e.g. Industrial pumps"/>
          </Field>
          <div style={S.grid3}>
            <Field label="Qty"><input type="number" style={S.input} value={f.qty} onChange={set("qty")}/></Field>
            <Field label="Weight (kg)"><input type="number" style={S.input} value={f.weight_kg} onChange={set("weight_kg")}/></Field>
            <Field label="Sell price (IDR)"><input type="number" style={S.input} value={f.sell_idr} onChange={set("sell_idr")}/></Field>
          </div>
          <div style={S.grid3}>
            <Field label="Length (cm)"><input type="number" style={S.input} value={f.dim_l_cm} onChange={set("dim_l_cm")}/></Field>
            <Field label="Width (cm)"><input type="number" style={S.input} value={f.dim_w_cm} onChange={set("dim_w_cm")}/></Field>
            <Field label="Height (cm)"><input type="number" style={S.input} value={f.dim_h_cm} onChange={set("dim_h_cm")}/></Field>
          </div>

          {/* Shipment assignment */}
          <div style={S.shipBox}>
            <div style={S.shipTabs}>
              <button className={"shtab "+(f.shipment_mode==="existing"?"on":"")} onClick={()=>setF({...f,shipment_mode:"existing"})}>Add to existing shipment</button>
              <button className={"shtab "+(f.shipment_mode==="new"?"on":"")} onClick={()=>setF({...f,shipment_mode:"new"})}>Create new shipment</button>
            </div>
            {f.shipment_mode==="existing" ? (
              <Field label="Shipment">
                <select style={S.input} value={f.shipment_id} onChange={set("shipment_id")}>
                  {D.shipments.map(s=><option key={s.id} value={s.id}>{s.id} · {s.stage}</option>)}
                </select>
              </Field>
            ) : (
              <div style={S.grid2}>
                <Field label="Courier">
                  <select style={S.input} value={f.new_courier} onChange={set("new_courier")}>
                    {D.couriers.map(c=><option key={c.id} value={c.id}>{c.name} (÷{c.divisor})</option>)}
                  </select>
                </Field>
                <Field label="ETA Indonesia"><input type="date" style={S.input} value={f.new_eta} onChange={set("new_eta")}/></Field>
              </div>
            )}
          </div>

          {/* Live preview */}
          <div style={S.preview}>
            <span>Charged: <b>{qd.charged.toFixed(1)} kg</b> ({qd.minApplied?"3kg min":qd.basis}, ÷{divisor})</span>
            <span>Quote: <b style={{color:"var(--accent)"}}>{fmtIDR(qd.charged*rate)}</b></span>
          </div>

          {err && <div style={S.err}>{err}</div>}
        </div>

        <div style={S.foot}>
          {editing && <button style={S.delBtn} onClick={()=>setConfirmDelete(true)} disabled={busy}><Trash2 size={14}/> Delete</button>}
          <div style={{marginLeft:"auto",display:"flex",gap:8}}>
            <button style={S.cancel} onClick={requestClose} disabled={busy}>Cancel</button>
            <button style={S.save} onClick={save} disabled={busy}>{busy?"Saving…":editing?"Save changes":"Create order"}</button>
          </div>
        </div>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          danger
          title={`Delete ${order.id}?`}
          message="This permanently removes the order. This can't be undone."
          confirmLabel="Delete order"
          busy={busy}
          onConfirm={doDelete}
          onCancel={()=>setConfirmDelete(false)}
        />
      )}
      {confirmDiscard && (
        <ConfirmDialog
          title="Discard changes?"
          message="You have unsaved changes. Close without saving?"
          confirmLabel="Discard"
          onConfirm={()=>{ setConfirmDiscard(false); onClose(); }}
          onCancel={()=>setConfirmDiscard(false)}
        />
      )}
    </div>
  );
}

function Field({label,children}){return(<label style={S.field}><span style={S.fLabel}>{label}</span>{children}</label>);}

const S = {
  overlay:{position:"fixed",inset:0,background:"rgba(26,43,42,.45)",display:"grid",placeItems:"center",padding:16,zIndex:50,fontFamily:"var(--body)"},
  modal:{background:"var(--card)",borderRadius:16,width:"100%",maxWidth:560,maxHeight:"92vh",overflow:"auto",boxShadow:"0 20px 60px rgba(0,0,0,.25)"},
  head:{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"18px 20px",borderBottom:"1px solid var(--line)"},
  title:{fontFamily:"var(--display)",fontWeight:800,fontSize:18},
  x:{border:"none",background:"transparent",cursor:"pointer",color:"var(--ink-3)",display:"grid",placeItems:"center"},
  body:{padding:20,display:"flex",flexDirection:"column",gap:14},
  grid2:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12},
  grid3:{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12},
  field:{display:"flex",flexDirection:"column",gap:5},
  fLabel:{fontSize:11.5,fontWeight:600,color:"var(--ink-2)"},
  input:{border:"1px solid var(--line)",borderRadius:9,padding:"9px 11px",fontSize:14,fontFamily:"var(--body)",background:"var(--head)",color:"var(--ink)",outline:"none",width:"100%",boxSizing:"border-box"},
  shipBox:{border:"1px solid var(--line)",borderRadius:11,padding:14,display:"flex",flexDirection:"column",gap:12,background:"var(--head)"},
  shipTabs:{display:"flex",gap:6},
  preview:{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap",background:"var(--head)",border:"1px solid var(--line)",borderRadius:10,padding:"11px 13px",fontSize:13.5},
  err:{background:"var(--bad-bg)",color:"var(--bad)",fontSize:13,padding:"9px 12px",borderRadius:9},
  foot:{display:"flex",alignItems:"center",gap:8,padding:"16px 20px",borderTop:"1px solid var(--line)"},
  delBtn:{display:"flex",alignItems:"center",gap:6,background:"var(--bad-bg)",color:"var(--bad)",border:"none",borderRadius:9,padding:"9px 14px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"var(--body)"},
  cancel:{background:"var(--head)",border:"1px solid var(--line)",color:"var(--ink-2)",borderRadius:9,padding:"9px 16px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"var(--body)"},
  save:{background:"var(--accent)",color:"#fff",border:"none",borderRadius:9,padding:"9px 18px",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"var(--body)"},
};
