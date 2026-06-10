import { useState, useEffect } from "react";
import { ShieldCheck, KeyRound } from "lucide-react";
import { useAuth } from "../lib/auth";

// Shown after a successful email+password login, for EVERY user.
// - If the user has no passcode yet → first-time "create your passcode" mode.
// - Otherwise → "enter your passcode" mode.
export default function PasscodeGate() {
  const { profile, hasPasscode, verifyPasscode, setPasscode, signOut } = useAuth();
  const [mode, setMode] = useState(null); // "enter" | "create" | null(loading)
  const [code, setCode] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    hasPasscode().then((set) => { if (active) setMode(set ? "enter" : "create"); });
    return () => { active = false; };
  }, []);

  async function submitEnter() {
    setErr(""); setBusy(true);
    const ok = await verifyPasscode(code);
    setBusy(false);
    if (!ok) { setErr("Incorrect passcode."); setCode(""); }
  }

  async function submitCreate() {
    setErr("");
    if (code.length < 4) return setErr("Use at least 4 characters.");
    if (code !== confirm) return setErr("The two entries don't match.");
    setBusy(true);
    const { error } = await setPasscode(code);
    setBusy(false);
    if (error) setErr("Couldn't save passcode. Try again.");
    // on success, passcodeCleared flips true and this screen unmounts
  }

  if (!mode) {
    return <div style={S.wrap}><div style={S.card}>Loading…</div></div>;
  }

  return (
    <div style={S.wrap}>
      <div style={S.card}>
        <div style={S.icon}>{mode === "create" ? <KeyRound size={22} /> : <ShieldCheck size={22} />}</div>
        <div style={S.title}>{mode === "create" ? "Create your passcode" : "Enter your passcode"}</div>
        <div style={S.sub}>
          {mode === "create"
            ? `Hi ${profile?.full_name ?? "there"} — set a personal passcode. You'll enter it each time you sign in, on top of your password.`
            : `Hi ${profile?.full_name ?? "there"} — enter your passcode to continue.`}
        </div>

        <label style={S.label}>Passcode</label>
        <input
          style={S.input}
          type="password"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && mode === "enter" && submitEnter()}
          placeholder="••••••••"
          autoFocus
        />

        {mode === "create" && (
          <>
            <label style={S.label}>Confirm passcode</label>
            <input
              style={S.input}
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitCreate()}
              placeholder="••••••••"
            />
          </>
        )}

        {err && <div style={S.err}>{err}</div>}

        <button
          style={S.btn}
          onClick={mode === "create" ? submitCreate : submitEnter}
          disabled={busy}
        >
          {busy ? "Working…" : mode === "create" ? "Save & continue" : "Continue"}
        </button>
        <button style={S.text} onClick={signOut}>Sign out</button>
      </div>
    </div>
  );
}

const S = {
  wrap: { minHeight: "100vh", display: "grid", placeItems: "center", background: "#F2F4F3", fontFamily: "'Inter',system-ui,sans-serif", padding: 20 },
  card: { background: "#fff", border: "1px solid #E4E8E7", borderRadius: 16, padding: "34px 30px", width: "100%", maxWidth: 380, boxShadow: "0 8px 30px rgba(0,0,0,.05)", textAlign: "center" },
  icon: { width: 50, height: 50, borderRadius: "50%", background: "#DBF1EB", color: "#0E6E5C", display: "grid", placeItems: "center", margin: "0 auto 16px" },
  title: { fontFamily: "'Space Grotesk',sans-serif", fontWeight: 800, fontSize: 20, color: "#1A2B2A" },
  sub: { fontSize: 13.5, color: "#4A5C5A", margin: "8px 0 20px", lineHeight: 1.5 },
  label: { display: "block", fontSize: 12, fontWeight: 600, color: "#4A5C5A", margin: "12px 0 6px", textAlign: "left" },
  input: { width: "100%", border: "1px solid #E4E8E7", borderRadius: 10, padding: "11px 13px", fontSize: 14, fontFamily: "'Inter',sans-serif", outline: "none", boxSizing: "border-box", textAlign: "center", letterSpacing: "0.2em" },
  err: { background: "#F6DEE1", color: "#B23A48", fontSize: 13, padding: "9px 12px", borderRadius: 9, marginTop: 14 },
  btn: { width: "100%", marginTop: 18, background: "#0E6E5C", color: "#fff", border: "none", borderRadius: 10, padding: "12px", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "'Inter',sans-serif" },
  text: { marginTop: 14, background: "transparent", border: "none", color: "#8A9794", fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "'Inter',sans-serif" },
};
