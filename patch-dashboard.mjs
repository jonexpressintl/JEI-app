/**
 * JEI Dashboard Patcher
 * Run once: node patch-dashboard.mjs
 * 
 * Reads your existing src/pages/Dashboard.jsx, applies the two feature patches
 * (edit buttons on ORDER/INVOICE rows in InvoiceDoc, edit buttons on cost entries
 * in CostDoc), and writes the result back.
 * 
 * A backup is saved as src/pages/Dashboard.jsx.bak before any changes.
 */

import { readFileSync, writeFileSync, copyFileSync } from "fs";
import { resolve } from "path";

const target = resolve("src/pages/Dashboard.jsx");

// ── Read ──────────────────────────────────────────────────────────────────────
let src;
try {
  src = readFileSync(target, "utf8");
} catch {
  console.error("❌ Could not read", target);
  console.error("   Run this script from your project root (where package.json lives).");
  process.exit(1);
}

// Backup
copyFileSync(target, target + ".bak");
console.log("✅ Backup saved to Dashboard.jsx.bak");

// ── Patch 1: InvoiceDoc — add edit state variables ────────────────────────────
// Find the existing useState block inside InvoiceDoc and append two more lines
const P1_FIND = `  const [saving,setSaving]=useState(false);

  const fxU=+usdRate||ctx.liveFx?.usd_idr||15850;`;
const P1_REPLACE = `  const [saving,setSaving]=useState(false);
  // Edit state for ORDER extra fee rows
  const [editingOEF,setEditingOEF]=useState(null);
  const [oefDraft,setOefDraft]=useState({label:"",qty:"1",amount:"",currency:"USD"});
  // Edit state for INVOICE extra cost rows
  const [editingEC,setEditingEC]=useState(null);
  const [ecDraft,setEcDraft]=useState({label:"",amount:"",currency:"IDR"});

  const fxU=+usdRate||ctx.liveFx?.usd_idr||15850;`;

if (!src.includes(P1_FIND)) {
  console.error("❌ Patch 1 anchor not found — InvoiceDoc saving state. File may already be patched or has changed.");
  process.exit(1);
}
src = src.replace(P1_FIND, P1_REPLACE);
console.log("✅ Patch 1: InvoiceDoc edit state variables added");

// ── Patch 2: InvoiceDoc — ORDER extra fees: add edit/pencil button ────────────
const P2_FIND = `      {/* Order-tab extra fees — deletable */}
      {(order.order_extra_fees||[]).map((ef,i)=>{
        const qty=+ef.qty||1;
        const total=(+ef.amount||0)*qty;
        const label=qty>1?\`\${ef.label||"Additional cost"} ×\${qty}\`:(ef.label||"Additional cost");
        return(
          <div key={"oef-"+i} style={{...S.invLine,background:"var(--gold-bg)"}}>
            <span style={{flex:3,display:"flex",alignItems:"center",gap:6}}>
              <span style={{fontSize:10,background:"var(--gold)",color:"#fff",borderRadius:4,padding:"1px 5px",fontWeight:700,letterSpacing:".04em"}}>ORDER</span>
              {label}
            </span>
            <span style={{flex:1,textAlign:"right"}}>{fmtOrig(total,ef.currency)}</span>
            <span style={{flex:1,textAlign:"right",fontWeight:600}}>{fmtIDR(toIDR(total,ef.currency))}</span>
            <button onClick={async()=>{
              const updated=(order.order_extra_fees||[]).filter((_,j)=>j!==i);
              const patch={order_extra_fees:updated};
              const {error}=await updateOrder(order.id,patch);
              if(!error) patchOrder?patchOrder(order.id,patch):reload&&reload();
            }} style={{width:28,background:"transparent",border:"none",color:"var(--bad)",cursor:"pointer",padding:2,flexShrink:0}}><Trash2 size={13}/></button>
          </div>
        );
      })}`;

