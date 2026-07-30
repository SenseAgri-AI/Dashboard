import type { AlertItem } from "./DashAlertRow";

// Slim, color-coded alert list (was a tall WhatsApp panel). Compact rows, scrolls if many.
const RED = "#B91C1C", AMBER = "#D97706", GREEN = "#16A34A", NEUTRAL = "#9AA6A8";
const dotColor = (s: string) => (s === "danger" ? RED : s === "warning" ? AMBER : s === "normal" ? GREEN : NEUTRAL);

export default function DashAlertChat({ alerts, updatedAt }: { alerts: AlertItem[]; updatedAt?: string | null }) {
  const time = (iso?: string | null) => {
    if (!iso) return "";
    const d = new Date(iso);
    return isNaN(d.getTime()) ? "" : d.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" });
  };
  const stamp = time(updatedAt);

  return (
    <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,0.07)", borderRadius: 12, boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 15px", borderBottom: "1px solid var(--divider)" }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: GREEN, boxShadow: `0 0 6px ${GREEN}` }} />
        <span style={{ fontFamily: "var(--font-d)", fontWeight: 800, fontSize: 14, color: "var(--primary)" }}>Farm alerts</span>
        {stamp && <span style={{ fontSize: 10, color: "var(--t3)", marginLeft: "auto" }}>updated {stamp}</span>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", overflowY: "auto", maxHeight: 300 }}>
        {alerts.length === 0 ? (
          <div style={{ color: "var(--t3)", fontSize: 12, textAlign: "center", padding: "24px 12px" }}>No alerts — all readings normal.</div>
        ) : (
          alerts.map((a, i) => (
            <div key={a.metric} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "9px 14px", borderTop: i ? "1px solid var(--divider)" : "none" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: dotColor(a.status), flexShrink: 0, marginTop: 4 }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--t2)" }}>{a.metric}</span>
                  <span style={{ fontSize: 9, color: "var(--t4)", flexShrink: 0 }}>{time(a.updatedAt) || stamp}</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--t1)", lineHeight: 1.4, marginTop: 1 }}>{a.message}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
