import { useState, useMemo, useRef } from "react";
import { Search, Plus, Pencil, Trash2, Check, X, Users, Download, Upload } from "lucide-react";
import { updateCustomer, addCustomerFull, deleteCustomer } from "../lib/data";
import { exportCSV, parseCSV, exportCustomers } from "../lib/csv";
import ConfirmDialog from "./ConfirmDialog";

const FIELDS = [
  { key: "name", label: "Name", required: true },
  { key: "states", label: "States" },
  { key: "shipping_mark", label: "Shipping Mark" },
  { key: "contact_person", label: "Contact Person" },
  { key: "contact_number", label: "Contact Number" },
  { key: "address", label: "Address" },
  { key: "rate_per_kg", label: "Rate/kg", type: "number" },
  { key: "rate_currency", label: "Rate Currency", type: "select", options: ["IDR", "USD"] },
  { key: "notes", label: "Notes", type: "textarea" },
];

const empty = () => ({ name: "", states: "", shipping_mark: "", contact_person: "", contact_number: "", address: "", rate_per_kg: 0, rate_currency: "IDR", notes: "" });

export default function CustomerData({ ctx }) {
  const { D, reload, patchCustomer } = ctx;
  const [q, setQ] = useState("");
  const [editId, setEditId] = useState(null);
  const [editData, setEditData] = useState({});
  const [adding, setAdding] = useState(false);
  const [newData, setNewData] = useState(empty());
  const [confirmDel, setConfirmDel] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  function handleExport() {
    exportCSV(exportCustomers(D.customers), "jei-customers.csv");
  }
  async function handleImport(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const rows = parseCSV(text);
    setBusy(true);
    for (const r of rows) {
      if (!r.name?.trim()) continue;
      const existing = D.customers.find(c => c.name.toLowerCase() === r.name.trim().toLowerCase());
      if (existing) {
        await updateCustomer(existing.id, {
          states: r.states || existing.states, shipping_mark: r.shipping_mark || existing.shipping_mark,
          contact_person: r.contact_person || existing.contact_person, contact_number: r.contact_number || existing.contact_number,
          address: r.address || existing.address, rate_per_kg: +r.rate_per_kg || existing.rate_per_kg,
        });
      } else {
        await addCustomerFull({ name: r.name.trim(), states: r.states || "", shipping_mark: r.shipping_mark || "",
          contact_person: r.contact_person || "", contact_number: r.contact_number || "", address: r.address || "",
          rate_per_kg: +r.rate_per_kg || 0 });
      }
    }
    await reload();
    setBusy(false);
    e.target.value = "";
  }

  const list = useMemo(() =>
    D.customers.filter(c =>
      [c.name, c.states, c.shipping_mark, c.contact_person, c.contact_number, c.address]
        .join(" ").toLowerCase().includes(q.toLowerCase())
    ), [q, D.customers]);

  async function saveEdit() {
    setBusy(true);
    const patch = { ...editData };
    if (patch.rate_per_kg !== undefined) patch.rate_per_kg = +patch.rate_per_kg;
    await updateCustomer(editId, patch);
    patchCustomer && patchCustomer(editId, patch);
    setEditId(null);
    setBusy(false);
  }

  async function saveNew() {
    if (!newData.name.trim()) return;
    setBusy(true);
    await addCustomerFull({ ...newData, rate_per_kg: +newData.rate_per_kg || 0 });
    setAdding(false);
    setNewData(empty());
    await reload();
    setBusy(false);
  }

  async function doDelete() {
    setBusy(true);
    await deleteCustomer(confirmDel.id);
    setConfirmDel(null);
    await reload();
    setBusy(false);
  }

  function startEdit(c) {
    setEditId(c.id);
    setEditData({
      name: c.name || "",
      states: c.states || "",
      shipping_mark: c.shipping_mark || "",
      contact_person: c.contact_person || "",
      contact_number: c.contact_number || "",
      address: c.address || "",
      rate_per_kg: c.rate_per_kg || 0,
      rate_currency: c.rate_currency || "IDR",
      notes: c.notes || "",
    });
  }

  // count orders per customer
  const orderCount = (cid) => D.orders.filter(o => o.customer_id === cid).length;

  return (<>
    <div style={S.lead}>
      <h2 style={S.h2}>Customer Data</h2>
      <p style={S.sub}>Manage customer profiles. Customer info entered during order creation auto-populates here.</p>
    </div>

    <div style={S.topRow}>
      <div style={S.searchWrap}><Search size={15} style={{ opacity: .5 }} /><input style={S.search} placeholder="Search customers…" value={q} onChange={e => setQ(e.target.value)} /></div>
      <div style={{ display: "flex", gap: 6 }}>
        <button style={S.secBtn} onClick={handleExport}><Download size={13} /> Export CSV</button>
        <button style={S.secBtn} onClick={() => fileRef.current?.click()}><Upload size={13} /> Import CSV</button>
        <input ref={fileRef} type="file" accept=".csv" style={{ display: "none" }} onChange={handleImport} />
        <button style={S.addBtn} onClick={() => setAdding(true)}><Plus size={14} /> Add customer</button>
      </div>
    </div>

    {/* add new customer row */}
    {adding && (
      <div style={S.card}>
        <div style={S.cardTitle}>New customer</div>
        <div style={S.grid}>
          {FIELDS.map(fld => (
            <div key={fld.key} style={S.fieldWrap}>
              <label style={S.label}>{fld.label}{fld.required && " *"}</label>
              {fld.type === "select" ? (
                <select style={S.input} value={newData[fld.key]} onChange={e => setNewData({ ...newData, [fld.key]: e.target.value })}>
                  {fld.options.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : fld.type === "textarea" ? (
                <textarea style={{ ...S.input, minHeight: 50 }} value={newData[fld.key]} onChange={e => setNewData({ ...newData, [fld.key]: e.target.value })} placeholder={fld.label} />
              ) : (
                <input style={S.input} type={fld.type || "text"} value={newData[fld.key]}
                  onChange={e => setNewData({ ...newData, [fld.key]: e.target.value })} placeholder={fld.label} />
              )}
            </div>
          ))}
        </div>
        <div style={S.actions}>
          <button style={S.saveBtn} onClick={saveNew} disabled={busy}><Check size={14} /> Save</button>
          <button style={S.cancelBtn} onClick={() => { setAdding(false); setNewData(empty()); }}><X size={14} /> Cancel</button>
        </div>
      </div>
    )}

    {/* customer cards */}
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {list.map(c => {
        const isEditing = editId === c.id;
        const d = isEditing ? editData : c;
        return (
          <div key={c.id} style={S.card}>
            <div style={S.cardTop}>
              <div>
                <span style={S.custName}>{c.name}</span>
                <span style={S.orderBadge}>{orderCount(c.id)} order{orderCount(c.id) !== 1 ? "s" : ""}</span>
              </div>
              {!isEditing && (
                <div style={{ display: "flex", gap: 6 }}>
                  <button style={S.iconBtn} onClick={() => startEdit(c)}><Pencil size={13} /></button>
                  <button style={{ ...S.iconBtn, color: "var(--bad)" }} onClick={() => setConfirmDel(c)}><Trash2 size={13} /></button>
                </div>
              )}
            </div>
            <div style={S.grid}>
              {FIELDS.filter(fld => fld.key !== "name").map(fld => (
                <div key={fld.key} style={S.fieldWrap}>
                  <label style={S.label}>{fld.label}</label>
                  {isEditing ? (
                    fld.type === "select" ? (
                      <select style={S.input} value={d[fld.key] ?? ""} onChange={e => setEditData({ ...editData, [fld.key]: e.target.value })}>
                        {fld.options.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : fld.type === "textarea" ? (
                      <textarea style={{ ...S.input, minHeight: 50 }} value={d[fld.key] ?? ""} onChange={e => setEditData({ ...editData, [fld.key]: e.target.value })} />
                    ) : (
                      <input style={S.input} type={fld.type || "text"} value={d[fld.key] ?? ""}
                        onChange={e => setEditData({ ...editData, [fld.key]: e.target.value })} />
                    )
                  ) : (
                    <div style={S.value}>{
                      fld.key === "rate_per_kg" ? `${c.rate_currency === "USD" ? "$" : "Rp "}${Number(c[fld.key] || 0).toLocaleString()}/kg` :
                      fld.key === "rate_currency" ? (c[fld.key] || "IDR") :
                      (c[fld.key] || "—")
                    }</div>
                  )}
                </div>
              ))}
            </div>
            {isEditing && (
              <div style={S.actions}>
                <button style={S.saveBtn} onClick={saveEdit} disabled={busy}><Check size={14} /> Save</button>
                <button style={S.cancelBtn} onClick={() => setEditId(null)}><X size={14} /> Cancel</button>
              </div>
            )}
          </div>
        );
      })}
      {list.length === 0 && !adding && (
        <div style={{ textAlign: "center", padding: 40, color: "var(--ink-3)" }}>
          <Users size={32} style={{ marginBottom: 12, opacity: .4 }} />
          <div>No customers yet. Add one above, or they'll appear automatically when you create orders.</div>
        </div>
      )}
    </div>

    {confirmDel && (
      <ConfirmDialog
        danger
        title={`Delete ${confirmDel.name}?`}
        message={orderCount(confirmDel.id) > 0
          ? `This customer has ${orderCount(confirmDel.id)} order(s). Deleting will leave those orders without a customer.`
          : "This permanently removes the customer."}
        confirmLabel="Delete customer"
        busy={busy}
        onConfirm={doDelete}
        onCancel={() => setConfirmDel(null)}
      />
    )}
  </>);
}

const S = {
  lead: { marginBottom: 20 },
  h2: { fontFamily: "var(--display)", fontWeight: 800, fontSize: 22, color: "var(--ink)" },
  sub: { fontSize: 13.5, color: "var(--ink-3)", marginTop: 4 },
  topRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" },
  searchWrap: { display: "flex", alignItems: "center", gap: 8, flex: 1, maxWidth: 320 },
  search: { flex: 1, border: "1px solid var(--line)", borderRadius: 9, padding: "8px 11px", fontSize: 14, fontFamily: "var(--body)", background: "var(--head)", color: "var(--ink)", outline: "none" },
  addBtn: { display: "flex", alignItems: "center", gap: 6, background: "var(--accent)", color: "#fff", border: "none", borderRadius: 10, padding: "10px 16px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "var(--body)" },
  secBtn: { display: "flex", alignItems: "center", gap: 5, background: "var(--card)", border: "1px solid var(--line)", color: "var(--ink-2)", borderRadius: 10, padding: "9px 13px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "var(--body)" },
  card: { background: "var(--card)", border: "1px solid var(--line)", borderRadius: 14, padding: 18 },
  cardTop: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  cardTitle: { fontFamily: "var(--display)", fontWeight: 700, fontSize: 15, color: "var(--ink)" },
  custName: { fontFamily: "var(--display)", fontWeight: 700, fontSize: 15, color: "var(--ink)" },
  orderBadge: { fontSize: 11.5, color: "var(--ink-3)", fontWeight: 600, marginLeft: 10, background: "var(--head)", padding: "2px 8px", borderRadius: 20 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 },
  fieldWrap: {},
  label: { display: "block", fontSize: 11, fontWeight: 700, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 4 },
  input: { width: "100%", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 10px", fontSize: 13.5, fontFamily: "var(--body)", background: "var(--head)", color: "var(--ink)", outline: "none", boxSizing: "border-box" },
  value: { fontSize: 13.5, color: "var(--ink)", fontWeight: 500, padding: "8px 0" },
  actions: { display: "flex", gap: 8, marginTop: 14 },
  saveBtn: { display: "flex", alignItems: "center", gap: 5, background: "var(--accent)", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "var(--body)" },
  cancelBtn: { display: "flex", alignItems: "center", gap: 5, background: "var(--card)", border: "1px solid var(--line)", color: "var(--ink-2)", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "var(--body)" },
  iconBtn: { display: "grid", placeItems: "center", background: "var(--card)", border: "1px solid var(--line)", color: "var(--ink-2)", borderRadius: 8, padding: 7, cursor: "pointer" },
};