const P2_REPLACE = `      {/* Order-tab extra fees — editable + deletable */}
      {(order.order_extra_fees||[]).map((ef,i)=>{
        const qty=+ef.qty||1;
        const total=(+ef.amount||0)*qty;
        const label=qty>1?\`\${ef.label||"Additional cost"} ×\${qty}\`:(ef.label||"Additional cost");
        const isEditing=editingOEF===i;
        return(
          <div key={"oef-"+i} style={{...S.invLine,background:"var(--gold-bg)",flexWrap:"wrap",gap:8}}>
            {isEditing?(
              <div style={{flex:1,display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
                <input style={{...S.input,flex:2,minWidth:120}} value={oefDraft.label} onChange={e=>setOefDraft(d=>({...d,label:e.target.value}))} placeholder="Description"/>
                <input style={{...S.input,width:60}} type="number" value={oefDraft.qty} onChange={e=>setOefDraft(d=>({...d,qty:e.target.value}))} placeholder="Qty"/>
                <input style={{...S.input,width:90}} type="number" value={oefDraft.amount} onChange={e=>setOefDraft(d=>({...d,amount:e.target.value}))} placeholder="Unit amt"/>
                <select style={{...S.input,width:80}} value={oefDraft.currency} onChange={e=>setOefDraft(d=>({...d,currency:e.target.value}))}>
                  <option>USD</option><option>SGD</option><option>IDR</option>
                </select>
                <button onClick={async()=>{
                  const updated=(order.order_extra_fees||[]).map((x,j)=>j===i?{...x,label:oefDraft.label,qty:+oefDraft.qty||1,amount:+oefDraft.amount||0,currency:oefDraft.currency}:x);
                  const patch={order_extra_fees:updated};
                  const {error}=await updateOrder(order.id,patch);
                  if(!error){patchOrder?patchOrder(order.id,patch):reload&&reload();setEditingOEF(null);}
                }} style={{padding:"4px 10px",border:"none",borderRadius:6,background:"var(--good)",color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer",fontFamily:"var(--body)"}}>Save</button>
                <button onClick={()=>setEditingOEF(null)} style={{padding:"4px 10px",border:"none",borderRadius:6,background:"var(--head)",fontSize:12,cursor:"pointer",fontFamily:"var(--body)"}}>Cancel</button>
              </div>
            ):(
              <>
                <span style={{flex:3,display:"flex",alignItems:"center",gap:6}}>
                  <span style={{fontSize:10,background:"var(--gold)",color:"#fff",borderRadius:4,padding:"1px 5px",fontWeight:700,letterSpacing:".04em"}}>ORDER</span>
                  {label}
                </span>
                <span style={{flex:1,textAlign:"right"}}>{fmtOrig(total,ef.currency)}</span>
                <span style={{flex:1,textAlign:"right",fontWeight:600}}>{fmtIDR(toIDR(total,ef.currency))}</span>
                <div style={{display:"flex",gap:4,flexShrink:0}}>
                  <button onClick={()=>{setOefDraft({label:ef.label||"",qty:String(+ef.qty||1),amount:String(+ef.amount||0),currency:ef.currency||"USD"});setEditingOEF(i);}} style={{width:28,background:"transparent",border:"none",color:"var(--ink-3)",cursor:"pointer",padding:2}} title="Edit"><Pencil size={13}/></button>
                  <button onClick={async()=>{
                    const updated=(order.order_extra_fees||[]).filter((_,j)=>j!==i);
                    const patch={order_extra_fees:updated};
                    const {error}=await updateOrder(order.id,patch);
                    if(!error) patchOrder?patchOrder(order.id,patch):reload&&reload();
                  }} style={{width:28,background:"transparent",border:"none",color:"var(--bad)",cursor:"pointer",padding:2}} title="Delete"><Trash2 size={13}/></button>
                </div>
              </>
            )}
          </div>
        );
      })}`;

if (!src.includes(P2_FIND)) {
  console.error("❌ Patch 2 anchor not found — ORDER extra fees block.");
  process.exit(1);
}
src = src.replace(P2_FIND, P2_REPLACE);
console.log("✅ Patch 2: ORDER fee rows now have edit + delete buttons");

