import { useState } from "react";
import { useAuth } from "../lib/auth";

export default function Login() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setErr(""); setBusy(true);
    const { error } = await signIn(email.trim(), pw);
    if (error) setErr("Couldn't sign in. Check your email and password.");
    setBusy(false);
  }

  return (
    <div style={S.wrap}>
      <div style={S.card}>
        <div style={S.logo}>JEI</div>
        <div style={S.title}>Jon Express International</div>
        <div style={S.sub}>Sign in to your dashboard</div>
        <label style={S.label}>Email</label>
        <input style={S.input} type="email" value={email} onChange={e=>setEmail(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&submit()} placeholder="you@jei.com" />
        <label style={S.label}>Password</label>
        <input style={S.input} type="password" value={pw} onChange={e=>setPw(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&submit()} placeholder="••••••••" />
        {err && <div style={S.err}>{err}</div>}
        <button style={S.btn} onClick={submit} disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </div>
    </div>
  );
}

const S = {
  wrap:{minHeight:"100vh",display:"grid",placeItems:"center",background:"#F2F4F3",fontFamily:"'Inter',system-ui,sans-serif",padding:20},
  card:{background:"#fff",border:"1px solid #E4E8E7",borderRadius:16,padding:"34px 30px",width:"100%",maxWidth:380,boxShadow:"0 8px 30px rgba(0,0,0,.05)"},
  logo:{width:44,height:44,borderRadius:10,background:"#0E6E5C",color:"#fff",display:"grid",placeItems:"center",fontWeight:800,letterSpacing:".04em",fontFamily:"'Space Grotesk',sans-serif",marginBottom:18},
  title:{fontFamily:"'Space Grotesk',sans-serif",fontWeight:800,fontSize:19,color:"#1A2B2A"},
  sub:{fontSize:13,color:"#8A9794",marginBottom:22},
  label:{display:"block",fontSize:12,fontWeight:600,color:"#4A5C5A",margin:"14px 0 6px"},
  input:{width:"100%",border:"1px solid #E4E8E7",borderRadius:10,padding:"11px 13px",fontSize:14,fontFamily:"'Inter',sans-serif",outline:"none",boxSizing:"border-box"},
  err:{background:"#F6DEE1",color:"#B23A48",fontSize:13,padding:"9px 12px",borderRadius:9,marginTop:14},
  btn:{width:"100%",marginTop:20,background:"#0E6E5C",color:"#fff",border:"none",borderRadius:10,padding:"12px",fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"'Inter',sans-serif"},
};
