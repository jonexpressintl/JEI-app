import { AlertTriangle } from "lucide-react";

// A styled "are you sure?" dialog. Use for any destructive or risky action.
// Props:
//   title, message  — what you're confirming
//   confirmLabel    — text on the confirm button (default "Confirm")
//   danger          — if true, confirm button is red (for deletes)
//   busy            — disables buttons while an action runs
//   onConfirm, onCancel
export default function ConfirmDialog({
  title, message, confirmLabel = "Confirm", danger = false, busy = false, onConfirm, onCancel,
}) {
  return (
    <div style={S.overlay} onClick={onCancel}>
      <div style={S.box} onClick={(e) => e.stopPropagation()}>
        <div style={{ ...S.iconWrap, ...(danger ? S.iconDanger : S.iconNeutral) }}>
          <AlertTriangle size={20} />
        </div>
        <div style={S.title}>{title}</div>
        <div style={S.message}>{message}</div>
        <div style={S.actions}>
          <button style={S.cancel} onClick={onCancel} disabled={busy}>Cancel</button>
          <button
            style={{ ...S.confirm, ...(danger ? S.confirmDanger : {}) }}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

const S = {
  overlay: { position: "fixed", inset: 0, background: "rgba(26,43,42,.55)", display: "grid", placeItems: "center", padding: 16, zIndex: 60, fontFamily: "var(--body)" },
  box: { background: "var(--card)", borderRadius: 16, padding: "26px 24px", width: "100%", maxWidth: 400, textAlign: "center", boxShadow: "0 20px 60px rgba(0,0,0,.3)" },
  iconWrap: { width: 46, height: 46, borderRadius: "50%", display: "grid", placeItems: "center", margin: "0 auto 14px" },
  iconDanger: { background: "var(--bad-bg)", color: "var(--bad)" },
  iconNeutral: { background: "var(--warn-bg)", color: "var(--warn)" },
  title: { fontFamily: "var(--display)", fontWeight: 800, fontSize: 18, marginBottom: 6, color: "var(--ink)" },
  message: { fontSize: 14, color: "var(--ink-2)", lineHeight: 1.5, marginBottom: 22 },
  actions: { display: "flex", gap: 10, justifyContent: "center" },
  cancel: { flex: 1, background: "var(--head)", border: "1px solid var(--line)", color: "var(--ink-2)", borderRadius: 10, padding: "11px", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "var(--body)" },
  confirm: { flex: 1, background: "var(--accent)", color: "#fff", border: "none", borderRadius: 10, padding: "11px", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "var(--body)" },
  confirmDanger: { background: "var(--bad)" },
};
