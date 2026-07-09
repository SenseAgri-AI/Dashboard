import type { AlertItem } from "./DashAlertRow";

// A chat-style alerts panel (WhatsApp-like): each worded alert is a message bubble,
// colour-coded and time-stamped. Inline-styled so it renders regardless of global CSS.
const PRIMARY = "#002E35";
const BORDER: Record<string, string> = { danger: "#B91C1C", warning: "#D97706", normal: "#16A34A", neutral: "#9AA6A8" };
const METRIC_COLOR: Record<string, string> = { danger: "#B91C1C", warning: "#92400E", normal: "#166534", neutral: "#3F4849" };

export default function DashAlertChat({ alerts, updatedAt }: { alerts: AlertItem[]; updatedAt?: string | null }) {
  const time = (iso?: string | null) => {
    if (!iso) return "";
    const d = new Date(iso);
    return isNaN(d.getTime()) ? "" : d.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" });
  };
  const stamp = time(updatedAt);

  return (
    <div style={{ display: "flex", flexDirection: "column", background: "var(--card)", border: "1px solid rgba(0,0,0,0.09)", boxShadow: "0 1px 4px rgba(0,0,0,0.08)", overflow: "hidden", minHeight: 320 }}>
      <div style={{ background: PRIMARY, color: "#fff", padding: "10px 14px", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#4ADE80", boxShadow: "0 0 6px #4ADE80" }} />
        <span style={{ fontFamily: "var(--font-d)", fontWeight: 800, fontSize: 14 }}>Farm alerts</span>
        {stamp && <span style={{ fontSize: 10, opacity: 0.75, marginLeft: "auto" }}>updated {stamp}</span>}
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 8, background: "#ECE5DD" }}>
        {alerts.length === 0 ? (
          <div style={{ color: "var(--t3)", fontSize: 12, textAlign: "center", margin: "auto" }}>No alerts — all readings normal.</div>
        ) : (
          alerts.map((a) => (
            <div key={a.metric} style={{ maxWidth: "92%", alignSelf: "flex-start", background: "#fff", borderRadius: "2px 10px 10px 10px", padding: "8px 11px", boxShadow: "0 1px 1px rgba(0,0,0,0.12)", borderLeft: `3px solid ${BORDER[a.status] ?? BORDER.neutral}` }}>
              <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2, color: METRIC_COLOR[a.status] ?? METRIC_COLOR.neutral }}>{a.metric}</div>
              <div style={{ fontSize: 12.5, color: "var(--t1)", lineHeight: 1.4 }}>{a.message}</div>
              <div style={{ fontSize: 9, color: "var(--t4)", textAlign: "right", marginTop: 3 }}>{time(a.updatedAt) || stamp}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
