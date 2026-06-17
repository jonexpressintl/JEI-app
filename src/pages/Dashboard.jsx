import { useState, useMemo, useRef, useEffect } from "react";
import { Package, Ship, Truck, Eye, EyeOff, Search, ChevronRight, AlertCircle, CheckCircle2, FileText, Calculator, Tag, LayoutGrid, Plus, Printer, LogOut, RefreshCw, Pencil, Boxes, Circle, CreditCard, ExternalLink, Copy, Check, Download, Upload, Users, DollarSign, TrendingUp, Trash2 } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useJEIData, updateCustomerRate, addCustomer, setShipmentStage, setShipmentPayment, setShipmentTracking, completeOrder, updateOrder } from "../lib/data";
import { chargeable, finalizeCharged, fmtIDR, fmtShort, toIDR, trackingUrl, MIN_KG, IN_TO_CM, LB_TO_KG } from "../lib/pricing";
import { generateInvoicePDF, generateQuotationPDF } from "../lib/pdf";
import ConfirmDialog from "../components/ConfirmDialog";
import { fetchLiveRates } from "../lib/fx";
import { exportCSV, exportOrders } from "../lib/csv";
import OrderForm from "../components/OrderForm";
import CustomerData from "../components/CustomerData";
import { LOGO } from "../lib/logo";

