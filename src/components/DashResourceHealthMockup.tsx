const INK = "#002E35";
const TEAL = "#2A8E9A";
const GREEN = "#16A34A";
const AMBER = "#D97706";

const card: React.CSSProperties = {
  background: "#fff",
  border: "1px solid rgba(0,0,0,0.07)",
  borderRadius: 12,
  boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)",
  padding: "14px 15px",
  minWidth: 0,
};

function MiniTrend({ values, color = TEAL }: { values: number[]; color?: string }) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(0.01, max - min);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 28, marginTop: 10 }} aria-hidden>
      {values.map((value, index) => (
        <span
          key={index}
          style={{
            flex: 1,
            height: `${30 + ((value - min) / span) * 70}%`,
            background: color,
            opacity: 0.22 + index * 0.1,
            borderRadius: "2px 2px 0 0",
          }}
        />
      ))}
    </div>
  );
}

function MetricCard({
  label,
  value,
  unit,
  status,
  detail,
  values,
  color = TEAL,
}: {
  label: string;
  value: string;
  unit?: string;
  status: string;
  detail: string;
  values: number[];
  color?: string;
}) {
  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--t3)" }}>{label}</span>
        <span style={{ fontSize: 9, fontWeight: 800, color, background: `${color}12`, border: `1px solid ${color}28`, padding: "2px 6px", borderRadius: 20 }}>{status}</span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 5, marginTop: 10 }}>
        <span style={{ fontFamily: "var(--font-d)", fontSize: 29, lineHeight: 1, fontWeight: 800, letterSpacing: "-0.03em", color: INK }}>{value}</span>
        {unit && <span style={{ fontSize: 11, fontWeight: 700, color: "var(--t3)" }}>{unit}</span>}
      </div>
      <p style={{ fontSize: 10.5, lineHeight: 1.4, color: "var(--t3)", marginTop: 6 }}>{detail}</p>
      <MiniTrend values={values} color={color} />
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8.5, color: "var(--t4)", marginTop: 4 }}><span>7 days ago</span><span>today</span></div>
    </div>
  );
}

function GutHealthCard() {
  return (
    <div style={{ ...card, borderTop: `3px solid ${GREEN}`, display: "grid", gridTemplateColumns: "auto 1fr", gap: 14, alignItems: "center" }}>
      <div style={{ width: 70, height: 70, borderRadius: "50%", background: `conic-gradient(${GREEN} 0 82%, #E6ECEC 82% 100%)`, display: "grid", placeItems: "center" }}>
        <div style={{ width: 56, height: 56, borderRadius: "50%", background: "#fff", display: "grid", placeItems: "center", textAlign: "center" }}>
          <strong style={{ fontFamily: "var(--font-d)", fontSize: 21, color: INK, lineHeight: 1 }}>82</strong>
          <span style={{ fontSize: 8, color: "var(--t3)", fontWeight: 800 }}>/ 100</span>
        </div>
      </div>
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--t3)" }}>Gut-health signal</span>
          <span style={{ fontSize: 9, fontWeight: 800, color: GREEN }}>BALANCED</span>
        </div>
        <div style={{ fontFamily: "var(--font-d)", fontSize: 17, fontWeight: 800, color: INK, marginTop: 7 }}>Intake pattern looks stable</div>
        <p style={{ fontSize: 10.5, lineHeight: 1.45, color: "var(--t3)", marginTop: 4 }}>
          Screening signal from water:feed balance, water pH and recent stability. It flags a pattern to investigate—it does not diagnose gut disease.
        </p>
        <div style={{ display: "flex", gap: 12, marginTop: 9, flexWrap: "wrap" }}>
          <span style={{ fontSize: 9.5, color: "var(--t2)", fontWeight: 700 }}>Water:feed <b style={{ color: INK }}>1.86 L/kg</b></span>
          <span style={{ fontSize: 9.5, color: "var(--t2)", fontWeight: 700 }}>7d variation <b style={{ color: GREEN }}>low</b></span>
        </div>
      </div>
    </div>
  );
}

export default function DashResourceHealthMockup({ narrow = false }: { narrow?: boolean }) {
  return (
    <section aria-label="Feed, water and gut health concept">
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <div>
          <span style={{ fontFamily: "var(--font-d)", fontWeight: 800, fontSize: 15, color: "var(--primary)" }}>Feed, water & gut health</span>
          <span style={{ fontSize: 10, color: "var(--t3)", marginLeft: 8 }}>Operational efficiency and early-change signals</span>
        </div>
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", color: AMBER, background: "#FFFBEB", border: "1px solid #FDE68A", padding: "3px 8px", borderRadius: 20 }}>CONCEPT · SAMPLE DATA</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: narrow ? "repeat(2, minmax(0, 1fr))" : "repeat(4, minmax(0, 1fr))", gap: 10 }}>
        <MetricCard label="Feed conversion" value="2.08" unit="kg/kg egg" status="ON TARGET" detail="Feed used per kilogram of egg mass; lower is more efficient." values={[2.15, 2.12, 2.11, 2.14, 2.09, 2.1, 2.08]} color={GREEN} />
        <MetricCard label="Water consumption" value="218" unit="mL/hen/day" status="STABLE" detail="Daily drinking water normalised by the live flock count." values={[211, 215, 214, 220, 217, 219, 218]} />
        <MetricCard label="Water : feed" value="1.86" unit="L/kg" status="BALANCED" detail="Useful change signal when water rises or falls faster than feed." values={[1.82, 1.85, 1.83, 1.89, 1.87, 1.86, 1.86]} />
        <MetricCard label="Water pH" value="6.4" unit="pH" status="IN RANGE" detail="Latest line reading; persistent movement matters more than one sample." values={[6.5, 6.4, 6.5, 6.3, 6.4, 6.4, 6.4]} color={GREEN} />
      </div>

      <div style={{ marginTop: 10 }}><GutHealthCard /></div>
    </section>
  );
}
