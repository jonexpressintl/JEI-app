import { useState } from "react";
import { useAuth } from "../lib/auth";
import { User, ArrowLeft } from "lucide-react";
import { LOGO } from "../lib/logo";

// Internal email mapping — users never see these.
const USERS = [
  { name: "Merry Toh", email: "merry@jei.app", initials: "MT" },
  { name: "Admin",     email: "angie@jei.app",  initials: "A" },
];

export default function Login() {
  const { signIn } = useAuth();
  const [selected, setSelected] = useState(null);
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setErr(""); setBusy(true);
    const { error } = await signIn(selected.email, pw);
    if (error) setErr("Incorrect password. Try again.");
    setBusy(false);
  }

  function back() { setSelected(null); setPw(""); setErr(""); }

  return (
    <div style={S.wrap}>
      <div style={S.card}>
        <img src={LOGO} alt="Jon Express International" style={S.logo} />
        <div style={S.title}>Jon Express International</div>

        {!selected ? (
          <>
            <div style={S.sub}>Who's signing in?</div>
            <div style={S.userList}>
              {USERS.map(u => (
                <button key={u.email} style={S.userBtn} onClick={() => setSelected(u)}>
                  <span style={S.avatar}>{u.initials}</span>
                  <span style={S.userName}>{u.name}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div style={S.sub}>
              <button style={S.backBtn} onClick={back}><ArrowLeft size={14}/> Back</button>
            </div>
            <div style={S.selectedUser}>
              <span style={S.avatarLg}>{selected.initials}</span>
              <span style={S.selectedName}>{selected.name}</span>
            </div>
            <label style={S.label}>Password</label>
            <input style={S.input} type="password" value={pw} onChange={e => setPw(e.target.value)}
              onKeyDown={e => e.key === "Enter" && submit()} placeholder="••••••••" autoFocus />
            {err && <div style={S.err}>{err}</div>}
            <button style={S.btn} onClick={submit} disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

const S = {
  wrap: { minHeight: "100vh", display: "grid", placeItems: "center", background: "#F2F4F3", fontFamily: "'Inter',system-ui,sans-serif", padding: 20 },
  card: { background: "#fff", border: "1px solid #E4E8E7", borderRadius: 16, padding: "34px 30px", width: "100%", maxWidth: 380, boxShadow: "0 8px 30px rgba(0,0,0,.05)", textAlign: "center" },
  logo: { width: 72, height: 72, objectFit: "contain", marginBottom: 18, margin: "0 auto 18px", display: "block" },
  title: { fontFamily: "'Space Grotesk',sans-serif", fontWeight: 800, fontSize: 19, color: "#1A2B2A" },
  sub: { fontSize: 13, color: "#8A9794", marginBottom: 22, marginTop: 4 },
  userList: { display: "flex", flexDirection: "column", gap: 10 },
  userBtn: { display: "flex", alignItems: "center", gap: 14, width: "100%", padding: "14px 16px", background: "#FAFBFB", border: "1px solid #E4E8E7", borderRadius: 12, cursor: "pointer", fontFamily: "'Inter',sans-serif", transition: ".15s" },
  avatar: { width: 40, height: 40, borderRadius: "50%", background: "#DBF1EB", color: "#0E6E5C", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 14, flexShrink: 0 },
  userName: { fontWeight: 600, fontSize: 15, color: "#1A2B2A" },
  backBtn: { display: "inline-flex", alignItems: "center", gap: 4, background: "transparent", border: "none", color: "#8A9794", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "'Inter',sans-serif", padding: 0 },
  selectedUser: { display: "flex", flexDirection: "column", alignItems: "center", gap: 8, marginBottom: 22 },
  avatarLg: { width: 56, height: 56, borderRadius: "50%", background: "#DBF1EB", color: "#0E6E5C", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 18 },
  selectedName: { fontWeight: 700, fontSize: 16, color: "#1A2B2A" },
  label: { display: "block", fontSize: 12, fontWeight: 600, color: "#4A5C5A", margin: "0 0 6px", textAlign: "left" },
  input: { width: "100%", border: "1px solid #E4E8E7", borderRadius: 10, padding: "11px 13px", fontSize: 14, fontFamily: "'Inter',sans-serif", outline: "none", boxSizing: "border-box", textAlign: "center", letterSpacing: "0.1em" },
  err: { background: "#F6DEE1", color: "#B23A48", fontSize: 13, padding: "9px 12px", borderRadius: 9, marginTop: 14 },
  btn: { width: "100%", marginTop: 20, background: "#0E6E5C", color: "#fff", border: "none", borderRadius: 10, padding: "12px", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "'Inter',sans-serif" },
};