const STAGES = ["Package received in US","Sent from US","Received in SG","Sent from SG","Received in ID","Delivered to customer"];
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

  // Ghost zero: auto-select number input content on focus so typing replaces the 0
  useEffect(() => {
    const handler = (e) => {
      if (e.target.type === "number" && (e.target.value === "0" || e.target.value === "0.00" || e.target.value === "")) {
        e.target.select();
      }
    };
    document.addEventListener("focus", handler, true);
    return () => document.removeEventListener("focus", handler, true);
  }, []);

  if (D.loading) return <Center>Loading JEI data…</Center>;
  if (D.error) return <Center>Couldn't load data: {D.error}</Center>;

  // index helpers
  const custName = (id) => D.customers.find(c=>c.id===id)?.name ?? "—";
  const custRate = (id) => D.customers.find(c=>c.id===id)?.rate_per_kg ?? 0;
  const courierOf = (id) => D.couriers.find(c=>c.id===id);
  const shipmentOf = (id) => D.shipments.find(s=>s.id===id);
  const costsFor = (sid) => D.costs.filter(c=>c.shipment_id===sid);

  const quote = (o) => {
    const div = +o.divisor || 5000;
    // Use packages array if available, otherwise fall back to single weight/dims
    const pkgs = o.packages && o.packages.length > 0
      ? o.packages
      : [{ weight: +o.weight_kg, l: +o.dim_l_cm, w: +o.dim_w_cm, h: +o.dim_h_cm }];
    let totalRaw = 0, totalVol = 0, totalActual = 0;
    pkgs.forEach(p => {
      const ch = chargeable({ l: +p.l, w: +p.w, h: +p.h }, +p.weight, div);
      totalRaw += ch.raw; totalVol += ch.vol; totalActual += +p.weight;
    });
    const { charged: chargedAuto, minApplied } = finalizeCharged(totalRaw); // 3kg min + round to 0.5, applied to TOTAL
    const charged = +o.charged_override || chargedAuto;
    const basis = totalVol > totalActual ? "volumetric" : "actual";
    const rate = Number(o.price_per_kg) || custRate(o.customer_id) || 0;
    const weightPrice = charged * rate;

    // Fee breakdown in ORIGINAL currencies (no conversion — that happens at invoice time)
    const isAirM = (m) => m && m !== "Seafreight";
    const feeMode = isAirM(o.shipping_us_sg) && isAirM(o.shipping_sg_id) ? "air_air"
      : isAirM(o.shipping_us_sg) && !isAirM(o.shipping_sg_id) ? "air_sea" : "sea_sea";
    const autoCBM = pkgs.reduce((a,p)=>a+((+p.l||0)*(+p.w||0)*(+p.h||0))/1000000,0);
    const cbmA = +o.cbm_us_sg || autoCBM || 0;
    const cbmB = +o.cbm_sg_id || autoCBM || 0;
    const sf1Total = (+o.fee_1||0) * cbmA;
    const sf2Total = (+o.fee_2||0) * cbmB;

    // Build a list of fee line items {label, amount, currency}
    let feeLines = [];
    if (feeMode === "air_air" || (feeMode === "air_sea" && o.air_sea_option !== "breakdown")) {
      feeLines.push({ label: `${o.product||"Shipment"} (${charged.toFixed(1)} kg × ${o.price_currency==="USD"?"$":o.price_currency==="SGD"?"S$":"Rp"}${rate.toLocaleString()})`, amount: weightPrice, currency: o.price_currency || "USD" });
      if (+o.fee_additional) feeLines.push({ label: "Additional cost", amount: +o.fee_additional, currency: o.fee_additional_cur || "USD" });
    } else if (feeMode === "air_sea") {
      if (+o.fee_1) feeLines.push({ label: "Airfreight fee", amount: +o.fee_1, currency: o.fee_1_cur || "USD" });
      if (+o.fee_clearance) feeLines.push({ label: "Clearance fee", amount: +o.fee_clearance, currency: o.fee_clearance_cur || "SGD" });
      if (+o.fee_2) feeLines.push({ label: `Seafreight (${cbmB.toFixed(2)} CBM × ${(+o.fee_2).toLocaleString()})`, amount: sf2Total, currency: o.fee_2_cur || "IDR" });
      if (+o.fee_additional) feeLines.push({ label: "Additional cost", amount: +o.fee_additional, currency: o.fee_additional_cur || "USD" });
    } else { // sea_sea
      if (+o.fee_1) feeLines.push({ label: `Seafreight USA→SIN (${cbmA.toFixed(2)} CBM × ${(+o.fee_1).toLocaleString()})`, amount: sf1Total, currency: o.fee_1_cur || "USD" });
      if (+o.fee_clearance) feeLines.push({ label: "Clearance fee", amount: +o.fee_clearance, currency: o.fee_clearance_cur || "SGD" });
      if (+o.fee_2) feeLines.push({ label: `Seafreight SIN→JKT (${cbmB.toFixed(2)} CBM × ${(+o.fee_2).toLocaleString()})`, amount: sf2Total, currency: o.fee_2_cur || "IDR" });
      if (+o.fee_additional) feeLines.push({ label: "Additional cost", amount: +o.fee_additional, currency: o.fee_additional_cur || "USD" });
    }
    // Extra costs added at invoice time (invoice tab)
    (o.extra_costs||[]).forEach(ec => feeLines.push({ label: ec.label, amount: +ec.amount, currency: ec.currency || "IDR" }));
    // Additional costs added at order time (order form)
    (o.order_extra_fees||[]).forEach(ef => {
      const qty = +ef.qty || 1;
      const total = (+ef.amount||0) * qty;
      if(ef.label||total) feeLines.push({
        label: qty > 1 ? `${ef.label||"Additional cost"} ×${qty}` : (ef.label||"Additional cost"),
        amount: total, currency: ef.currency || "USD"
      });
    });

    return { vol: totalVol, charged, chargedAuto, basis, minApplied, rate, price: weightPrice, divisor: div, pkgCount: pkgs.length, feeLines, feeMode };
  };
  const shipCostIDR = (sid) => costsFor(sid).reduce((a,c)=>a+toIDR(c.amount,c.currency,D.fx),0);
  const orderCostIDR = (o) => {
    const sib = D.orders.filter(x=>x.shipment_id===o.shipment_id);
    const tot = sib.reduce((a,x)=>a+Number(x.sell_idr),0) || 1;
    return shipCostIDR(o.shipment_id) * (Number(o.sell_idr)/tot);
  };

  const ctx = { D, isOwner, custName, custRate, courierOf, shipmentOf, costsFor, quote, orderCostIDR, shipCostIDR, reload: D.reload, patchOrder: D.patchOrder, liveFx };
  const TABS = [
    {k:"orders",label:"Orders",icon:LayoutGrid},
    {k:"shipments",label:"Shipments",icon:Boxes},
    {k:"customers",label:"Customers",icon:Users},
    {k:"pricing",label:"Pricing",icon:Tag},
    {k:"invoices",label:"Invoices",icon:FileText},
    {k:"completed",label:"Completed",icon:CheckCircle2},
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

      {tab==="orders"   && <div style={S.main}><Orders ctx={ctx}/></div>}
      {tab==="shipments"&& <div style={S.main}><Shipments ctx={ctx}/></div>}
      {tab==="customers"&& <div style={S.main}><CustomerData ctx={ctx}/></div>}
      {tab==="pricing"  && <div style={S.main}><Pricing ctx={ctx} reload={D.reload}/></div>}
      {tab==="invoices" && <div style={S.main}><Invoices ctx={ctx}/></div>}
      {tab==="completed" && <div style={S.main}><Completed ctx={ctx}/></div>}
      {tab==="finance" && isOwner && <div style={S.main}><Finance ctx={ctx}/></div>}

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
          {!isOwner&&<span style={{flex:1,fontSize:13,color:"var(--ink-2)"}}>{s?.eta_id ? new Date(s.eta_id).toLocaleDateString("en-GB") : "—"}</span>}
          <span style={{flex:"0 0 44px",display:"flex",justifyContent:"flex-end",gap:4}}>
            <button style={S.iconMini} title="Edit" onClick={()=>openEdit(o)}><Pencil size={14}/></button>
          </span>
          {sel===o.id&&(<div style={S.detail}>
            <div style={S.detailGrid}>
              <Detail label="Order date" value={o.order_date ? new Date(o.order_date).toLocaleDateString("en-GB") : "—"}/>
              <Detail label="Shipment" value={o.shipment_id+(consol?" (consolidated)":" (single)")}/>
              <Detail label="Courier" value={`${courierOf(s?.courier_id)?.name??"—"} · ÷${qd.divisor}`}/>
              <Detail label="Actual weight" value={`${o.weight_kg} kg`}/>
              <Detail label="Volumetric" value={`${qd.vol.toFixed(1)} kg`}/>
              <Detail label="Charged on" value={qd.minApplied?"3kg minimum":qd.basis} strong/>
              <Detail label="Rate / kg" value={o.price_currency==="USD"?`$${qd.rate.toLocaleString()}`:o.price_currency==="SGD"?`S$${qd.rate.toLocaleString()}`:fmtIDR(qd.rate)}/>
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
  const [stageFilter,setStageFilter]=useState(null); // null = all stages

  async function advance(sid,stage){setBusy(sid+stage);await setShipmentStage(sid,stage);await reload();setBusy(null);}
  async function setPay(sid,payment){setBusy(sid+payment);await setShipmentPayment(sid,payment);await reload();setBusy(null);}

  // Only show shipments that have at least one order
  const activeShipments=D.shipments.filter(s=>D.orders.some(o=>o.shipment_id===s.id));
  const stageCounts=STAGES.map(st=>activeShipments.filter(s=>s.stage===st).length);
  const list=activeShipments
    .filter(s=>stageFilter===null||s.stage===stageFilter)
    .filter(s=>[s.id,s.stage,s.payment].join(" ").toLowerCase().includes(q.toLowerCase()))
    .sort((a,b)=>a.id<b.id?1:-1);

  // unpaid-but-delivered = money owed
  const owed=activeShipments.filter(s=>s.stage==="Delivered to customer"&&s.payment!=="Paid").length;

  const stageShortLabels=["In US","Sent from US","In SG","Sent from SG","In ID","Delivered"];

  return(<>
    <div style={S.sectionLead}><h2 style={S.h2}>Shipments</h2>
      <p style={S.lead}>Update each shipment as it hits a checkpoint. Payment is tracked separately, so you can always see what's delivered but not yet paid.</p></div>
    <section style={S.kpis}>
      <Kpi label="Total shipments" value={activeShipments.length} sub="with orders"/>
      <Kpi label="In transit" value={activeShipments.filter(s=>s.stage!=="Delivered to customer").length} sub="not yet delivered"/>
      <Kpi label="Delivered, unpaid" value={owed} sub="money owed" warn={owed>0}/>
      <Kpi label="Paid" value={activeShipments.filter(s=>s.payment==="Paid").length} sub="settled"/>
    </section>

    {/* Stage breakdown — click a stage to filter the list below */}
    <div style={S.stageBar}>
      <button style={stageFilter===null?S.stageChipOn:S.stageChipOff} onClick={()=>setStageFilter(null)}>
        <span style={{fontSize:18,fontWeight:800}}>{activeShipments.length}</span>
        <span style={{fontSize:11}}>All</span>
      </button>
      {STAGES.map((st,i)=>(
        <button key={st} style={stageFilter===st?S.stageChipOn:S.stageChipOff} onClick={()=>setStageFilter(stageFilter===st?null:st)} title={st}>
          <span style={{fontSize:18,fontWeight:800}}>{stageCounts[i]}</span>
          <span style={{fontSize:11,textAlign:"center"}}>{stageShortLabels[i]}</span>
        </button>
      ))}
    </div>

    <div style={S.searchWrap}><Search size={15} style={{opacity:.5}}/><input style={S.search} placeholder="Search shipments…" value={q} onChange={e=>setQ(e.target.value)}/></div>
    {stageFilter!==null && <div style={S.filterNote}>Showing only: <b>{stageFilter}</b> <button style={S.clearFilterBtn} onClick={()=>setStageFilter(null)}>Clear filter</button></div>}

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
                <div>ETA: {s.eta_id ? new Date(s.eta_id).toLocaleDateString("en-GB") : "—"}</div>
                <div>Stage updated {fmtDate(s.stage_updated_at)}</div>
              </div>
            </div>

            {/* checkpoint timeline — hide SG→ID legs if destination is Singapore */}
            <div style={S.timeline}>
              {STAGES.filter(st=>{
                const destSG = orders.some(o=>o.destination==="Singapore");
                if(destSG && (st==="Sent from SG"||st==="Received in ID")) return false;
                return true;
              }).map((st,i,arr)=>{
                const done=STAGES.indexOf(s.stage)>STAGES.indexOf(st);
                const current=s.stage===st;
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

            {/* tracking numbers — hide legs beyond SG if destination is Singapore */}
            <div style={S.trackWrap}>
              <span style={{fontSize:12.5,color:"var(--ink-3)",display:"flex",alignItems:"center",gap:6,marginBottom:8}}><Truck size={14}/> Tracking</span>
              <div style={S.trackGrid}>
                {LEGS.filter(leg=>{
                  const destSG = orders.some(o=>o.destination==="Singapore");
                  if(destSG && (leg.num==="track_sg_id"||leg.num==="track_id_cust")) return false;
                  return true;
                }).map(leg=>(
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
  const {D}=ctx;
  const US_SG=["Airfreight","FedEx Priority","FedEx Economy","FedEx Freight","Seafreight"];
  const SG_ID=["Airfreight","Seafreight"];
  const isAirM=(m)=>m&&m!=="Seafreight";
  const [custName,setCustName]=useState("");const [custId,setCustId]=useState("");
  const [shUsSg,setShUsSg]=useState("FedEx Priority");const [shSgId,setShSgId]=useState("Airfreight");
  const [pkgs,setPkgs]=useState([{weight:0,l:0,w:0,h:0,unit:"metric"}]);
  const [chargedOvr,setChargedOvr]=useState("");
  const [pricePerKg,setPricePerKg]=useState(0);const [priceCur,setPriceCur]=useState("USD");
  const [airSeaOpt,setAirSeaOpt]=useState("weight");
  const [fee1,setFee1]=useState(0);const [fee1Cur,setFee1Cur]=useState("USD");
  const [feeClear,setFeeClear]=useState(0);const [feeClearCur,setFeeClearCur]=useState("SGD");
  const [fee2,setFee2]=useState(0);const [fee2Cur,setFee2Cur]=useState("IDR");
  const [feeAdd,setFeeAdd]=useState(0);const [feeAddCur,setFeeAddCur]=useState("USD");
  const [fxUSD,setFxUSD]=useState("");const [fxSGD,setFxSGD]=useState("");
  const [cbmUsSgOvr,setCbmUsSgOvr]=useState("");const [cbmSgIdOvr,setCbmSgIdOvr]=useState("");
  function sPkg(i,k,v){const p=[...pkgs];p[i]={...p[i],[k]:v};setPkgs(p);}
  function addP(){setPkgs([...pkgs,{weight:0,l:0,w:0,h:0,unit:"metric"}]);}
  function remP(i){if(pkgs.length>1)setPkgs(pkgs.filter((_,j)=>j!==i));}
  const matches=useMemo(()=>!custName.trim()?D.customers:D.customers.filter(c=>c.name.toLowerCase().includes(custName.toLowerCase())),[custName,D.customers]);
  const [ddOpen,setDdOpen]=useState(false);const ddRef=useRef(null);
  useEffect(()=>{const h=e=>{if(ddRef.current&&!ddRef.current.contains(e.target))setDdOpen(false);};document.addEventListener("mousedown",h);return()=>document.removeEventListener("mousedown",h);},[]);
  function pickC(c){setCustName(c.name);setCustId(c.id);setPricePerKg(c.rate_per_kg||0);setPriceCur(c.rate_currency||"USD");setDdOpen(false);}
  const div=shUsSg==="Seafreight"||shUsSg==="FedEx Freight"?6000:5000;
  const mPkgs=pkgs.map(p=>{const u=p.unit||"metric";return{weight:u==="imperial"?+p.weight*LB_TO_KG:+p.weight,l:u==="imperial"?+p.l*IN_TO_CM:+p.l,w:u==="imperial"?+p.w*IN_TO_CM:+p.w,h:u==="imperial"?+p.h*IN_TO_CM:+p.h};});
  let tRaw=0;mPkgs.forEach(p=>{tRaw+=chargeable({l:p.l,w:p.w,h:p.h},p.weight,div).raw;});
  const tAuto=finalizeCharged(tRaw).charged;const tCharged=+chargedOvr||tAuto;
  const wPrice=tCharged*(+pricePerKg);
  const aCBM=mPkgs.reduce((a,p)=>a+(p.l*p.w*p.h)/1000000,0);
  const cA=+cbmUsSgOvr||aCBM;const cB=+cbmSgIdOvr||aCBM;
  const s1T=(+fee1)*cA;const s2T=(+fee2)*cB;
  const fM=isAirM(shUsSg)&&isAirM(shSgId)?"air_air":isAirM(shUsSg)&&!isAirM(shSgId)?"air_sea":"sea_sea";
  const uR=+fxUSD||ctx.liveFx?.usd_idr||15850;const sR=+fxSGD||ctx.liveFx?.sgd_idr||11900;
  const toI=(a,c)=>c==="USD"?(+a||0)*uR:c==="SGD"?(+a||0)*sR:(+a||0);
  const fm=(n,c)=>c==="USD"?`$${Number(n||0).toFixed(2)}`:c==="SGD"?`S$${Number(n||0).toFixed(2)}`:fmtIDR(n||0);
  const gIDR=(()=>{
    if(fM==="air_air")return toI(wPrice,priceCur)+toI(+feeAdd,feeAddCur);
    if(fM==="air_sea"&&airSeaOpt==="weight")return toI(wPrice,priceCur)+toI(+feeAdd,feeAddCur);
    if(fM==="air_sea")return toI(+fee1,fee1Cur)+toI(+feeClear,feeClearCur)+toI(s2T,fee2Cur)+toI(+feeAdd,feeAddCur);
    return toI(s1T,fee1Cur)+toI(+feeClear,feeClearCur)+toI(s2T,fee2Cur)+toI(+feeAdd,feeAddCur);})();
  function dlPDF(){const doc=generateQuotationPDF({customerName:custName||"Customer",packages:mPkgs,divisor:div,courierName:shUsSg,ratePerKg:+pricePerKg,priceCurrency:priceCur});doc.save(`quotation-${custName||"customer"}.pdf`);}
  const CS=({v,onChange})=>(<select style={{...S.input,width:60,padding:"7px 2px",fontSize:12}} value={v} onChange={e=>onChange(e.target.value)}><option value="USD">USD</option><option value="SGD">SGD</option><option value="IDR">IDR</option></select>);
  return(
    <div style={{...S.card,padding:18,marginBottom:18}}>
      <div style={S.calcHead}><Calculator size={16}/><span style={{fontWeight:700}}>Live quote calculator</span></div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
        <div ref={ddRef} style={{position:"relative"}}><label style={S.field}><span style={S.fLabel}>Customer</span><input style={S.input} value={custName} onChange={e=>{setCustName(e.target.value);setCustId("");setDdOpen(true);}} onFocus={()=>setDdOpen(true)} placeholder="Type customer name…" autoComplete="off"/></label>
          {ddOpen&&<div style={{position:"absolute",top:"100%",left:0,right:0,background:"var(--card)",border:"1px solid var(--line)",borderRadius:10,maxHeight:150,overflowY:"auto",zIndex:10,boxShadow:"0 8px 24px rgba(0,0,0,.12)"}}>{matches.map(c=>(<button key={c.id} style={{display:"flex",justifyContent:"space-between",width:"100%",padding:"9px 12px",border:"none",background:"transparent",cursor:"pointer",fontFamily:"var(--body)",fontSize:13,textAlign:"left",borderBottom:"1px solid var(--line)"}} onClick={()=>pickC(c)}><span style={{fontWeight:600}}>{c.name}</span></button>))}{matches.length===0&&<div style={{padding:"9px 12px",fontSize:13,color:"var(--ink-3)"}}>No matches</div>}</div>}</div>
        <div></div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
        <label style={S.field}><span style={S.fLabel}>USA → SIN</span><select style={S.input} value={shUsSg} onChange={e=>setShUsSg(e.target.value)}>{US_SG.map(o=><option key={o}>{o}</option>)}</select></label>
        <label style={S.field}><span style={S.fLabel}>SIN → JKT</span><select style={S.input} value={shSgId} onChange={e=>setShSgId(e.target.value)}>{SG_ID.map(o=><option key={o}>{o}</option>)}</select></label>
      </div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}><span style={{fontSize:11,fontWeight:700,color:"var(--ink-3)",letterSpacing:".04em"}}>PACKAGES ({pkgs.length})</span><button onClick={addP} style={{display:"flex",alignItems:"center",gap:5,background:"var(--navy)",color:"#fff",border:"none",borderRadius:8,padding:"7px 12px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"var(--body)"}}><Plus size={13}/> Add package</button></div>
      {pkgs.map((p,i)=>{const u=p.unit||"metric";const mp=mPkgs[i];const ch=chargeable({l:mp.l,w:mp.w,h:mp.h},mp.weight,div);return(<div key={i}><div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4,background:"var(--head)",border:"1px solid var(--line)",borderRadius:9,padding:"8px 10px"}}><span style={{fontSize:12,color:"var(--ink-3)",fontWeight:700,width:20}}>{i+1}</span><input type="number" value={p.weight} onChange={e=>sPkg(i,"weight",e.target.value)} style={{...S.input,width:65,textAlign:"center"}} placeholder="0"/><select value={u} onChange={e=>sPkg(i,"unit",e.target.value)} style={{...S.input,width:42,padding:"7px 2px",fontSize:12}}><option value="metric">kg</option><option value="imperial">lb</option></select><input type="number" value={p.l} onChange={e=>sPkg(i,"l",e.target.value)} style={{...S.input,width:50,textAlign:"center"}} placeholder="L"/><span style={{color:"var(--ink-3)"}}>×</span><input type="number" value={p.w} onChange={e=>sPkg(i,"w",e.target.value)} style={{...S.input,width:50,textAlign:"center"}} placeholder="W"/><span style={{color:"var(--ink-3)"}}>×</span><input type="number" value={p.h} onChange={e=>sPkg(i,"h",e.target.value)} style={{...S.input,width:50,textAlign:"center"}} placeholder="H"/><select value={u} onChange={e=>sPkg(i,"unit",e.target.value)} style={{...S.input,width:42,padding:"7px 2px",fontSize:12}}><option value="metric">cm</option><option value="imperial">in</option></select>{pkgs.length>1&&<button onClick={()=>remP(i)} style={{background:"transparent",border:"none",color:"var(--bad)",cursor:"pointer"}}><Trash2 size={14}/></button>}</div><div style={{padding:"2px 10px 8px 30px",fontSize:12,display:"flex",gap:8,flexWrap:"wrap"}}><span style={ch.basis==="actual"?{fontWeight:700,color:"var(--navy)",background:"var(--good-bg)",padding:"1px 6px",borderRadius:5}:{color:"var(--ink-3)"}}>Act: {mp.weight.toFixed(2)}kg</span><span style={{color:"var(--ink-3)",fontStyle:"italic"}}>vs</span><span style={ch.basis==="volumetric"?{fontWeight:700,color:"var(--navy)",background:"var(--good-bg)",padding:"1px 6px",borderRadius:5}:{color:"var(--ink-3)"}}>Vol: {ch.vol.toFixed(2)}kg</span><span style={{color:"var(--ink-3)"}}>→</span><span style={{fontWeight:700}}>{ch.raw.toFixed(2)}kg</span></div></div>);})}
      <div style={{background:"var(--head)",border:"1px solid var(--line)",borderRadius:10,padding:"10px 14px",marginBottom:14}}><div style={{display:"flex",justifyContent:"space-between",gap:12,fontSize:13,flexWrap:"wrap",marginBottom:6}}><span>Auto: <b>{tAuto.toFixed(1)} kg</b></span><div style={{display:"flex",alignItems:"center",gap:6}}><span style={{fontSize:12,color:"var(--ink-3)"}}>Override:</span><input type="number" value={chargedOvr} onChange={e=>setChargedOvr(e.target.value)} placeholder={tAuto.toFixed(1)} style={{...S.input,width:75,textAlign:"center",padding:"4px 6px",fontSize:13,fontWeight:700,...(chargedOvr?{borderColor:"var(--navy)"}:{})}}/></div><span style={{fontWeight:700,color:"var(--navy)",fontSize:14}}>Final: {tCharged.toFixed(1)} kg</span></div><span style={{fontSize:11,color:"var(--ink-3)"}}>{pkgs.length} pkg · ÷{div}</span></div>
      <div style={{background:"var(--head)",border:"1px solid var(--line)",borderRadius:12,padding:16,marginBottom:12}}>
        <div style={{fontSize:12,fontWeight:700,color:"var(--ink-3)",letterSpacing:".04em",marginBottom:10,textTransform:"uppercase"}}>Pricing — {fM==="air_air"?"Air + Air":fM==="air_sea"?"Air + Sea":"Sea + Sea"}</div>
        {fM==="air_air"&&(<><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}><label style={S.field}><span style={S.fLabel}>Rate per kg</span><div style={{display:"flex",gap:4}}><input style={{...S.input,flex:1}} type="number" value={pricePerKg} onChange={e=>setPricePerKg(e.target.value)}/><CS v={priceCur} onChange={setPriceCur}/></div></label><label style={S.field}><span style={S.fLabel}>Additional cost</span><div style={{display:"flex",gap:4}}><input style={{...S.input,flex:1}} type="number" value={feeAdd} onChange={e=>setFeeAdd(e.target.value)} placeholder="0"/><CS v={feeAddCur} onChange={setFeeAddCur}/></div></label></div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginTop:8}}><label style={S.field}><span style={S.fLabel}>USD→IDR</span><input style={S.input} type="number" value={fxUSD} onChange={e=>setFxUSD(e.target.value)} placeholder={ctx.liveFx?.usd_idr||15850}/></label><label style={S.field}><span style={S.fLabel}>SGD→IDR</span><input style={S.input} type="number" value={fxSGD} onChange={e=>setFxSGD(e.target.value)} placeholder={ctx.liveFx?.sgd_idr||11900}/></label></div><div style={{background:"var(--good-bg)",borderRadius:9,padding:"10px 14px",marginTop:8}}><span style={{fontWeight:700,fontSize:14}}>Total (IDR): {fmtIDR(gIDR)}</span></div></>)}
        {fM==="air_sea"&&(<><label style={S.field}><span style={S.fLabel}>Pricing method</span><select style={S.input} value={airSeaOpt} onChange={e=>setAirSeaOpt(e.target.value)}><option value="weight">Price per weight + Additional</option><option value="breakdown">Airfreight + Clearance + Seafreight/CBM + Additional</option></select></label>{airSeaOpt==="weight"?(<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}><label style={S.field}><span style={S.fLabel}>Rate per kg</span><div style={{display:"flex",gap:4}}><input style={{...S.input,flex:1}} type="number" value={pricePerKg} onChange={e=>setPricePerKg(e.target.value)}/><CS v={priceCur} onChange={setPriceCur}/></div></label><label style={S.field}><span style={S.fLabel}>Additional cost</span><div style={{display:"flex",gap:4}}><input style={{...S.input,flex:1}} type="number" value={feeAdd} onChange={e=>setFeeAdd(e.target.value)} placeholder="0"/><CS v={feeAddCur} onChange={setFeeAddCur}/></div></label></div>):(<><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}><label style={S.field}><span style={S.fLabel}>Airfreight fee</span><div style={{display:"flex",gap:4}}><input style={{...S.input,flex:1}} type="number" value={fee1} onChange={e=>setFee1(e.target.value)}/><CS v={fee1Cur} onChange={setFee1Cur}/></div></label><label style={S.field}><span style={S.fLabel}>Clearance fee</span><div style={{display:"flex",gap:4}}><input style={{...S.input,flex:1}} type="number" value={feeClear} onChange={e=>setFeeClear(e.target.value)}/><CS v={feeClearCur} onChange={setFeeClearCur}/></div></label></div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}><label style={S.field}><span style={S.fLabel}>SF rate/CBM (SIN→JKT)</span><div style={{display:"flex",gap:4}}><input style={{...S.input,flex:1}} type="number" value={fee2} onChange={e=>setFee2(e.target.value)}/><CS v={fee2Cur} onChange={setFee2Cur}/></div></label><label style={S.field}><span style={S.fLabel}>Additional cost</span><div style={{display:"flex",gap:4}}><input style={{...S.input,flex:1}} type="number" value={feeAdd} onChange={e=>setFeeAdd(e.target.value)}/><CS v={feeAddCur} onChange={setFeeAddCur}/></div></label></div><label style={S.field}><span style={S.fLabel}>{`CBM SIN→JKT (auto: ${aCBM.toFixed(3)})`}</span><input style={{...S.input,maxWidth:200}} type="number" value={cbmSgIdOvr} onChange={e=>setCbmSgIdOvr(e.target.value)} placeholder={aCBM.toFixed(3)}/></label></>)}<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginTop:8}}><label style={S.field}><span style={S.fLabel}>USD→IDR</span><input style={S.input} type="number" value={fxUSD} onChange={e=>setFxUSD(e.target.value)} placeholder={ctx.liveFx?.usd_idr||15850}/></label><label style={S.field}><span style={S.fLabel}>SGD→IDR</span><input style={S.input} type="number" value={fxSGD} onChange={e=>setFxSGD(e.target.value)} placeholder={ctx.liveFx?.sgd_idr||11900}/></label></div><div style={{background:"var(--good-bg)",borderRadius:9,padding:"10px 14px",marginTop:6}}><span style={{fontWeight:700,fontSize:14}}>Total (IDR): {fmtIDR(gIDR)}</span></div></>)}
        {fM==="sea_sea"&&(<><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}><label style={S.field}><span style={S.fLabel}>SF1 rate/CBM (USA→SIN)</span><div style={{display:"flex",gap:4}}><input style={{...S.input,flex:1}} type="number" value={fee1} onChange={e=>setFee1(e.target.value)}/><CS v={fee1Cur} onChange={setFee1Cur}/></div></label><label style={S.field}><span style={S.fLabel}>Clearance fee</span><div style={{display:"flex",gap:4}}><input style={{...S.input,flex:1}} type="number" value={feeClear} onChange={e=>setFeeClear(e.target.value)}/><CS v={feeClearCur} onChange={setFeeClearCur}/></div></label></div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}><label style={S.field}><span style={S.fLabel}>SF2 rate/CBM (SIN→JKT)</span><div style={{display:"flex",gap:4}}><input style={{...S.input,flex:1}} type="number" value={fee2} onChange={e=>setFee2(e.target.value)}/><CS v={fee2Cur} onChange={setFee2Cur}/></div></label><label style={S.field}><span style={S.fLabel}>Additional cost</span><div style={{display:"flex",gap:4}}><input style={{...S.input,flex:1}} type="number" value={feeAdd} onChange={e=>setFeeAdd(e.target.value)}/><CS v={feeAddCur} onChange={setFeeAddCur}/></div></label></div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}><label style={S.field}><span style={S.fLabel}>USD→IDR</span><input style={S.input} type="number" value={fxUSD} onChange={e=>setFxUSD(e.target.value)} placeholder={ctx.liveFx?.usd_idr||15850}/></label><label style={S.field}><span style={S.fLabel}>SGD→IDR</span><input style={S.input} type="number" value={fxSGD} onChange={e=>setFxSGD(e.target.value)} placeholder={ctx.liveFx?.sgd_idr||11900}/></label></div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}><label style={S.field}><span style={S.fLabel}>{`CBM USA→SIN (auto: ${aCBM.toFixed(3)})`}</span><input style={S.input} type="number" value={cbmUsSgOvr} onChange={e=>setCbmUsSgOvr(e.target.value)} placeholder={aCBM.toFixed(3)}/></label><label style={S.field}><span style={S.fLabel}>{`CBM SIN→JKT (auto: ${aCBM.toFixed(3)})`}</span><input style={S.input} type="number" value={cbmSgIdOvr} onChange={e=>setCbmSgIdOvr(e.target.value)} placeholder={aCBM.toFixed(3)}/></label></div><div style={{display:"flex",flexWrap:"wrap",gap:"6px 14px",background:"var(--card)",border:"1px solid var(--line)",borderRadius:9,padding:"10px 14px",fontSize:12.5,marginTop:6}}><span>SF1:{fm(+fee1,fee1Cur)}/CBM×{cA.toFixed(2)}={fm(s1T,fee1Cur)}</span><span>Clear:{fm(+feeClear,feeClearCur)}</span><span>SF2:{fm(+fee2,fee2Cur)}/CBM×{cB.toFixed(2)}={fm(s2T,fee2Cur)}</span><span>Add:{fm(+feeAdd,feeAddCur)}</span></div><div style={{background:"var(--good-bg)",borderRadius:9,padding:"10px 14px",marginTop:4}}><span style={{fontWeight:700,fontSize:14}}>Total (IDR): {fmtIDR(gIDR)}</span></div></>)}
      </div>
      <div style={{display:"flex",justifyContent:"flex-end"}}><button style={S.printBtn} onClick={dlPDF}><Download size={13}/> Download PDF</button></div>
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
            <FileText size={15} style={{color:"var(--navy)"}}/>
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
    {openId && <InvoiceDoc ctx={ctx} order={filtered.find(o=>o.id===openId)} onComplete={handleComplete} reload={reload}/>}
  </>);
}