// ── Patch 3: InvoiceDoc — INVOICE extra costs: add edit/pencil button ─────────
const P3_FIND = `      {/* Invoice-tab extra costs — deletable (existing behaviour) */}
      {(order.extra_costs||[]).map((ec,i)=>{
        const qty=+ec.qty||1; const t`;

const P3_FIND_FULL_SEARCH = `      {/* Invoice-tab extra costs — deletable (existing behaviour) */}
      {(order.extra_costs||[]).map((ec,i)=>{
        const qty=+ec.qty||1; const total=(+ec.amount||0)*qty;
        const label=qty>1?\`\${ec.label} ×\${qty}\`:ec.label;
        return(
          <div key={"ec-"+i} style={S.invLine}>
            <span style={{flex:3,display:"flex",alignItems:"center",gap:6}}>
              <span style={{fontSize:10,background:"var(--navy)",color:"#fff",borderRadius:4,padding:"1px 5px",fontWeight:700,letterSpacing:".04em"}}>INVOICE</span>
              {label}
            </span>
            <span style={{flex:1,textAlign:"right"}}>{fmtOrig(total,ec.currency)}</span>
            <span style={{flex:1,textAlign:"right",fontWeight:600}}>{fmtIDR(toIDR(total,ec.currency))}</span>
            <button onClick={()=>removeCost(i)} style={{width:28,background:"transparent",border:"none",color:"var(--bad)",cursor:"pointer",padding:2,flexShrink:0}}><Trash2 size={13}/></button>
          </div>
        );
      })}`;

const P3_REPLACE = `      {/* Invoice-tab extra costs — editable + deletable */}
      {(order.extra_costs||[]).map((ec,i)=>{
        const qty=+ec.qty||1; const total=(+ec.amount||0)*qty;
        const label=qty>1?\`\${ec.label} ×\${qty}\`:ec.label;
        const isEditing=editingEC===i;
        return(
          <div key={"ec-"+i} style={{...S.invLine,flexWrap:"wrap",gap:8}}>
            {isEditing?(
              <div style={{flex:1,display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
                <input style={{...S.input,flex:2,minWidth:120}} value={ecDraft.label} onChange={e=>setEcDraft(d=>({...d,label:e.target.value}))} placeholder="Description"/>
                <input style={{...S.input,width:90}} type="number" value={ecDraft.amount} onChange={e=>setEcDraft(d=>({...d,amount:e.target.value}))} placeholder="Amount"/>
                <select style={{...S.input,width:80}} value={ecDraft.currency} onChange={e=>setEcDraft(d=>({...d,currency:e.target.value}))}>
                  <option>IDR</option><option>USD</option><option>SGD</option>
                </select>
                <button onClick={async()=>{
                  const updated=(order.extra_costs||[]).map((x,j)=>j===i?{...x,label:ecDraft.label,amount:+ecDraft.amount||0,currency:ecDraft.currency}:x);
                  const newTotal=Math.round(q.feeLines.reduce((a,l)=>a+toIDR(l.amount,l.currency),0)
                    +(order.order_extra_fees||[]).reduce((a,ef)=>{const q2=+ef.qty||1;return a+toIDR((+ef.amount||0)*q2,ef.currency||"USD");},0)
                    +updated.reduce((a,x)=>{const q2=+x.qty||1;return a+toIDR((+x.amount||0)*q2,x.currency||"IDR");},0));
                  const patch={extra_costs:updated,sell_idr:newTotal};
                  const {error}=await updateOrder(order.id,patch);
                  if(!error){patchOrder?patchOrder(order.id,patch):reload&&reload();setEditingEC(null);}
                }} style={{padding:"4px 10px",border:"none",borderRadius:6,background:"var(--good)",color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer",fontFamily:"var(--body)"}}>Save</button>
                <button onClick={()=>setEditingEC(null)} style={{padding:"4px 10px",border:"none",borderRadius:6,background:"var(--head)",fontSize:12,cursor:"pointer",fontFamily:"var(--body)"}}>Cancel</button>
              </div>
            ):(
              <>
                <span style={{flex:3,display:"flex",alignItems:"center",gap:6}}>
                  <span style={{fontSize:10,background:"var(--navy)",color:"#fff",borderRadius:4,padding:"1px 5px",fontWeight:700,letterSpacing:".04em"}}>INVOICE</span>
                  {label}
                </span>
                <span style={{flex:1,textAlign:"right"}}>{fmtOrig(total,ec.currency)}</span>
                <span style={{flex:1,textAlign:"right",fontWeight:600}}>{fmtIDR(toIDR(total,ec.currency))}</span>
                <div style={{display:"flex",gap:4,flexShrink:0}}>
                  <button onClick={()=>{setEcDraft({label:ec.label||"",amount:String(+ec.amount||0),currency:ec.currency||"IDR"});setEditingEC(i);}} style={{width:28,background:"transparent",border:"none",color:"var(--ink-3)",cursor:"pointer",padding:2}} title="Edit"><Pencil size={13}/></button>
                  <button onClick={()=>removeCost(i)} style={{width:28,background:"transparent",border:"none",color:"var(--bad)",cursor:"pointer",padding:2}} title="Delete"><Trash2 size={13}/></button>
                </div>
              </>
            )}
          </div>
        );
      })}`;

