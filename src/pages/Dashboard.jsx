import { useState, useMemo, useRef, useEffect } from "react";
import { Package, Ship, Truck, Eye, EyeOff, Search, ChevronRight, AlertCircle, CheckCircle2, FileText, Calculator, Tag, LayoutGrid, Plus, Printer, LogOut, RefreshCw, Pencil, Boxes, Circle, CreditCard, ExternalLink, Copy, Check, Download, Upload, Users, DollarSign, TrendingUp } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useJEIData, updateCustomerRate, addCustomer, setShipmentStage, setShipmentPayment, setShipmentTracking, completeOrder } from "../lib/data";
import { chargeable, fmtIDR, fmtShort, toIDR, trackingUrl, MIN_KG, IN_TO_CM, LB_TO_KG } from "../lib/pricing";
import { generateInvoicePDF, generateQuotationPDF } from "../lib/pdf";
import { fetchLiveRates } from "../lib/fx";
import { exportCSV, exportOrders } from "../lib/csv";
import OrderForm from "../components/OrderForm";
import CustomerData from "../components/CustomerData";
import { LOGO } from "../lib/logo";

const STAGES = ["Package received in US","Sent from US","Received in SG","Sent to ID","Received in ID","Delivered to customer"];
const PAYMENTS = ["Unpaid","Invoiced","Paid"];
// Tracking legs: db field, carrier field, friendly label
const LEGS = [
  { num:"track_us_sg",   carrier:"track_us_sg_carrier",   label:"US → SG" },
  { num:"track_sg_id",   carrier:"track_sg_id_carrier",   label:"SG → ID" },
  { num:"track_id_cust", carrier:"track_id_cust_carrier", label:"ID → Customer" },
];
const CARRIERS = ["fedex","dhl","ups","sea","other"];
const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}) : "—";

export default function Dashboard() {
  const { profile, isOwner, signOut } = useAuth();
  const D = useJEIData();
  const [tab, setTab] = useState("orders");
  const [liveFx, setLiveFx] = useState(null);

  useEffect(() => { fetchLiveRates().then(setLiveFx); }, []);

  if (D.loading) return <Center>Loading JEI data…</Center>;
  if (D.error) return <Center>Couldn't load data: {D.error}</Center>;

  // index helpers
  const custName = (id) => D.customers.find(c=>c.id===id)?.name ?? "—";
  const custRate = (id) => D.customers.find(c=>c.id===id)?.rate_per_kg ?? 0;
  const courierOf = (id) => D.couriers.find(c=>c.id===id);
  const shipmentOf = (id) => D.shipments.find(s=>s.id===id);
  const costsFor = (sid) => D.costs.filter(c=>c.shipment_id===sid);

  const quote = (o) => {
    const s = shipmentOf(o.shipment_id);
    const div = courierOf(s?.courier_id)?.divisor ?? 5000;
    const { vol, charged, basis, minApplied } = chargeable(
      { l:o.dim_l_cm, w:o.dim_w_cm, h:o.dim_h_cm }, o.weight_kg, div);
    const rate = Number(o.price_per_kg) || custRate(o.customer_id);
    return { vol, charged, basis, minApplied, rate, price: charged*rate, divisor: div };
  };
  const shipCostIDR = (sid) => costsFor(sid).reduce((a,c)=>a+toIDR(c.amount,c.currency,D.fx),0);
  const orderCostIDR = (o) => {
    const sib = D.orders.filter(x=>x.shipment_id===o.shipment_id);
    const tot = sib.reduce((a,x)=>a+Number(x.sell_idr),0) || 1;
    return shipCostIDR(o.shipment_id) * (Number(o.sell_idr)/tot);
  };

  const ctx = { D, isOwner, custName, custRate, courierOf, shipmentOf, costsFor, quote, orderCostIDR, shipCostIDR, reload: D.reload, liveFx };
  const TABS = [
    {k:"orders",label:"Orders",icon:LayoutGrid},
    {k:"shipments",label:"Shipments",icon:Boxes},
    {k:"customers",label:"Customers",icon:Users},
    {k:"pricing",label:"Pricing",icon:Tag},
    {k:"invoices",label:"Invoices",icon:FileText},
    ...(isOwner ? [{k:"finance",label:"Finance",icon:TrendingUp}] : []),
  ];

  return (
    <div style={S.root}><style>{CSS}</style>
      <header style={S.header}>
        <div style={S.brandRow}>
          <img src={LOGO} alt="JEI" style={S.logo}/>
          <div><div style={S.brandName}>JON EXPRESS INTERNATIONAL</div>
          <div style={S.brandSub}>US → Singapore → Indonesia · order, pricing &amp; billing</div></div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          {liveFx && <span style={S.fxBar}>
            <DollarSign size={12}/>
            USD/IDR {liveFx.usd_idr?.toLocaleString()} · SGD/IDR {liveFx.sgd_idr?.toLocaleString()}
            {!liveFx.live && <span style={{color:"var(--warn)"}}> (offline)</span>}
          </span>}
          <span style={S.who}>
            {isOwner ? <Eye size={13}/> : <EyeOff size={13}/>}
            {profile?.full_name ?? "User"} · {isOwner ? "Owner" : "Admin"}
          </span>
          <button style={S.icoBtn} onClick={D.reload} title="Refresh"><RefreshCw size={15}/></button>
          <button style={S.icoBtn} onClick={signOut} title="Sign out"><LogOut size={15}/></button>
        </div>
      </header>

      <nav style={S.tabs}>
        {TABS.map(t=>(
          <button key={t.k} onClick={()=>setTab(t.k)} className={"tab "+(tab===t.k?"on":"")}>
            <t.icon size={15}/> {t.label}
          </button>))}
      </nav>

      {tab==="orders"   && <Orders ctx={ctx}/>}
      {tab==="shipments"&& <Shipments ctx={ctx}/>}
      {tab==="customers"&& <CustomerData ctx={ctx}/>}
      {tab==="pricing"  && <Pricing ctx={ctx} reload={D.reload}/>}
      {tab==="invoices" && <Invoices ctx={ctx}/>}
      {tab==="finance" && isOwner && <Finance ctx={ctx}/>}

      <footer style={S.footer}>
        {isOwner ? "Full financial visibility" : "Operations & pricing — landed cost / margin hidden by database policy"}
        {" · "}FX 1 USD={Number(D.fx.usd_idr).toLocaleString()} · 1 SGD={Number(D.fx.sgd_idr).toLocaleString()} IDR
      </footer>
    </div>
  );
}

const stageIcon = (st)=>{const i=STAGES.indexOf(st);if(i<=0)return <Package size={14}/>;if(i<=3)return <Ship size={14}/>;if(i===STAGES.length-1)return <CheckCircle2 size={14}/>;return <Truck size={14}/>;};