function InvoiceDoc({ctx,order,onComplete,reload}){
  const {D,custName,courierOf,shipmentOf,quote,patchOrder}=ctx;
  const q=quote(order);const s=shipmentOf(order.shipment_id);const c=courierOf(s?.courier_id);
  const invNo="INV-"+order.id.replace("ORD-","");
  const customer=D.customers.find(cu=>cu.id===order.customer_id);

  const [usdRate,setUsdRate]=useState(order.invoice_usd_rate || "");
  const [sgdRate,setSgdRate]=useState(order.invoice_sgd_rate || "");
  const [newCostLabel,setNewCostLabel]=useState("");
  const [newCostAmt,setNewCostAmt]=useState("");
  const [newCostCur,setNewCostCur]=useState("IDR");
  const [saving,setSaving]=useState(false);

  const fxU=+usdRate||ctx.liveFx?.usd_idr||15850;
  const fxS=+sgdRate||ctx.liveFx?.sgd_idr||11900;
  const toIDR=(amt,cur)=>cur==="USD"?(+amt||0)*fxU:cur==="SGD"?(+amt||0)*fxS:(+amt||0);
  const fmtOrig=(amt,cur)=>cur==="USD"?`$${Number(amt||0).toFixed(2)}`:cur==="SGD"?`S$${Number(amt||0).toFixed(2)}`:fmtIDR(amt||0);

  const grandTotalIDR=q.feeLines.reduce((a,l)=>a+toIDR(l.amount,l.currency),0);

  async function saveRates(){
    setSaving(true);
    const patch={invoice_usd_rate:+usdRate||null,invoice_sgd_rate:+sgdRate||null,sell_idr:Math.round(grandTotalIDR)};
    const {error}=await updateOrder(order.id,patch);
    setSaving(false);
    if(!error) patchOrder?patchOrder(order.id,patch):reload&&reload();
  }

  async function addCost(){
    if(!newCostLabel.trim()||!newCostAmt) return;
    const extra=[...(order.extra_costs||[]),{label:newCostLabel.trim(),amount:+newCostAmt,currency:newCostCur}];
    const patch={extra_costs:extra,sell_idr:Math.round(grandTotalIDR+toIDR(+newCostAmt,newCostCur))};
    const {error}=await updateOrder(order.id,patch);
    if(!error){
      setNewCostLabel("");setNewCostAmt("");
      patchOrder?patchOrder(order.id,patch):reload&&reload();
    }
  }
  async function removeCost(idx){
    const extra=(order.extra_costs||[]).filter((_,i)=>i!==idx);
    const removed=(order.extra_costs||[])[idx];
    const newTotal=grandTotalIDR-toIDR(removed.amount,removed.currency);
    const patch={extra_costs:extra,sell_idr:Math.round(newTotal)};
    const {error}=await updateOrder(order.id,patch);
    if(!error) patchOrder?patchOrder(order.id,patch):reload&&reload();
  }

  function downloadPDF(){
    const doc=generateInvoicePDF(order,customer,s,c,{usd_idr:fxU,sgd_idr:fxS},D.orders);
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

      {/* Line items in original currencies */}
      <div style={S.invTableHead}><span style={{flex:3}}>Description</span><span style={{flex:1,textAlign:"right"}}>Amount</span><span style={{flex:1,textAlign:"right"}}>In IDR</span></div>
      {q.feeLines.map((l,i)=>(
        <div key={i} style={S.invLine}>
          <span style={{flex:3}}>{l.label}</span>
          <span style={{flex:1,textAlign:"right"}}>{fmtOrig(l.amount,l.currency)}</span>
          <span style={{flex:1,textAlign:"right",fontWeight:600}}>{fmtIDR(toIDR(l.amount,l.currency))}</span>
        </div>
      ))}
      {q.feeLines.length===0 && <div style={{padding:"12px 0",fontSize:13,color:"var(--ink-3)"}}>No fee lines recorded for this order.</div>}

      {/* Add extra cost */}
      <div style={S.addCostBox}>
        <div style={{fontSize:12,fontWeight:700,color:"var(--ink-3)",letterSpacing:".04em",marginBottom:8}}>ADD COST LINE</div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <input style={{...S.input,flex:2,minWidth:140}} placeholder="Description (e.g. Handling fee)" value={newCostLabel} onChange={e=>setNewCostLabel(e.target.value)}/>
          <input style={{...S.input,width:110}} type="number" placeholder="Amount" value={newCostAmt} onChange={e=>setNewCostAmt(e.target.value)}/>
          <select style={{...S.input,width:80}} value={newCostCur} onChange={e=>setNewCostCur(e.target.value)}>
            <option value="IDR">IDR</option><option value="USD">USD</option><option value="SGD">SGD</option>
          </select>
          <button style={S.printBtn} onClick={addCost}><Plus size={13}/> Add cost</button>
        </div>
        {(order.extra_costs||[]).length>0 && (
          <div style={{marginTop:10,display:"flex",flexDirection:"column",gap:4}}>
            {(order.extra_costs||[]).map((ec,i)=>(
              <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:13,padding:"4px 0"}}>
                <span>{ec.label}</span>
                <span style={{display:"flex",alignItems:"center",gap:8}}>
                  {fmtOrig(ec.amount,ec.currency)} ({fmtIDR(toIDR(ec.amount,ec.currency))})
                  <button onClick={()=>removeCost(i)} style={{background:"transparent",border:"none",color:"var(--bad)",cursor:"pointer",padding:2}}><Trash2 size={13}/></button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Conversion rates */}
      <div style={S.addCostBox}>
        <div style={{fontSize:12,fontWeight:700,color:"var(--ink-3)",letterSpacing:".04em",marginBottom:8}}>CONVERSION RATES (this invoice only)</div>
        <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"flex-end"}}>
          <label style={{flex:1,minWidth:140}}><span style={{display:"block",fontSize:12,color:"var(--ink-3)",marginBottom:4}}>USD → IDR</span>
            <input style={S.input} type="number" value={usdRate} onChange={e=>setUsdRate(e.target.value)} placeholder={`e.g. ${ctx.liveFx?.usd_idr||15850}`}/></label>
          <label style={{flex:1,minWidth:140}}><span style={{display:"block",fontSize:12,color:"var(--ink-3)",marginBottom:4}}>SGD → IDR</span>
            <input style={S.input} type="number" value={sgdRate} onChange={e=>setSgdRate(e.target.value)} placeholder={`e.g. ${ctx.liveFx?.sgd_idr||11900}`}/></label>
          <button style={S.printBtn} onClick={saveRates} disabled={saving}>{saving?"Saving…":"Save rates"}</button>
        </div>
      </div>

      <div style={S.invTotal}><span>Total due</span><span style={{fontFamily:"var(--display)",fontSize:22,fontWeight:800,color:"var(--navy)"}}>{fmtIDR(grandTotalIDR)}</span></div>
      <div style={S.invFoot}><span>Payment in IDR within 14 days · Bank transfer to JEI account</span>
        <div style={{display:"flex",gap:8}}>
          <button style={S.printBtn} onClick={downloadPDF}><Download size={13}/> Download PDF</button>
          {!order.completed && onComplete && <button style={{...S.printBtn,background:"var(--good)",color:"#fff"}} onClick={()=>onComplete(order.id)}><Check size={13}/> Complete</button>}
        </div></div>
    </div>);
}