if (!src.includes(P3_FIND)) {
  console.error("❌ Patch 3 anchor not found — INVOICE extra costs block.");
  process.exit(1);
}
src = src.replace(P3_FIND_FULL_SEARCH, P3_REPLACE);
console.log("✅ Patch 3: INVOICE fee rows now have edit + delete buttons");

// ── Patch 4: CostDoc — cost_entries rows: add edit/pencil button ──────────────
const P4_FIND = `      {/* Cost section — add/delete lines */}
      <div style={{...S.addCostBox,borderColor:"var(--bad)"}}>
        <div style={{fontSize:12,fontWeight:700,color:"var(--bad)",letterSpacing:".04em",marginBottom:8}}>COSTS (deducted from revenue)</div>
        {localCosts.map((c,i)=>(
          <div key={c.id} style={{...S.invLine,background:"var(--bad-bg)"}}>
            <span style={{flex:3,color:"var(--bad)"}}>{c.label}</span>
            <span style={{flex:1,textAlign:"right",color:"var(--bad)"}}>{fmtOrig(c.amount,c.currency)}</span>
            <span style={{flex:1,textAlign:"right",fontWeight:600,color:"var(--bad)"}}>−{fmtIDR(toIDR(c.amount,c.currency))}</span>
            <button onClick={()=>removeCost(c.id)} style={{width:28,background:"transparent",border:"none",color:"var(--bad)",cursor:"pointer",padding:2}}><Trash2 size={13}/></button>
          </div>
        ))}`;