// ──────────── ORDERS ────────────
function Orders({ctx}){
  const {D,isOwner,custName,courierOf,shipmentOf,quote,orderCostIDR,reload}=ctx;
  const [q,setQ]=useState(""); const [sel,setSel]=useState(null);
  const [formOpen,setFormOpen]=useState(false);
  const [editOrder,setEditOrder]=useState(null);
  const list=useMemo(()=>D.orders.filter(o=>!o.completed).filter(o=>[o.id,custName(o.customer_id),o.product,o.shipment_id].join(" ").toLowerCase().includes(q.toLowerCase())),[q,D.orders]);
  const t=useMemo(()=>{const active=D.orders.filter(o=>!o.completed);const rev=active.reduce((a,o)=>a+Number(o.sell_idr),0);const cost=active.reduce((a,o)=>a+orderCostIDR(o),0);const del=active.filter(o=>shipmentOf(o.shipment_id)?.stage==="Delivered to customer").length;return{rev,cost,profit:rev-cost,del,fly:active.length-del};},[D.orders]);

  const openNew=()=>{setEditOrder(null);setFormOpen(true);};
  const openEdit=(o)=>{setEditOrder(o);setFormOpen(true);};
  const onSaved=()=>{setFormOpen(false);setEditOrder(null);reload();};

  return(<>
    <section style={S.kpis}>
      <Kpi label="Active orders" value={D.orders.length} sub={`${t.fly} in flight · ${t.del} delivered`}/>
      {isOwner?<>
        <Kpi label="Revenue (booked)" value={fmtShort(t.rev)} sub="all open orders" accent/>
        <Kpi label="Landed cost" value={fmtShort(t.cost)} sub="freight+handling+delivery"/>
        <Kpi label="Gross profit" value={fmtShort(t.profit)} sub={`${t.rev?(t.profit/t.rev*100).toFixed(0):0}% margin`} accent/>
      </>:<>
        <Kpi label="Shipments moving" value={D.shipments.filter(s=>s.stage!=="Delivered to customer").length} sub="across all stages"/>
        <Kpi label="Delivered" value={t.del} sub="ready to invoice"/>
        <Kpi label="Customers" value={D.customers.length} sub="active accounts"/>
      </>}
    </section>
    <div style={{display:"flex",gap:10,marginBottom:14,flexWrap:"wrap"}}>
      <div style={{...S.searchWrap,flex:1,marginBottom:0}}><Search size={15} style={{opacity:.5}}/><input style={S.search} placeholder="Search orders, customers, products…" value={q} onChange={e=>setQ(e.target.value)}/></div>
      <button style={S.secBtn} onClick={()=>exportCSV(exportOrders(D.orders,D.customers,D.shipments),"jei-orders.csv")}><Download size={13}/> Export CSV</button>
      <button style={S.primaryBtn} onClick={openNew}><Plus size={15}/> New order</button>
    </div>
    <div style={S.card}>
      <div style={S.tHead}>
        <span style={{flex:"0 0 88px"}}>Order</span><span style={{flex:2}}>Customer / Product</span>
        <span style={{flex:"0 0 90px",textAlign:"right"}}>Charged kg</span><span style={{flex:1.7}}>Stage</span>
        {isOwner&&<span style={{flex:1,textAlign:"right"}}>Revenue</span>}{isOwner&&<span style={{flex:.8,textAlign:"right"}}>Margin</span>}
        {!isOwner&&<span style={{flex:1}}>ETA ID</span>}<span style={{flex:"0 0 44px"}}/>
      </div>
      {list.map(o=>{const s=shipmentOf(o.shipment_id);const qd=quote(o);const cost=orderCostIDR(o);const m=Number(o.sell_idr)-cost;const mp=Number(o.sell_idr)?m/Number(o.sell_idr)*100:0;const consol=D.orders.filter(x=>x.shipment_id===o.shipment_id).length>1;return(
        <div key={o.id} style={S.row} className="row">
          <span style={{flex:"0 0 88px",fontFamily:"var(--mono)",fontSize:12,color:"var(--ink-3)",cursor:"pointer"}} onClick={()=>setSel(sel===o.id?null:o.id)}>{o.id}</span>
          <span style={{flex:2,cursor:"pointer"}} onClick={()=>setSel(sel===o.id?null:o.id)}><div style={{fontWeight:600}}>{custName(o.customer_id)}</div><div style={{fontSize:12,color:"var(--ink-3)"}}>{o.product}</div></span>
          <span style={{flex:"0 0 90px",textAlign:"right",fontVariantNumeric:"tabular-nums"}}>{qd.charged.toFixed(1)}<span style={{fontSize:10,color:"var(--ink-3)",marginLeft:3}}>{qd.minApplied?"min":qd.basis==="volumetric"?"vol":"act"}</span></span>
          <span style={{flex:1.7}}>
            <span className="stage" data-final={s?.stage==="Delivered to customer"}>{stageIcon(s?.stage)} {s?.stage}</span>
            <span className={"paybadge pay-"+(s?.payment??"Unpaid")}>{s?.payment??"Unpaid"}</span>
          </span>
          {isOwner&&<span style={{flex:1,textAlign:"right",fontVariantNumeric:"tabular-nums"}}>{fmtShort(Number(o.sell_idr))}</span>}
          {isOwner&&<span style={{flex:.8,textAlign:"right"}}><span style={{...S.pill,background:mp>40?"var(--good-bg)":mp>20?"var(--warn-bg)":"var(--bad-bg)",color:mp>40?"var(--good)":mp>20?"var(--warn)":"var(--bad)"}}>{mp.toFixed(0)}%</span></span>}
          {!isOwner&&<span style={{flex:1,fontSize:13,color:"var(--ink-2)"}}>{s?.eta_id}</span>}
          <span style={{flex:"0 0 44px",display:"flex",justifyContent:"flex-end",gap:4}}>
            <button style={S.iconMini} title="Edit" onClick={()=>openEdit(o)}><Pencil size={14}/></button>
          </span>
          {sel===o.id&&(<div style={S.detail}>
            <div style={S.detailGrid}>
              <Detail label="Shipment" value={o.shipment_id+(consol?" (consolidated)":" (single)")}/>
              <Detail label="Courier" value={`${courierOf(s?.courier_id)?.name??"—"} · ÷${qd.divisor}`}/>
              <Detail label="Actual weight" value={`${o.weight_kg} kg`}/>
              <Detail label="Volumetric" value={`${qd.vol.toFixed(1)} kg`}/>
              <Detail label="Charged on" value={qd.minApplied?"3kg minimum":qd.basis} strong/>
              <Detail label="Rate / kg" value={fmtIDR(qd.rate)}/>
              {isOwner&&<><Detail label="Revenue" value={fmtIDR(Number(o.sell_idr))}/><Detail label="Allocated cost" value={fmtIDR(cost)}/><Detail label="Gross profit" value={fmtIDR(m)} strong/></>}
            </div>
            {!isOwner&&<div style={S.adminNote}><AlertCircle size={13}/> Landed cost &amp; margin are visible to the owner only.</div>}
          </div>)}
        </div>);})}
      {list.length===0 && <div style={{padding:"30px",textAlign:"center",color:"var(--ink-3)"}}>No orders match. <button style={{...S.linkBtn}} onClick={openNew}>Create one</button>.</div>}
    </div>
    {formOpen && <OrderForm ctx={ctx} order={editOrder} onClose={()=>setFormOpen(false)} onSaved={onSaved}/>}
  </>);
}