// ──────────── COMPLETED ────────────
function Completed({ctx}){
  const {D,custName,shipmentOf,courierOf,quote,reload}=ctx;
  const [q,setQ]=useState("");
  const [dateFrom,setDateFrom]=useState("");
  const [dateTo,setDateTo]=useState("");
  const [sortDir,setSortDir]=useState("desc");
  const [openId,setOpenId]=useState(null);
  const [delId,setDelId]=useState(null);
  const [busy,setBusy]=useState(false);

  const completed=D.orders.filter(o=>o.completed);

  const filtered=completed
    .filter(o=>{
      const search=[o.id,custName(o.customer_id),o.product,o.shipment_id].join(" ").toLowerCase();
      if(q && !search.includes(q.toLowerCase())) return false;
      if(dateFrom && o.completed_at && o.completed_at < dateFrom) return false;
      if(dateTo && o.completed_at && o.completed_at > dateTo+"T23:59:59") return false;
      return true;
    })
    .sort((a,b)=>{
      const da=a.completed_at||a.order_date||"";
      const db=b.completed_at||b.order_date||"";
      return sortDir==="desc"?db.localeCompare(da):da.localeCompare(db);
    });

  async function doDelete(orderId){
    setBusy(true);
    await updateOrder(orderId,{completed:false,completed_at:null});
    setDelId(null); setOpenId(null);
    reload(); setBusy(false);
  }

  return(<>
    <div style={S.sectionLead}>
      <h2 style={S.h2}>Completed</h2>
      <p style={S.lead}>Archived orders that have been invoiced and settled. Click any row to expand full details.</p>
    </div>

    <section style={S.kpis}>
      <Kpi label="Total completed" value={completed.length} sub="all time"/>
      <Kpi label="Showing" value={filtered.length} sub="after filters"/>
      <Kpi label="Total revenue" value={"Rp "+Math.round(completed.reduce((a,o)=>a+(+o.sell_idr||0),0)/1e6)+"jt"} sub="from completed"/>
    </section>

    {/* Filters */}
    <div style={{background:"var(--card)",border:"1px solid var(--line)",borderRadius:12,padding:"14px 16px",marginBottom:16,display:"flex",flexWrap:"wrap",gap:10,alignItems:"flex-end"}}>
      <div style={{...S.searchWrap,flex:1,minWidth:180,marginBottom:0}}>
        <Search size={15} style={{opacity:.5}}/><input style={S.search} placeholder="Search order, customer, product…" value={q} onChange={e=>setQ(e.target.value)}/>
      </div>
      <label style={{display:"flex",flexDirection:"column",gap:4,fontSize:12,color:"var(--ink-3)",fontWeight:600}}>
        From<input type="date" style={{...S.input,width:140}} value={dateFrom} onChange={e=>setDateFrom(e.target.value)}/>
      </label>
      <label style={{display:"flex",flexDirection:"column",gap:4,fontSize:12,color:"var(--ink-3)",fontWeight:600}}>
        To<input type="date" style={{...S.input,width:140}} value={dateTo} onChange={e=>setDateTo(e.target.value)}/>
      </label>
      <div style={{display:"flex",gap:6}}>
        <button className={"seg "+(sortDir==="desc"?"on":"")} onClick={()=>setSortDir("desc")}>Newest first</button>
        <button className={"seg "+(sortDir==="asc"?"on":"")} onClick={()=>setSortDir("asc")}>Oldest first</button>
      </div>
      {(q||dateFrom||dateTo)&&<button style={{...S.secBtn,padding:"7px 10px"}} onClick={()=>{setQ("");setDateFrom("");setDateTo("");}}>Clear filters</button>}
    </div>

    {filtered.length===0 && <div style={S.empty}>{completed.length===0?"No completed orders yet — complete an invoice to archive it here.":"No orders match your filters."}</div>}

    <div style={{display:"flex",flexDirection:"column",gap:8}}>
      {filtered.map(o=>{
        const s=shipmentOf(o.shipment_id);
        const c=courierOf(s?.courier_id);
        const customer=D.customers.find(cu=>cu.id===o.customer_id);
        const q2=quote(o);
        const fxU=+o.invoice_usd_rate||ctx.liveFx?.usd_idr||15850;
        const fxS=+o.invoice_sgd_rate||ctx.liveFx?.sgd_idr||11900;
        const toIDR=(amt,cur)=>cur==="USD"?(+amt||0)*fxU:cur==="SGD"?(+amt||0)*fxS:(+amt||0);
        const totalIDR=+o.sell_idr||q2.feeLines.reduce((a,l)=>a+toIDR(l.amount,l.currency),0);
        const completedDate=o.completed_at?new Date(o.completed_at).toLocaleDateString("en-GB"):"—";
        const orderDate=o.order_date?new Date(o.order_date).toLocaleDateString("en-GB"):"—";
        const isOpen=openId===o.id;
        const invNo="INV-"+o.id.replace("ORD-","");

        function dlPDF(){
          const doc=generateInvoicePDF(o,customer,s,c,ctx.liveFx);
          doc.save(`${invNo}.pdf`);
        }

        return(
          <div key={o.id} style={{background:"var(--card)",border:"1px solid var(--line)",borderRadius:12,overflow:"hidden",transition:".15s"}}>
            {/* Summary row — click to expand */}
            <button onClick={()=>setOpenId(isOpen?null:o.id)}
              style={{width:"100%",display:"flex",flexWrap:"wrap",gap:10,alignItems:"center",padding:"12px 16px",background:"transparent",border:"none",cursor:"pointer",fontFamily:"var(--body)",textAlign:"left"}}>
              <span style={{fontFamily:"var(--mono)",fontSize:12,color:"var(--ink-3)",flex:"0 0 80px"}}>{o.id}</span>
              <div style={{flex:2,minWidth:140}}>
                <div style={{fontWeight:700,fontSize:14,color:"var(--ink)"}}>{custName(o.customer_id)}</div>
                <div style={{fontSize:12,color:"var(--ink-3)"}}>{o.product}</div>
              </div>
              <div style={{flex:1,minWidth:90,textAlign:"left"}}>
                <div style={{fontSize:11,color:"var(--ink-3)"}}>Shipment</div>
                <div style={{fontSize:12.5,fontWeight:600,color:"var(--ink)"}}>{o.shipment_id||"—"}{c?.name?` · ${c.name}`:""}</div>
              </div>
              <div style={{flex:1,minWidth:80,textAlign:"left"}}>
                <div style={{fontSize:11,color:"var(--ink-3)"}}>Order date</div>
                <div style={{fontSize:12.5,color:"var(--ink)"}}>{orderDate}</div>
              </div>
              <div style={{flex:1,minWidth:80,textAlign:"left"}}>
                <div style={{fontSize:11,color:"var(--ink-3)"}}>Completed</div>
                <div style={{fontSize:12.5,fontWeight:600,color:"var(--good)"}}>{completedDate}</div>
              </div>
              <div style={{flex:0,textAlign:"right"}}>
                <div style={{fontFamily:"var(--display)",fontSize:15,fontWeight:800,color:"var(--navy)"}}>{fmtIDR(totalIDR)}</div>
              </div>
              <ChevronRight size={16} style={{color:"var(--ink-3)",transform:isOpen?"rotate(90deg)":"none",transition:".15s",flexShrink:0}}/>
            </button>

            {/* Expanded detail */}
            {isOpen && <div style={{borderTop:"1px solid var(--line)",padding:"16px"}}>
              {/* Order details grid */}
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:10,marginBottom:16}}>
                {[
                  ["Invoice No", invNo],
                  ["Customer type", o.customer_type||"—"],
                  ["Supplier (US sender)", o.supplier_name||"—"],
                  ["Destination", o.destination||"Indonesia"],
                  ["Route (US→SIN)", o.shipping_us_sg||"—"],
                  ["Route (SIN→JKT)", o.shipping_sg_id||"—"],
                  ["Qty", o.qty||"—"],
                  ["Divisor", o.divisor?`÷${o.divisor}`:"—"],
                  ["Charged weight", `${q2.charged.toFixed(1)} kg`],
                  ["Contact person", o.contact_person||customer?.contact_person||"—"],
                  ["AES required", o.aes_required?"Yes":"No"],
                  ["Pickup required", o.pickup_required?"Yes":"No"],
                ].map(([label,val])=>(
                  <div key={label} style={{background:"var(--head)",borderRadius:9,padding:"8px 12px"}}>
                    <div style={{fontSize:10.5,color:"var(--ink-3)",fontWeight:600,textTransform:"uppercase",letterSpacing:".05em",marginBottom:2}}>{label}</div>
                    <div style={{fontSize:13,fontWeight:600,color:"var(--ink)"}}>{val}</div>
                  </div>
                ))}
              </div>

              {/* Fee lines */}
              <div style={{marginBottom:14}}>
                <div style={{fontSize:12,fontWeight:700,color:"var(--ink-3)",letterSpacing:".04em",marginBottom:8}}>FEE BREAKDOWN</div>
                {q2.feeLines.length===0 && <div style={{fontSize:13,color:"var(--ink-3)"}}>No fee lines recorded.</div>}
                {q2.feeLines.map((l,i)=>(
                  <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:"1px solid var(--line)",fontSize:13}}>
                    <span style={{color:"var(--ink-2)"}}>{l.label}</span>
                    <span style={{fontWeight:600,color:"var(--ink)"}}>{l.currency==="USD"?`$${(+l.amount).toFixed(2)}`:l.currency==="SGD"?`S$${(+l.amount).toFixed(2)}`:fmtIDR(+l.amount)}</span>
                  </div>
                ))}
                <div style={{display:"flex",justifyContent:"space-between",padding:"8px 0",fontSize:14,fontWeight:700,color:"var(--navy)"}}>
                  <span>Total (IDR)</span><span>{fmtIDR(totalIDR)}</span>
                </div>
              </div>

              {o.additional_info && <div style={{marginBottom:14}}>
                <div style={{fontSize:12,fontWeight:700,color:"var(--ink-3)",letterSpacing:".04em",marginBottom:4}}>NOTES</div>
                <div style={{fontSize:13,color:"var(--ink-2)",lineHeight:1.6,whiteSpace:"pre-wrap"}}>{o.additional_info}</div>
              </div>}

              {/* Action buttons */}
              <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:4}}>
                <button style={{...S.secBtn,color:"var(--bad)",borderColor:"var(--bad)"}}
                  onClick={()=>setDelId(o.id)}>
                  <Trash2 size={13}/> Remove from completed
                </button>
                <button style={S.printBtn} onClick={dlPDF}>
                  <Download size={13}/> Download PDF
                </button>
              </div>
            </div>}
          </div>
        );
      })}
    </div>

    {delId && <ConfirmDialog danger title="Remove from completed?"
      message="This moves the order back to active Invoices. The order data is kept — nothing is deleted."
      confirmLabel={busy?"Moving…":"Move to invoices"} busy={busy}
      onConfirm={()=>doDelete(delId)} onCancel={()=>setDelId(null)}/>}
  </>);
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
                <span style={{fontFamily:"var(--display)",fontWeight:700,color:"var(--navy)"}}>{fmtIDR(Number(o.sell_idr||0))}</span>
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
function Kpi({label,value,sub,accent,warn}){return(<div style={{...S.kpi,...(accent?{borderColor:"var(--accent-line)"}:{}),...(warn?{borderColor:"var(--warn)"}:{})}}><div style={S.kpiLabel}>{label}</div><div style={{...S.kpiVal,...(accent?{color:"var(--navy)"}:{}),...(warn?{color:"var(--warn)"}:{})}}>{value}</div><div style={S.kpiSub}>{sub}</div></div>);}
function Detail({label,value,strong}){return <div><div style={S.dLabel}>{label}</div><div style={{...S.dVal,...(strong?{color:"var(--navy)",fontWeight:700,textTransform:"capitalize"}:{})}}>{value}</div></div>;}
function ResCell({label,value,note,dim,highlight,big}){return(<div style={{...S.resCell,...(highlight?{background:"var(--navy)",color:"#fff",borderColor:"var(--navy)"}:{}),...(dim?{opacity:.4}:{})}}><div style={{fontSize:10.5,textTransform:"uppercase",letterSpacing:".07em",opacity:.8}}>{label}{note?` ${note}`:""}</div><div style={{fontFamily:"var(--display)",fontWeight:800,fontSize:big?20:16,marginTop:3,textTransform:label==="Charged kg"?"capitalize":"none"}}>{value}</div></div>);}
function Center({children}){return <div style={{minHeight:"100vh",display:"grid",placeItems:"center",fontFamily:"'Inter',sans-serif",color:"#4A5C5A",background:"#F2F4F3"}}>{children}</div>;}