const P4_REPLACE = `      {/* Cost section — add/edit/delete lines */}
      <div style={{...S.addCostBox,borderColor:"var(--bad)"}}>
        <div style={{fontSize:12,fontWeight:700,color:"var(--bad)",letterSpacing:".04em",marginBottom:8}}>COSTS (deducted from revenue)</div>
        {localCosts.map((c)=>{
          const isEditing=editingCostId===c.id;
          return(
            <div key={c.id} style={{...S.invLine,background:"var(--bad-bg)",flexWrap:"wrap",gap:8}}>
              {isEditing?(
                <div style={{flex:1,display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
                  <input style={{...S.input,flex:2,minWidth:120}} value={costDraft.label} onChange={e=>setCostDraft(d=>({...d,label:e.target.value}))} placeholder="Description"/>
                  <input style={{...S.input,width:100}} type="number" value={costDraft.amount} onChange={e=>setCostDraft(d=>({...d,amount:e.target.value}))} placeholder="Amount"/>
                  <select style={{...S.input,width:80}} value={costDraft.currency} onChange={e=>setCostDraft(d=>({...d,currency:e.target.value}))}>
                    <option>IDR</option><option>USD</option><option>SGD</option>
                  </select>
                  <button onClick={async()=>{
                    const updated={...c,label:costDraft.label,amount:+costDraft.amount||0,currency:costDraft.currency};
                    await updateCostEntry(c.id,{label:updated.label,amount:updated.amount,currency:updated.currency});
                    setLocalCosts(prev=>prev.map(x=>x.id===c.id?updated:x));
                    setEditingCostId(null);
                  }} style={{padding:"4px 10px",border:"none",borderRadius:6,background:"var(--good)",color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer",fontFamily:"var(--body)"}}>Save</button>
                  <button onClick={()=>setEditingCostId(null)} style={{padding:"4px 10px",border:"none",borderRadius:6,background:"var(--head)",fontSize:12,cursor:"pointer",fontFamily:"var(--body)"}}>Cancel</button>
                </div>
              ):(
                <>
                  <span style={{flex:3,color:"var(--bad)"}}>{c.label}</span>
                  <span style={{flex:1,textAlign:"right",color:"var(--bad)"}}>{fmtOrig(c.amount,c.currency)}</span>
                  <span style={{flex:1,textAlign:"right",fontWeight:600,color:"var(--bad)"}}>−{fmtIDR(toIDR(c.amount,c.currency))}</span>
                  <div style={{display:"flex",gap:4,flexShrink:0}}>
                    <button onClick={()=>{setCostDraft({label:c.label||"",amount:String(c.amount||0),currency:c.currency||"IDR"});setEditingCostId(c.id);}} style={{width:28,background:"transparent",border:"none",color:"var(--ink-3)",cursor:"pointer",padding:2}} title="Edit"><Pencil size={13}/></button>
                    <button onClick={()=>removeCost(c.id)} style={{width:28,background:"transparent",border:"none",color:"var(--bad)",cursor:"pointer",padding:2}} title="Delete"><Trash2 size={13}/></button>
                  </div>
                </>
              )}
            </div>
          );
        })}`;

if (!src.includes(P4_FIND)) {
  console.error("❌ Patch 4 anchor not found — CostDoc cost entries list.");
  process.exit(1);
}
src = src.replace(P4_FIND, P4_REPLACE);
console.log("✅ Patch 4: Cost entries now have edit + delete buttons");

// ── Patch 5: CostDoc — add edit state variables ───────────────────────────────
const P5_FIND = `  const [newCostCur,setNewCostCur]=useState("USD");

  const fxU=+usdRate||ctx.liveFx?.usd_idr||15850;
  const fxS=+sgdRate||ctx.liveFx?.sgd_idr||11900;
  const toIDR=(amt,cur)=>cur==="USD"?(+amt||0)*fxU:cur==="SGD"?`;

const P5_REPLACE = `  const [newCostCur,setNewCostCur]=useState("USD");
  // Edit state for cost entry rows
  const [editingCostId,setEditingCostId]=useState(null);
  const [costDraft,setCostDraft]=useState({label:"",amount:"",currency:"IDR"});

  const fxU=+usdRate||ctx.liveFx?.usd_idr||15850;
  const fxS=+sgdRate||ctx.liveFx?.sgd_idr||11900;
  const toIDR=(amt,cur)=>cur==="USD"?(+amt||0)*fxU:cur==="SGD"?`;

if (!src.includes(P5_FIND)) {
  console.error("❌ Patch 5 anchor not found — CostDoc newCostCur state.");
  process.exit(1);
}
src = src.replace(P5_FIND, P5_REPLACE);
console.log("✅ Patch 5: CostDoc edit state variables added");

// ── Write ─────────────────────────────────────────────────────────────────────
writeFileSync(target, src, "utf8");
console.log("");
console.log("🎉 All patches applied successfully!");
console.log("   Push to GitHub as normal — no other files changed.");