// ──────────── SHIPMENTS (checkpoint tracking) ────────────
function Shipments({ctx}){
  const {D,custName,courierOf,reload}=ctx;
  const [busy,setBusy]=useState(null);
  const [q,setQ]=useState("");

  async function advance(sid,stage){setBusy(sid+stage);await setShipmentStage(sid,stage);await reload();setBusy(null);}
  async function setPay(sid,payment){setBusy(sid+payment);await setShipmentPayment(sid,payment);await reload();setBusy(null);}

  // Only show shipments that have at least one order
  const activeShipments=D.shipments.filter(s=>D.orders.some(o=>o.shipment_id===s.id));
  const list=activeShipments
    .filter(s=>[s.id,s.stage,s.payment].join(" ").toLowerCase().includes(q.toLowerCase()))
    .sort((a,b)=>a.id<b.id?1:-1);

  // unpaid-but-delivered = money owed
  const owed=activeShipments.filter(s=>s.stage==="Delivered to customer"&&s.payment!=="Paid").length;

  return(<>
    <div style={S.sectionLead}><h2 style={S.h2}>Shipments</h2>
      <p style={S.lead}>Update each shipment as it hits a checkpoint. Payment is tracked separately, so you can always see what's delivered but not yet paid.</p></div>
    <section style={S.kpis}>
      <Kpi label="Total shipments" value={activeShipments.length} sub="with orders"/>
      <Kpi label="In transit" value={activeShipments.filter(s=>s.stage!=="Delivered to customer").length} sub="not yet delivered"/>
      <Kpi label="Delivered, unpaid" value={owed} sub="money owed" warn={owed>0}/>
      <Kpi label="Paid" value={activeShipments.filter(s=>s.payment==="Paid").length} sub="settled"/>
    </section>
    <div style={S.searchWrap}><Search size={15} style={{opacity:.5}}/><input style={S.search} placeholder="Search shipments…" value={q} onChange={e=>setQ(e.target.value)}/></div>

    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      {list.map(s=>{
        const orders=D.orders.filter(o=>o.shipment_id===s.id);
        const stageIdx=STAGES.indexOf(s.stage);
        return(
          <div key={s.id} style={S.shipCard}>
            <div style={S.shipCardTop}>
              <div>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontFamily:"var(--mono)",fontWeight:700,fontSize:15}}>{s.id}</span>
                  <span style={{fontSize:12.5,color:"var(--ink-3)"}}>{courierOf(s.courier_id)?.name} · ÷{courierOf(s.courier_id)?.divisor}</span>
                  <span className={"paybadge pay-"+s.payment}>{s.payment}</span>
                </div>
                <div style={{fontSize:12.5,color:"var(--ink-3)",marginTop:3}}>
                  {orders.length} order{orders.length!==1?"s":""}: {orders.map(o=>custName(o.customer_id)).join(", ")||"—"}
                </div>
              </div>
              <div style={{textAlign:"right",fontSize:12,color:"var(--ink-3)"}}>
                <div>ETA ID: {s.eta_id??"—"}</div>
                <div>Stage updated {fmtDate(s.stage_updated_at)}</div>
              </div>
            </div>

            {/* checkpoint timeline */}
            <div style={S.timeline}>
              {STAGES.map((st,i)=>{
                const done=i<stageIdx, current=i===stageIdx;
                return(
                  <button key={st} onClick={()=>advance(s.id,st)} disabled={busy===s.id+st}
                    className={"checkpoint "+(done?"done":current?"current":"future")}>
                    <span className="cpdot">{done||current?<CheckCircle2 size={14}/>:<Circle size={14}/>}</span>
                    <span className="cplabel">{st}</span>
                  </button>
                );
              })}
            </div>

            {/* payment control */}
            <div style={S.payRow}>
              <span style={{fontSize:12.5,color:"var(--ink-3)",display:"flex",alignItems:"center",gap:6}}><CreditCard size={14}/> Payment · updated {fmtDate(s.payment_updated_at)}</span>
              <div style={{display:"flex",gap:6}}>
                {PAYMENTS.map(p=>(
                  <button key={p} onClick={()=>setPay(s.id,p)} disabled={busy===s.id+p}
                    className={"payseg "+(s.payment===p?"on pay-"+p:"")}>{p}</button>
                ))}
              </div>
            </div>

            {/* tracking numbers (per leg, all optional) */}
            <div style={S.trackWrap}>
              <span style={{fontSize:12.5,color:"var(--ink-3)",display:"flex",alignItems:"center",gap:6,marginBottom:8}}><Truck size={14}/> Tracking</span>
              <div style={S.trackGrid}>
                {LEGS.map(leg=>(
                  <TrackingLeg key={leg.num} shipment={s} leg={leg} onSaved={reload}/>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  </>);
}

// ──────────── TRACKING LEG ────────────
function TrackingLeg({shipment,leg,onSaved}){
  const number=shipment[leg.num]??"";
  const carrier=shipment[leg.carrier]??"";
  const [editing,setEditing]=useState(false);
  const [num,setNum]=useState(number);
  const [car,setCar]=useState(carrier||"fedex");
  const [copied,setCopied]=useState(false);
  const [saving,setSaving]=useState(false);

  const url=trackingUrl(carrier,number);

  async function save(){
    setSaving(true);
    await setShipmentTracking(shipment.id,{[leg.num]:num.trim()||null,[leg.carrier]:num.trim()?car:null});
    setSaving(false);setEditing(false);onSaved();
  }
  function copy(){navigator.clipboard?.writeText(number);setCopied(true);setTimeout(()=>setCopied(false),1200);}

  if(editing){
    return(
      <div style={S.legCard}>
        <div style={S.legLabel}>{leg.label}</div>
        <select value={car} onChange={e=>setCar(e.target.value)} style={{...S.input,marginBottom:6}}>
          {CARRIERS.map(c=><option key={c} value={c}>{c.toUpperCase()}</option>)}
        </select>
        <input value={num} onChange={e=>setNum(e.target.value)} placeholder="Tracking number" style={S.input}/>
        <div style={{display:"flex",gap:6,marginTop:8}}>
          <button style={S.legSave} onClick={save} disabled={saving}>{saving?"…":"Save"}</button>
          <button style={S.legCancel} onClick={()=>{setEditing(false);setNum(number);setCar(carrier||"fedex");}}>Cancel</button>
        </div>
      </div>
    );
  }
  return(
    <div style={S.legCard}>
      <div style={S.legLabel}>{leg.label}</div>
      {number ? (
        <>
          <div style={{fontFamily:"var(--mono)",fontSize:13,fontWeight:600,wordBreak:"break-all"}}>{number}</div>
          <div style={{fontSize:11,color:"var(--ink-3)",marginBottom:8}}>{(carrier||"—").toUpperCase()}</div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {url && <a href={url} target="_blank" rel="noreferrer" style={S.legLink}><ExternalLink size={12}/> Track</a>}
            <button style={S.legCopy} onClick={copy}>{copied?<><Check size={12}/> Copied</>:<><Copy size={12}/> Copy</>}</button>
            <button style={S.legEdit} onClick={()=>setEditing(true)}><Pencil size={12}/></button>
          </div>
        </>
      ) : (
        <button style={S.legAdd} onClick={()=>setEditing(true)}><Plus size={13}/> Add number</button>
      )}
    </div>
  );
}

// ──────────── PRICING ────────────
function Pricing({ctx,reload}){
  const {D}=ctx;
  return(<>
    <div style={S.sectionLead}><h2 style={S.h2}>Pricing</h2>
      <p style={S.lead}>Set each customer's rate per kg manually. Quotes charge the greater of actual vs. volumetric weight, with a 3 kg minimum. Imperial inputs auto-convert; results are metric.</p></div>
    <QuoteCalc ctx={ctx}/>
    <RateCards ctx={ctx} reload={reload}/>
    <CourierTable couriers={D.couriers}/>
  </>);
}

function QuoteCalc({ctx}){
  const {D,courierOf}=ctx;
  const [custName,setCustName]=useState("");
  const [custId,setCustId]=useState("");
  const [ratePerKg,setRate]=useState(0);
  const [courier,setCourier]=useState(D.couriers[0]?.id??"");
  const [unit,setUnit]=useState("metric");
  const [l,setL]=useState(80),[w,setW]=useState(60),[h,setH]=useState(55),[wt,setWt]=useState(62);

  // autocomplete
  const matches=useMemo(()=>{
    if(!custName.trim()) return D.customers;
    return D.customers.filter(c=>c.name.toLowerCase().includes(custName.toLowerCase()));
  },[custName,D.customers]);
  const [ddOpen,setDdOpen]=useState(false);
  const ddRef=useRef(null);
  useEffect(()=>{
    const h=(e)=>{if(ddRef.current&&!ddRef.current.contains(e.target))setDdOpen(false);};
    document.addEventListener("mousedown",h);return()=>document.removeEventListener("mousedown",h);
  },[]);
  function pickCust(c){setCustName(c.name);setCustId(c.id);setRate(c.rate_per_kg||0);setDdOpen(false);}

  const r=useMemo(()=>{
    const lc=unit==="imperial"?{l:l*IN_TO_CM,w:w*IN_TO_CM,h:h*IN_TO_CM}:{l:+l,w:+w,h:+h};
    const wkg=unit==="imperial"?wt*LB_TO_KG:+wt;
    const div=courierOf(courier)?.divisor??5000;
    const {vol,charged,basis,minApplied}=chargeable(lc,wkg,div);
    return{wkg,lc,div,vol,charged,basis,minApplied,rate:+ratePerKg,price:charged*(+ratePerKg)};
  },[ratePerKg,courier,unit,l,w,h,wt]);

  function downloadPDF(){
    const c=courierOf(courier);
    const doc=generateQuotationPDF({
      customerName:custName||"Customer",weight:r.wkg,
      dims:r.lc,divisor:r.div,courierName:c?.name??"",
      ratePerKg:+ratePerKg,currency:"IDR",fx:D.fx_rates?.[0]
    });
    doc.save(`quotation-${custName||"customer"}.pdf`);
  }

  const In=(label,val,set,suffix)=>(
    <label style={S.field}><span style={S.fLabel}>{label}</span>
      <div style={S.inputWrap}><input type="number" value={val} onChange={e=>set(e.target.value)} style={{...S.input,border:"none",background:"transparent"}}/><span style={S.suffix}>{suffix}</span></div></label>);
  return(
    <div style={{...S.card,padding:18,marginBottom:18}}>
      <div style={S.calcHead}><Calculator size={16}/><span style={{fontWeight:700}}>Live quote calculator</span>
        <div style={{marginLeft:"auto",display:"flex",gap:6}}>
          <button className={"seg "+(unit==="metric"?"on":"")} onClick={()=>setUnit("metric")}>cm / kg</button>
          <button className={"seg "+(unit==="imperial"?"on":"")} onClick={()=>setUnit("imperial")}>in / lb</button></div></div>
      <div style={S.calcGrid}>
        <div ref={ddRef} style={{position:"relative"}}>
          <label style={S.field}><span style={S.fLabel}>Customer</span>
            <input style={S.input} value={custName} onChange={e=>{setCustName(e.target.value);setCustId("");setDdOpen(true);}}
              onFocus={()=>setDdOpen(true)} placeholder="Type customer name…" autoComplete="off"/></label>
          {ddOpen&&<div style={{position:"absolute",top:"100%",left:0,right:0,background:"var(--card)",border:"1px solid var(--line)",borderRadius:10,maxHeight:150,overflowY:"auto",zIndex:10,boxShadow:"0 8px 24px rgba(0,0,0,.12)"}}>
            {matches.map(c=>(<button key={c.id} style={{display:"flex",justifyContent:"space-between",width:"100%",padding:"9px 12px",border:"none",background:"transparent",cursor:"pointer",fontFamily:"var(--body)",fontSize:13,textAlign:"left",borderBottom:"1px solid var(--line)"}} onClick={()=>pickCust(c)}><span style={{fontWeight:600}}>{c.name}</span><span style={{fontSize:12,color:"var(--ink-3)"}}>{c.rate_per_kg?`${(c.rate_per_kg/1000).toFixed(0)}k/kg`:""}</span></button>))}
            {matches.length===0&&<div style={{padding:"9px 12px",fontSize:13,color:"var(--ink-3)"}}>No matches</div>}
          </div>}
        </div>
        <label style={S.field}><span style={S.fLabel}>Courier</span>
          <select value={courier} onChange={e=>setCourier(e.target.value)} style={S.input}>{D.couriers.map(c=><option key={c.id} value={c.id}>{c.name} (÷{c.divisor})</option>)}</select></label>
        {In("Length",l,setL,unit==="imperial"?"in":"cm")}{In("Width",w,setW,unit==="imperial"?"in":"cm")}
        {In("Height",h,setH,unit==="imperial"?"in":"cm")}{In("Actual weight",wt,setWt,unit==="imperial"?"lb":"kg")}
        <label style={S.field}><span style={S.fLabel}>Rate per kg (IDR)</span>
          <input type="number" value={ratePerKg} onChange={e=>setRate(e.target.value)} style={S.input}/></label>
      </div>
      <div style={S.resultRow}>
        <ResCell label="Actual (metric)" value={`${r.wkg.toFixed(1)} kg`} dim={r.basis!=="actual"||r.minApplied}/>
        <ResCell label="Volumetric" value={`${r.vol.toFixed(1)} kg`} dim={r.basis!=="volumetric"||r.minApplied} note={`÷${r.div}`}/>
        <ResCell label="Charged kg" value={`${r.charged.toFixed(1)} kg`} highlight note={r.minApplied?"min 3kg":r.basis}/>
        <ResCell label="Rate" value={`${fmtIDR(r.rate)}/kg`}/>
        <ResCell label="Quoted price" value={fmtIDR(r.price)} big/>
      </div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:10}}>
        <p style={S.calcFoot}>Charged weight = max(actual, volumetric), floored at 3 kg.</p>
        <button style={S.printBtn} onClick={downloadPDF}><Download size={13}/> Download PDF</button>
      </div>
    </div>);
}

function RateCards({ctx,reload}){
  const {D}=ctx;
  const [draft,setDraft]=useState(()=>Object.fromEntries(D.customers.map(c=>[c.id,c.rate_per_kg])));
  const [saving,setSaving]=useState(null);
  const save=async(id)=>{setSaving(id);await updateCustomerRate(id,Number(draft[id]));setSaving(null);reload();};
  return(
    <div style={{...S.card,marginBottom:18}}>
      <div style={S.cardTitle}><Tag size={15}/> Customer rates <span style={S.muted}>· IDR per chargeable kg</span></div>
      <div style={S.tHead}><span style={{flex:2}}>Customer</span><span style={{flex:1.6,textAlign:"right"}}>Rate / kg (IDR)</span><span style={{flex:1}}></span></div>
      {D.customers.map(c=>{const changed=Number(draft[c.id])!==Number(c.rate_per_kg);return(
        <div key={c.id} style={S.row2}>
          <span style={{flex:2,fontWeight:600}}>{c.name}</span>
          <span style={{flex:1.6,display:"flex",justifyContent:"flex-end"}}>
            <input type="number" value={draft[c.id]} onChange={e=>setDraft({...draft,[c.id]:e.target.value})}
              style={{...S.input,maxWidth:150,textAlign:"right"}}/></span>
          <span style={{flex:1,display:"flex",justifyContent:"flex-end"}}>
            {changed && <button style={S.saveBtn} onClick={()=>save(c.id)} disabled={saving===c.id}>{saving===c.id?"Saving…":"Save"}</button>}
          </span>
        </div>);})}
    </div>);
}

function CourierTable({couriers}){
  return(
    <div style={S.card}>
      <div style={S.cardTitle}><Ship size={15}/> Couriers &amp; volumetric divisors</div>
      <div style={S.tHead}><span style={{flex:2}}>Courier</span><span style={{flex:1,textAlign:"right"}}>Divisor (cm³/kg)</span><span style={{flex:2}}>Effect</span></div>
      {couriers.map(c=>(
        <div key={c.id} style={S.row2}>
          <span style={{flex:2,fontWeight:600}}>{c.name}</span>
          <span style={{flex:1,textAlign:"right",fontFamily:"var(--mono)"}}>{Number(c.divisor).toLocaleString()}</span>
          <span style={{flex:2,fontSize:12.5,color:"var(--ink-3)"}}>{c.divisor===5000?"Higher volumetric weight → bulky cargo costs more":"More forgiving on bulky cargo"}</span>
        </div>))}
    </div>);
}

// ──────────── INVOICES ────────────
function Invoices({ctx}){
  const {D,custName,shipmentOf,reload}=ctx;
  const [q,setQ]=useState("");
  const [showCompleted,setShowCompleted]=useState(false);
  const delivered=D.orders.filter(o=>shipmentOf(o.shipment_id)?.stage==="Delivered to customer");
  const active=delivered.filter(o=>!o.completed);
  const completed=delivered.filter(o=>o.completed);
  const list=showCompleted?completed:active;
  const filtered=list.filter(o=>[o.id,custName(o.customer_id),o.product].join(" ").toLowerCase().includes(q.toLowerCase()));
  const [openId,setOpen]=useState(null);

  async function handleComplete(orderId){
    await completeOrder(orderId);
    setOpen(null);
    reload();
  }

  return(<>
    <div style={S.sectionLead}><h2 style={S.h2}>Invoices</h2>
      <p style={S.lead}>Delivered orders are billable. Complete an invoice to archive it from active views.</p></div>
    <div style={{display:"flex",gap:10,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
      <div style={{...S.searchWrap,flex:1,maxWidth:320,marginBottom:0}}><Search size={15} style={{opacity:.5}}/><input style={S.search} placeholder="Search invoices…" value={q} onChange={e=>setQ(e.target.value)}/></div>
      <div style={{display:"flex",gap:6}}>
        <button className={"seg "+(!showCompleted?"on":"")} onClick={()=>{setShowCompleted(false);setOpen(null);}}>Active ({active.length})</button>
        <button className={"seg "+(showCompleted?"on":"")} onClick={()=>{setShowCompleted(true);setOpen(null);}}>Completed ({completed.length})</button>
      </div>
    </div>
    {filtered.length===0 && <div style={S.empty}>{showCompleted?"No completed invoices.":"No active invoices."}</div>}
    <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:14}}>
      {filtered.map(o=>{const s=shipmentOf(o.shipment_id);return(
        <button key={o.id} onClick={()=>setOpen(openId===o.id?null:o.id)} style={{...S.shipCard,padding:"12px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer",border:openId===o.id?"2px solid var(--accent)":"1px solid var(--line)",background:openId===o.id?"var(--good-bg)":"var(--card)"}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <FileText size={15} style={{color:"var(--accent)"}}/>
            <span style={{fontFamily:"var(--mono)",fontWeight:700,fontSize:13}}>{o.id}</span>
            <span style={{fontWeight:600}}>{custName(o.customer_id)}</span>
            <span style={{fontSize:12.5,color:"var(--ink-3)"}}>{o.product}</span>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span className={"paybadge pay-"+(s?.payment??"Unpaid")}>{s?.payment??"Unpaid"}</span>
            <span style={{fontFamily:"var(--display)",fontWeight:700,fontSize:14}}>{fmtIDR(Number(o.sell_idr||0))}</span>
          </div>
        </button>
      );})}
    </div>
    {openId && <InvoiceDoc ctx={ctx} order={filtered.find(o=>o.id===openId)} onComplete={handleComplete}/>}
  </>);
}

function InvoiceDoc({ctx,order,onComplete}){
  const {D,custName,courierOf,shipmentOf,quote}=ctx;
  const q=quote(order);const s=shipmentOf(order.shipment_id);const c=courierOf(s?.courier_id);
  const invNo="INV-"+order.id.replace("ORD-","");
  const customer=D.customers.find(cu=>cu.id===order.customer_id);

  function downloadPDF(){
    const doc=generateInvoicePDF(order,customer,s,c,ctx.liveFx,D.orders);
    doc.save(`${invNo}.pdf`);
  }

  return(
    <div style={S.invoice}>
      <div style={S.invTop}>
        <div><img src={LOGO} alt="JEI" style={{width:60,height:60,objectFit:"contain"}}/><div style={{fontWeight:800,letterSpacing:".12em",marginTop:8}}>JON EXPRESS INTERNATIONAL</div>
          <div style={{fontSize:12,color:"var(--ink-3)"}}>Freight forwarding · US → SG → ID</div></div>
        <div style={{textAlign:"right"}}><div style={{fontFamily:"var(--display)",fontSize:22,fontWeight:800}}>INVOICE</div>
          <div style={{fontFamily:"var(--mono)",fontSize:13,marginTop:4}}>{invNo}</div>
          <div style={{fontSize:12,color:"var(--ink-3)"}}>Issued {s?.eta_id}</div></div></div>
      <div style={S.invMeta}>
        <div><div style={S.dLabel}>Bill to</div><div style={{fontWeight:700,fontSize:15}}>{custName(order.customer_id)}</div></div>
        <div><div style={S.dLabel}>Shipment</div><div>{order.shipment_id} · {c?.name}</div></div>
        <div><div style={S.dLabel}>Status</div><div style={{color:"var(--good)",fontWeight:600}}>Delivered</div></div>
        <div><div style={S.dLabel}>Payment</div><div className={"paybadge pay-"+(s?.payment??"Unpaid")} style={{display:"inline-block"}}>{s?.payment??"Unpaid"}</div></div></div>
      <div style={S.invTableHead}><span style={{flex:3}}>Description</span><span style={{flex:1,textAlign:"right"}}>Chargeable</span><span style={{flex:1,textAlign:"right"}}>Rate</span><span style={{flex:1,textAlign:"right"}}>Amount</span></div>
      <div style={S.invLine}>
        <span style={{flex:3}}><div style={{fontWeight:600}}>{order.product} ×{order.qty}</div>
          <div style={{fontSize:12,color:"var(--ink-3)"}}>{q.minApplied?"3 kg minimum applied":`Charged on ${q.basis} weight`} ({q.charged.toFixed(1)} kg) · {c?.name} ÷{q.divisor}</div></span>
        <span style={{flex:1,textAlign:"right"}}>{q.charged.toFixed(1)} kg</span>
        <span style={{flex:1,textAlign:"right"}}>{fmtIDR(q.rate)}</span>
        <span style={{flex:1,textAlign:"right",fontWeight:600}}>{fmtIDR(q.price)}</span></div>
      <div style={S.invTotal}><span>Total due</span><span style={{fontFamily:"var(--display)",fontSize:22,fontWeight:800,color:"var(--accent)"}}>{fmtIDR(q.price)}</span></div>
      <div style={S.invFoot}><span>Payment in IDR within 14 days · Bank transfer to JEI account</span>
        <div style={{display:"flex",gap:8}}>
          <button style={S.printBtn} onClick={downloadPDF}><Download size={13}/> Download PDF</button>
          {!order.completed && onComplete && <button style={{...S.printBtn,background:"var(--good)",color:"#fff"}} onClick={()=>onComplete(order.id)}><Check size={13}/> Complete</button>}
        </div></div>
    </div>);
}

// ──────────── FINANCE (owner only) ────────────
function Finance({ctx}){
  const {D,isOwner,custName,shipmentOf,courierOf,costsFor,orderCostIDR}=ctx;
  if(!isOwner) return null;
  const fx=D.fx_rates?.[0]??{usd_idr:15850,sgd_idr:11900};

  const totalRev=D.orders.reduce((a,o)=>a+Number(o.sell_idr||0),0);
  const totalCost=D.orders.reduce((a,o)=>a+orderCostIDR(o),0);
  const profit=totalRev-totalCost;
  const margin=totalRev>0?((profit/totalRev)*100):0;

  const delivered=D.orders.filter(o=>shipmentOf(o.shipment_id)?.stage==="Delivered to customer");
  const paidOrders=delivered.filter(o=>shipmentOf(o.shipment_id)?.payment==="Paid");
  const unpaidOrders=delivered.filter(o=>shipmentOf(o.shipment_id)?.payment!=="Paid");
  const paidRev=paidOrders.reduce((a,o)=>a+Number(o.sell_idr||0),0);
  const unpaidRev=unpaidOrders.reduce((a,o)=>a+Number(o.sell_idr||0),0);
  const invoicedOrders=delivered.filter(o=>shipmentOf(o.shipment_id)?.payment==="Invoiced");

  return(<>
    <div style={S.sectionLead}><h2 style={S.h2}>Finance</h2>
      <p style={S.lead}>Revenue, costs, and invoice status across all orders. Costs come from shipment cost entries; margin is calculated after FX conversion.</p></div>

    <section style={S.kpis}>
      <Kpi label="Revenue" value={fmtShort(totalRev)} sub="total sell value" accent/>
      <Kpi label="Cost" value={fmtShort(totalCost)} sub="shipment costs (IDR)"/>
      <Kpi label="Profit" value={fmtShort(profit)} sub={profit>=0?"above breakeven":"below breakeven"} accent={profit>=0} warn={profit<0}/>
      <Kpi label="Margin" value={`${margin.toFixed(1)}%`} sub="profit / revenue" accent={margin>0}/>
    </section>

    <h3 style={{...S.h2,fontSize:16,marginTop:24,marginBottom:12}}>Invoice status</h3>
    <section style={S.kpis}>
      <Kpi label="Delivered" value={delivered.length} sub={`${fmtShort(delivered.reduce((a,o)=>a+Number(o.sell_idr||0),0))} total`}/>
      <Kpi label="Paid" value={paidOrders.length} sub={fmtShort(paidRev)} accent/>
      <Kpi label="Invoiced (unpaid)" value={invoicedOrders.length} sub={fmtShort(invoicedOrders.reduce((a,o)=>a+Number(o.sell_idr||0),0))} warn={invoicedOrders.length>0}/>
      <Kpi label="Not yet invoiced" value={unpaidOrders.filter(o=>shipmentOf(o.shipment_id)?.payment==="Unpaid").length} sub="delivered but no invoice" warn/>
    </section>

    {unpaidOrders.length>0 && (<>
      <h3 style={{...S.h2,fontSize:16,marginTop:24,marginBottom:12}}>Outstanding ({unpaidOrders.length})</h3>
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {unpaidOrders.map(o=>{
          const s=shipmentOf(o.shipment_id);
          return(
            <div key={o.id} style={{...S.shipCard,padding:14,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
              <div>
                <span style={{fontFamily:"var(--mono)",fontWeight:700,fontSize:13}}>{o.id}</span>
                <span style={{marginLeft:10,fontWeight:600}}>{custName(o.customer_id)}</span>
                <span style={{marginLeft:10,fontSize:12.5,color:"var(--ink-3)"}}>{o.product}</span>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:12}}>
                <span className={"paybadge pay-"+(s?.payment??"Unpaid")}>{s?.payment??"Unpaid"}</span>
                <span style={{fontFamily:"var(--display)",fontWeight:700,color:"var(--accent)"}}>{fmtIDR(Number(o.sell_idr||0))}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{marginTop:12,fontFamily:"var(--display)",fontWeight:700,fontSize:16,textAlign:"right",color:"var(--bad)"}}>
        Total outstanding: {fmtIDR(unpaidRev)}
      </div>
    </>)}
  </>);
}

// ──────────── SHARED ────────────
function Kpi({label,value,sub,accent,warn}){return(<div style={{...S.kpi,...(accent?{borderColor:"var(--accent-line)"}:{}),...(warn?{borderColor:"var(--warn)"}:{})}}><div style={S.kpiLabel}>{label}</div><div style={{...S.kpiVal,...(accent?{color:"var(--accent)"}:{}),...(warn?{color:"var(--warn)"}:{})}}>{value}</div><div style={S.kpiSub}>{sub}</div></div>);}
function Detail({label,value,strong}){return <div><div style={S.dLabel}>{label}</div><div style={{...S.dVal,...(strong?{color:"var(--accent)",fontWeight:700,textTransform:"capitalize"}:{})}}>{value}</div></div>;}
function ResCell({label,value,note,dim,highlight,big}){return(<div style={{...S.resCell,...(highlight?{background:"var(--accent)",color:"#fff",borderColor:"var(--accent)"}:{}),...(dim?{opacity:.4}:{})}}><div style={{fontSize:10.5,textTransform:"uppercase",letterSpacing:".07em",opacity:.8}}>{label}{note?` ${note}`:""}</div><div style={{fontFamily:"var(--display)",fontWeight:800,fontSize:big?20:16,marginTop:3,textTransform:label==="Charged kg"?"capitalize":"none"}}>{value}</div></div>);}
function Center({children}){return <div style={{minHeight:"100vh",display:"grid",placeItems:"center",fontFamily:"'Inter',sans-serif",color:"#4A5C5A",background:"#F2F4F3"}}>{children}</div>;}

const S={
  root:{fontFamily:"var(--body)",color:"var(--ink)",background:"var(--bg)",minHeight:"100vh",padding:"22px clamp(14px,4vw,40px)",maxWidth:1180,margin:"0 auto"},
  header:{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18,flexWrap:"wrap",gap:14},
  brandRow:{display:"flex",alignItems:"center",gap:12},
  logo:{width:42,height:42,objectFit:"contain",borderRadius:6},
  brandName:{fontFamily:"var(--display)",fontWeight:800,letterSpacing:".14em",fontSize:15},
  brandSub:{fontSize:12,color:"var(--ink-3)",marginTop:1},
  who:{display:"flex",alignItems:"center",gap:6,fontSize:13,fontWeight:600,color:"var(--ink-2)",background:"var(--card)",padding:"7px 12px",borderRadius:10,border:"1px solid var(--line)"},
  fxBar:{display:"flex",alignItems:"center",gap:5,background:"var(--head)",border:"1px solid var(--line)",borderRadius:10,padding:"6px 12px",fontSize:11.5,fontWeight:600,color:"var(--ink-3)"},
  icoBtn:{display:"grid",placeItems:"center",width:34,height:34,border:"1px solid var(--line)",background:"var(--card)",borderRadius:9,cursor:"pointer",color:"var(--ink-2)"},
  tabs:{display:"flex",gap:4,marginBottom:20,borderBottom:"1px solid var(--line)"},
  kpis:{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:12,marginBottom:20},
  kpi:{background:"var(--card)",border:"1px solid var(--line)",borderRadius:13,padding:"15px 16px"},
  kpiLabel:{fontSize:11,textTransform:"uppercase",letterSpacing:".09em",color:"var(--ink-3)",fontWeight:600},
  kpiVal:{fontFamily:"var(--display)",fontSize:25,fontWeight:800,margin:"4px 0 2px"},
  kpiSub:{fontSize:11.5,color:"var(--ink-3)"},
  searchWrap:{display:"flex",alignItems:"center",gap:8,background:"var(--card)",border:"1px solid var(--line)",borderRadius:11,padding:"9px 13px",marginBottom:14},
  search:{border:"none",outline:"none",background:"transparent",flex:1,fontSize:14,color:"var(--ink)",fontFamily:"var(--body)"},
  primaryBtn:{display:"flex",alignItems:"center",gap:6,background:"var(--accent)",color:"#fff",border:"none",borderRadius:11,padding:"0 18px",fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"var(--body)"},
  secBtn:{display:"flex",alignItems:"center",gap:5,background:"var(--card)",border:"1px solid var(--line)",color:"var(--ink-2)",borderRadius:10,padding:"9px 13px",fontSize:12.5,fontWeight:600,cursor:"pointer",fontFamily:"var(--body)"},
  iconMini:{display:"grid",placeItems:"center",width:30,height:30,border:"1px solid var(--line)",background:"var(--card)",borderRadius:8,cursor:"pointer",color:"var(--ink-2)"},
  linkBtn:{border:"none",background:"transparent",color:"var(--accent)",fontWeight:700,cursor:"pointer",fontFamily:"var(--body)",fontSize:"inherit",padding:0,textDecoration:"underline"},
  shipCard:{background:"var(--card)",border:"1px solid var(--line)",borderRadius:14,padding:18},
  shipCardTop:{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:14,flexWrap:"wrap",marginBottom:16},
  timeline:{display:"flex",gap:6,flexWrap:"wrap",marginBottom:14},
  payRow:{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap",borderTop:"1px solid var(--line)",paddingTop:14},
  trackWrap:{borderTop:"1px solid var(--line)",paddingTop:14,marginTop:14},
  trackGrid:{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:10},
  legCard:{border:"1px solid var(--line)",borderRadius:10,padding:"11px 12px",background:"var(--head)"},
  legLabel:{fontSize:11,textTransform:"uppercase",letterSpacing:".06em",color:"var(--ink-3)",fontWeight:700,marginBottom:6},
  legLink:{display:"inline-flex",alignItems:"center",gap:4,background:"var(--accent)",color:"#fff",textDecoration:"none",borderRadius:7,padding:"5px 9px",fontSize:12,fontWeight:600},
  legCopy:{display:"inline-flex",alignItems:"center",gap:4,background:"var(--card)",border:"1px solid var(--line)",color:"var(--ink-2)",borderRadius:7,padding:"5px 9px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"var(--body)"},
  legEdit:{display:"inline-flex",alignItems:"center",background:"var(--card)",border:"1px solid var(--line)",color:"var(--ink-2)",borderRadius:7,padding:"5px 8px",cursor:"pointer"},
  legAdd:{display:"inline-flex",alignItems:"center",gap:5,background:"var(--card)",border:"1px dashed var(--line)",color:"var(--ink-2)",borderRadius:8,padding:"7px 11px",fontSize:12.5,fontWeight:600,cursor:"pointer",fontFamily:"var(--body)",width:"100%",justifyContent:"center"},
  legSave:{background:"var(--accent)",color:"#fff",border:"none",borderRadius:7,padding:"6px 14px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"var(--body)"},
  legCancel:{background:"var(--card)",border:"1px solid var(--line)",color:"var(--ink-2)",borderRadius:7,padding:"6px 12px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"var(--body)"},
  card:{background:"var(--card)",border:"1px solid var(--line)",borderRadius:14,overflow:"hidden"},
  cardTitle:{display:"flex",alignItems:"center",gap:8,padding:"14px 16px",fontWeight:700,fontSize:14,borderBottom:"1px solid var(--line)"},
  muted:{fontWeight:400,color:"var(--ink-3)",fontSize:12.5},
  tHead:{display:"flex",gap:10,padding:"11px 16px",fontSize:11,textTransform:"uppercase",letterSpacing:".07em",color:"var(--ink-3)",fontWeight:700,borderBottom:"1px solid var(--line)",background:"var(--head)"},
  row:{display:"flex",gap:10,padding:"13px 16px",alignItems:"center",borderBottom:"1px solid var(--line)",cursor:"pointer",flexWrap:"wrap"},
  row2:{display:"flex",gap:10,padding:"12px 16px",alignItems:"center",borderBottom:"1px solid var(--line)"},
  pill:{padding:"2px 9px",borderRadius:20,fontSize:12,fontWeight:700},
  detail:{flexBasis:"100%",marginTop:12,paddingTop:14,borderTop:"1px dashed var(--line)"},
  detailGrid:{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:14,marginBottom:12},
  dLabel:{fontSize:11,color:"var(--ink-3)",textTransform:"uppercase",letterSpacing:".06em",marginBottom:2},
  dVal:{fontSize:14,fontWeight:600},
  adminNote:{display:"flex",alignItems:"center",gap:7,fontSize:12.5,color:"var(--ink-3)",background:"var(--bg)",padding:"9px 12px",borderRadius:9},
  sectionLead:{marginBottom:16},
  h2:{fontFamily:"var(--display)",fontSize:22,fontWeight:800,margin:"0 0 4px"},
  lead:{fontSize:13.5,color:"var(--ink-2)",margin:0,maxWidth:680,lineHeight:1.5},
  calcHead:{display:"flex",alignItems:"center",gap:8,marginBottom:16},
  calcGrid:{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:12,marginBottom:16},
  field:{display:"flex",flexDirection:"column",gap:5},
  fLabel:{fontSize:11.5,fontWeight:600,color:"var(--ink-2)"},
  inputWrap:{display:"flex",alignItems:"center",border:"1px solid var(--line)",borderRadius:9,overflow:"hidden",background:"var(--head)"},
  input:{border:"1px solid var(--line)",borderRadius:9,padding:"9px 11px",fontSize:14,fontFamily:"var(--body)",background:"var(--head)",color:"var(--ink)",outline:"none",width:"100%",boxSizing:"border-box"},
  suffix:{padding:"0 11px",fontSize:12,color:"var(--ink-3)",borderLeft:"1px solid var(--line)",alignSelf:"stretch",display:"flex",alignItems:"center"},
  saveBtn:{background:"var(--accent)",color:"#fff",border:"none",borderRadius:8,padding:"6px 14px",fontSize:12.5,fontWeight:600,cursor:"pointer",fontFamily:"var(--body)"},
  resultRow:{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:10},
  resCell:{background:"var(--head)",border:"1px solid var(--line)",borderRadius:11,padding:"11px 13px"},
  calcFoot:{fontSize:11.5,color:"var(--ink-3)",marginTop:12,marginBottom:0,lineHeight:1.5},
  invList:{display:"flex",gap:8,flexWrap:"wrap",marginBottom:16},
  invoice:{background:"var(--card)",border:"1px solid var(--line)",borderRadius:14,padding:"clamp(18px,4vw,32px)"},
  invTop:{display:"flex",justifyContent:"space-between",alignItems:"flex-start",paddingBottom:20,borderBottom:"2px solid var(--ink)",marginBottom:20,flexWrap:"wrap",gap:16},
  invMeta:{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:16,marginBottom:24},
  invTableHead:{display:"flex",gap:10,fontSize:11,textTransform:"uppercase",letterSpacing:".07em",color:"var(--ink-3)",fontWeight:700,paddingBottom:8,borderBottom:"1px solid var(--line)"},
  invLine:{display:"flex",gap:10,padding:"16px 0",borderBottom:"1px solid var(--line)",alignItems:"flex-start"},
  invTotal:{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"18px 0",fontWeight:700,fontSize:15},
  invFoot:{display:"flex",justifyContent:"space-between",alignItems:"center",borderTop:"1px solid var(--line)",paddingTop:16,fontSize:12,color:"var(--ink-3)",flexWrap:"wrap",gap:12},
  printBtn:{display:"flex",alignItems:"center",gap:6,background:"var(--accent)",color:"#fff",border:"none",borderRadius:9,padding:"8px 14px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"var(--body)"},
  empty:{padding:"40px 20px",textAlign:"center",color:"var(--ink-3)",background:"var(--card)",border:"1px dashed var(--line)",borderRadius:14},
  footer:{marginTop:18,fontSize:11.5,color:"var(--ink-3)",textAlign:"center",lineHeight:1.6},
};
const CSS=`
:root{--bg:#F2F4F3;--card:#FFFFFF;--head:#FAFBFB;--line:#E4E8E7;--ink:#1A2B2A;--ink-2:#4A5C5A;--ink-3:#8A9794;--accent:#0E6E5C;--accent-line:#9FD6C8;--good:#0E6E5C;--good-bg:#DBF1EB;--warn:#B6792A;--warn-bg:#F8ECD7;--bad:#B23A48;--bad-bg:#F6DEE1;--display:'Space Grotesk',system-ui,sans-serif;--body:'Inter',system-ui,sans-serif;--mono:'JetBrains Mono',ui-monospace,monospace;}
*{box-sizing:border-box}body{margin:0}
.tab{display:flex;align-items:center;gap:6px;border:none;background:transparent;color:var(--ink-3);font-size:14px;font-weight:600;padding:10px 16px;cursor:pointer;font-family:var(--body);border-bottom:2px solid transparent;margin-bottom:-1px}
.tab.on{color:var(--accent);border-bottom-color:var(--accent)}.tab:hover{color:var(--ink-2)}
.row:hover{background:var(--head)}.row:last-child,.row2:last-child{border-bottom:none}
.stage{display:inline-flex;align-items:center;gap:5px;font-size:12.5px;font-weight:600;color:var(--ink-2);background:var(--head);padding:3px 9px;border-radius:7px;border:1px solid var(--line)}
.stage[data-final="true"]{color:var(--good);background:var(--good-bg);border-color:transparent}
.seg{border:1px solid var(--line);background:var(--card);color:var(--ink-3);font-size:12px;font-weight:600;padding:5px 10px;border-radius:8px;cursor:pointer;font-family:var(--body)}
.seg.on{background:var(--accent);color:#fff;border-color:var(--accent)}
.invchip{display:flex;align-items:center;gap:6px;border:1px solid var(--line);background:var(--card);color:var(--ink-2);font-size:12.5px;font-weight:600;padding:7px 12px;border-radius:9px;cursor:pointer;font-family:var(--body)}
.invchip.on{background:var(--accent);color:#fff;border-color:var(--accent)}
.stagesel{font-family:var(--body);font-size:12.5px;font-weight:600;color:var(--ink-2);background:var(--head);padding:5px 8px;border-radius:7px;border:1px solid var(--line);cursor:pointer;max-width:100%}
.stagesel[data-final="true"]{color:var(--good);background:var(--good-bg);border-color:transparent}
.shtab{flex:1;border:1px solid var(--line);background:var(--card);color:var(--ink-3);font-size:12.5px;font-weight:600;padding:7px 10px;border-radius:8px;cursor:pointer;font-family:var(--body)}
.shtab.on{background:var(--accent);color:#fff;border-color:var(--accent)}
.checkpoint{display:flex;align-items:center;gap:6px;border:1px solid var(--line);background:var(--card);border-radius:9px;padding:8px 11px;cursor:pointer;font-family:var(--body);font-size:12.5px;font-weight:600;transition:.15s}
.checkpoint .cpdot{display:grid;place-items:center;color:var(--ink-3)}
.checkpoint.done{background:var(--good-bg);border-color:transparent;color:var(--good)}
.checkpoint.done .cpdot{color:var(--good)}
.checkpoint.current{background:var(--accent);border-color:var(--accent);color:#fff}
.checkpoint.current .cpdot{color:#fff}
.checkpoint.future{color:var(--ink-3)}
.checkpoint:hover:not(:disabled){border-color:var(--accent)}
.paybadge{display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px;margin-left:8px}
.pay-Unpaid{background:var(--bad-bg);color:var(--bad)}
.pay-Invoiced{background:var(--warn-bg);color:var(--warn)}
.pay-Paid{background:var(--good-bg);color:var(--good)}
.payseg{border:1px solid var(--line);background:var(--card);color:var(--ink-3);font-size:12.5px;font-weight:600;padding:6px 14px;border-radius:8px;cursor:pointer;font-family:var(--body)}
.payseg.on{border-color:transparent}
input::placeholder{color:var(--ink-3)}select{cursor:pointer}
@media print{.tab,.seg,nav,header button,footer{display:none}}
`;