const S={
  root:{fontFamily:"var(--body)",color:"var(--ink)",background:"var(--bg)",minHeight:"100vh"},
  header:{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"14px clamp(14px,4vw,40px)",background:"var(--navy)",flexWrap:"wrap",gap:12},
  brandRow:{display:"flex",alignItems:"center",gap:12},
  logo:{width:42,height:42,objectFit:"contain",borderRadius:6},
  brandName:{fontFamily:"var(--display)",fontWeight:800,letterSpacing:".12em",fontSize:15,color:"#FFFFFF"},
  brandSub:{fontSize:11.5,color:"rgba(255,255,255,.55)",marginTop:1},
  who:{display:"flex",alignItems:"center",gap:6,fontSize:12.5,fontWeight:600,color:"rgba(255,255,255,.8)",background:"rgba(255,255,255,.1)",padding:"6px 12px",borderRadius:10,border:"1px solid rgba(255,255,255,.15)"},
  fxBar:{display:"flex",alignItems:"center",gap:5,background:"rgba(255,255,255,.1)",border:"1px solid rgba(255,255,255,.15)",borderRadius:10,padding:"6px 12px",fontSize:11.5,fontWeight:600,color:"rgba(255,255,255,.7)"},
  icoBtn:{display:"grid",placeItems:"center",width:34,height:34,border:"1px solid rgba(255,255,255,.2)",background:"rgba(255,255,255,.1)",borderRadius:9,cursor:"pointer",color:"rgba(255,255,255,.8)"},
  tabs:{display:"flex",gap:0,marginBottom:20,borderBottom:"2px solid var(--line)",padding:"0 clamp(14px,4vw,40px)",background:"var(--card)",boxShadow:"0 1px 4px rgba(0,0,0,.06)"},
  main:{padding:"20px clamp(14px,4vw,40px)",maxWidth:1180,margin:"0 auto"},
  kpis:{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:12,marginBottom:20},
  kpi:{background:"var(--card)",border:"1px solid var(--line)",borderRadius:13,padding:"15px 16px",boxShadow:"0 1px 3px rgba(0,0,0,.04)"},
  kpiLabel:{fontSize:11,textTransform:"uppercase",letterSpacing:".09em",color:"var(--ink-3)",fontWeight:700},
  kpiVal:{fontFamily:"var(--display)",fontSize:25,fontWeight:800,margin:"4px 0 2px",color:"var(--navy)"},
  kpiSub:{fontSize:11.5,color:"var(--ink-3)"},
  searchWrap:{display:"flex",alignItems:"center",gap:8,background:"var(--card)",border:"1px solid var(--line)",borderRadius:11,padding:"9px 13px",marginBottom:14},
  stageBar:{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(70px,1fr))",gap:8,marginBottom:14},
  stageChipOn:{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:2,background:"var(--navy)",color:"#fff",border:"1px solid var(--navy)",borderRadius:11,padding:"10px 4px",cursor:"pointer",fontFamily:"var(--body)",minHeight:54},
  stageChipOff:{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:2,background:"var(--card)",color:"var(--ink)",border:"1px solid var(--line)",borderRadius:11,padding:"10px 4px",cursor:"pointer",fontFamily:"var(--body)",minHeight:54},
  filterNote:{display:"flex",alignItems:"center",gap:10,fontSize:13,color:"var(--ink-2)",marginBottom:12,padding:"8px 13px",background:"var(--good-bg)",borderRadius:9},
  clearFilterBtn:{background:"transparent",border:"1px solid var(--line)",borderRadius:7,padding:"3px 10px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"var(--body)",color:"var(--ink-2)"},
  search:{border:"none",outline:"none",background:"transparent",flex:1,fontSize:14,color:"var(--ink)",fontFamily:"var(--body)"},
  primaryBtn:{display:"flex",alignItems:"center",gap:6,background:"var(--navy)",color:"#fff",border:"none",borderRadius:11,padding:"0 18px",fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"var(--body)"},
  secBtn:{display:"flex",alignItems:"center",gap:5,background:"var(--card)",border:"1px solid var(--line)",color:"var(--ink-2)",borderRadius:10,padding:"9px 13px",fontSize:12.5,fontWeight:600,cursor:"pointer",fontFamily:"var(--body)"},
  iconMini:{display:"grid",placeItems:"center",width:30,height:30,border:"1px solid var(--line)",background:"var(--card)",borderRadius:8,cursor:"pointer",color:"var(--ink-2)"},
  linkBtn:{border:"none",background:"transparent",color:"var(--navy)",fontWeight:700,cursor:"pointer",fontFamily:"var(--body)",fontSize:"inherit",padding:0,textDecoration:"underline"},
  shipCard:{background:"var(--card)",border:"1px solid var(--line)",borderRadius:14,padding:18},
  shipCardTop:{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:14,flexWrap:"wrap",marginBottom:16},
  timeline:{display:"flex",gap:6,flexWrap:"wrap",marginBottom:14},
  payRow:{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap",borderTop:"1px solid var(--line)",paddingTop:14},
  trackWrap:{borderTop:"1px solid var(--line)",paddingTop:14,marginTop:14},
  trackGrid:{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:10},
  legCard:{border:"1px solid var(--line)",borderRadius:10,padding:"11px 12px",background:"var(--head)"},
  legLabel:{fontSize:11,textTransform:"uppercase",letterSpacing:".06em",color:"var(--ink-3)",fontWeight:700,marginBottom:6},
  legLink:{display:"inline-flex",alignItems:"center",gap:4,background:"var(--navy)",color:"#fff",textDecoration:"none",borderRadius:7,padding:"5px 9px",fontSize:12,fontWeight:600},
  legCopy:{display:"inline-flex",alignItems:"center",gap:4,background:"var(--card)",border:"1px solid var(--line)",color:"var(--ink-2)",borderRadius:7,padding:"5px 9px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"var(--body)"},
  legEdit:{display:"inline-flex",alignItems:"center",background:"var(--card)",border:"1px solid var(--line)",color:"var(--ink-2)",borderRadius:7,padding:"5px 8px",cursor:"pointer"},
  legAdd:{display:"inline-flex",alignItems:"center",gap:5,background:"var(--card)",border:"1px dashed var(--line)",color:"var(--ink-2)",borderRadius:8,padding:"7px 11px",fontSize:12.5,fontWeight:600,cursor:"pointer",fontFamily:"var(--body)",width:"100%",justifyContent:"center"},
  legSave:{background:"var(--navy)",color:"#fff",border:"none",borderRadius:7,padding:"6px 14px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"var(--body)"},
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
  saveBtn:{background:"var(--navy)",color:"#fff",border:"none",borderRadius:8,padding:"6px 14px",fontSize:12.5,fontWeight:600,cursor:"pointer",fontFamily:"var(--body)"},
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
  addCostBox:{background:"var(--head)",border:"1px solid var(--line)",borderRadius:10,padding:"12px 14px",marginTop:14,marginBottom:14},
  invFoot:{display:"flex",justifyContent:"space-between",alignItems:"center",borderTop:"1px solid var(--line)",paddingTop:16,fontSize:12,color:"var(--ink-3)",flexWrap:"wrap",gap:12},
  printBtn:{display:"flex",alignItems:"center",gap:6,background:"var(--navy)",color:"#fff",border:"none",borderRadius:9,padding:"8px 14px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"var(--body)"},
  empty:{padding:"40px 20px",textAlign:"center",color:"var(--ink-3)",background:"var(--card)",border:"1px dashed var(--line)",borderRadius:14},
  footer:{marginTop:18,fontSize:11.5,color:"var(--ink-3)",textAlign:"center",lineHeight:1.6},
};
const CSS=`
:root{
  --bg:#F0F2F5;
  --card:#FFFFFF;
  --head:#F7F8FA;
  --line:#E2E6EC;
  --ink:#111827;
  --ink-2:#374151;
  --ink-3:#9CA3AF;
  --accent:#1B3A6B;
  --accent-2:#C9962A;
  --accent-line:#A8BDD8;
  --good:#16763A;
  --good-bg:#DCFCE7;
  --warn:#92580A;
  --warn-bg:#FEF3C7;
  --bad:#B91C1C;
  --bad-bg:#FEE2E2;
  --navy:#1B3A6B;
  --gold:#C9962A;
  --gold-bg:#FDF6E7;
  --display:'Space Grotesk',system-ui,sans-serif;
  --body:'Inter',system-ui,sans-serif;
  --mono:'JetBrains Mono',ui-monospace,monospace;
}
*{box-sizing:border-box}body{margin:0;background:var(--bg)}

/* Nav tabs — gold underline signature */
.tab{display:flex;align-items:center;gap:6px;border:none;background:transparent;color:var(--ink-3);font-size:13.5px;font-weight:600;padding:10px 16px;cursor:pointer;font-family:var(--body);border-bottom:2px solid transparent;margin-bottom:-1px;transition:.15s}
.tab.on{color:var(--navy);border-bottom-color:var(--gold)}.tab:hover{color:var(--ink-2)}

/* Rows */
.row:hover{background:var(--head)}.row:last-child,.row2:last-child{border-bottom:none}

/* Stage badges */
.stage{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600;color:var(--ink-2);background:var(--head);padding:3px 9px;border-radius:6px;border:1px solid var(--line)}
.stage[data-final="true"]{color:var(--good);background:var(--good-bg);border-color:transparent}

/* Segment buttons */
.seg{border:1px solid var(--line);background:var(--card);color:var(--ink-3);font-size:12px;font-weight:600;padding:5px 10px;border-radius:8px;cursor:pointer;font-family:var(--body);transition:.12s}
.seg.on{background:var(--navy);color:#fff;border-color:var(--navy)}
.seg:hover:not(.on){border-color:var(--accent-line);color:var(--ink-2)}

/* Invoice chips */
.invchip{display:flex;align-items:center;gap:6px;border:1px solid var(--line);background:var(--card);color:var(--ink-2);font-size:12.5px;font-weight:600;padding:7px 12px;border-radius:9px;cursor:pointer;font-family:var(--body);transition:.12s}
.invchip.on{background:var(--navy);color:#fff;border-color:var(--navy)}

/* Stage selector dropdown */
.stagesel{font-family:var(--body);font-size:12.5px;font-weight:600;color:var(--ink-2);background:var(--head);padding:5px 8px;border-radius:7px;border:1px solid var(--line);cursor:pointer;max-width:100%}
.stagesel[data-final="true"]{color:var(--good);background:var(--good-bg);border-color:transparent}

/* Shipment sub-tabs */
.shtab{flex:1;border:1px solid var(--line);background:var(--card);color:var(--ink-3);font-size:12.5px;font-weight:600;padding:7px 10px;border-radius:8px;cursor:pointer;font-family:var(--body);transition:.12s}
.shtab.on{background:var(--navy);color:#fff;border-color:var(--navy)}

/* Checkpoint timeline — navy current, green done, grey future */
.checkpoint{display:flex;align-items:center;gap:6px;border:1px solid var(--line);background:var(--card);border-radius:9px;padding:8px 11px;cursor:pointer;font-family:var(--body);font-size:12px;font-weight:600;transition:.15s}
.checkpoint .cpdot{display:grid;place-items:center;color:var(--ink-3)}
.checkpoint.done{background:var(--good-bg);border-color:transparent;color:var(--good)}
.checkpoint.done .cpdot{color:var(--good)}
.checkpoint.current{background:var(--navy);border-color:var(--navy);color:#fff}
.checkpoint.current .cpdot{color:rgba(255,255,255,.7)}
.checkpoint.future{color:var(--ink-3)}
.checkpoint:hover:not(:disabled){border-color:var(--navy);box-shadow:0 0 0 2px var(--accent-line)}

/* Payment badges */
.paybadge{display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px;margin-left:8px;letter-spacing:.02em}
.pay-Unpaid{background:var(--bad-bg);color:var(--bad)}
.pay-Invoiced{background:var(--warn-bg);color:var(--warn)}
.pay-Paid{background:var(--good-bg);color:var(--good)}

/* Payment segment controls */
.payseg{border:1px solid var(--line);background:var(--card);color:var(--ink-3);font-size:12.5px;font-weight:600;padding:6px 14px;border-radius:8px;cursor:pointer;font-family:var(--body);transition:.12s}
.payseg.on.pay-Unpaid{background:var(--bad-bg);color:var(--bad);border-color:var(--bad)}
.payseg.on.pay-Invoiced{background:var(--warn-bg);color:var(--warn);border-color:var(--warn)}
.payseg.on.pay-Paid{background:var(--good-bg);color:var(--good);border-color:var(--good)}

input::placeholder{color:var(--ink-3)}select{cursor:pointer}
@media print{.tab,.seg,nav,header button,footer{display:none}}
`;
