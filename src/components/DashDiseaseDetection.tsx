const INK = "#002E35";
const TEAL = "#2A8E9A";
const NAVY = "#2B3F66";
const GREEN = "#16A34A";
const AMBER = "#D97706";

const cardStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid rgba(0,0,0,0.07)",
  borderRadius: 12,
  boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)",
  minWidth: 0,
};

const SIGNALS = [
  {
    label: "Respiratory events",
    value: "2.7×",
    unit: "flock baseline",
    status: "Elevated",
    detail: "Rale and sneeze-like events have risen steadily.",
    bars: [18, 22, 21, 28, 43, 62, 78],
    color: AMBER,
  },
  {
    label: "Spectral entropy",
    value: "−18%",
    unit: "from normal",
    status: "Sustained shift",
    detail: "Calls are more repetitive and less acoustically diverse.",
    bars: [78, 74, 76, 70, 61, 57, 55],
    color: AMBER,
  },
  {
    label: "Vocal profile",
    value: "2.3σ",
    unit: "outside normal",
    status: "Changed",
    detail: "Frequency structure differs after age and time correction.",
    bars: [20, 25, 18, 27, 39, 58, 71],
    color: NAVY,
  },
  {
    label: "Feed & water pattern",
    value: "Diverging",
    unit: "from baseline",
    status: "Corroborating",
    detail: "Feed is down 4.2% while drinking is up 9.6%.",
    bars: [28, 31, 29, 34, 43, 57, 69],
    color: TEAL,
  },
];

const CONTEXT = [
  { label: "Egg production", value: "−2.1%", tone: AMBER },
  { label: "House THI", value: "Comfortable", tone: GREEN },
  { label: "CO₂", value: "Normal", tone: GREEN },
  { label: "Log note", value: "Sneezing mentioned", tone: TEAL },
];

const PIPELINE = [
  { title: "Observe", detail: "Audio, intake & climate" },
  { title: "Clean & align", detail: "Filter noise, match time" },
  { title: "Learn normal", detail: "Age, time & light" },
  { title: "Analyse & detect", detail: "Poultry models find sustained change" },
  { title: "Corroborate", detail: "Production & log notes" },
  { title: "Guide action", detail: "Inspection flag" },
];

function SoundShield() {
  return (
    <svg width="31" height="31" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3 5 6v5c0 4.6 2.8 8 7 10 4.2-2 7-5.4 7-10V6l-7-3Z" />
      <path d="M9 11h.01M12 9v4M15 7v8" />
    </svg>
  );
}

function MiniBars({ values, color }: { values: number[]; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 34, marginTop: 11 }} aria-hidden>
      {values.map((value, index) => (
        <span key={index} style={{ flex: 1, height: `${value}%`, minHeight: 4, background: color, opacity: 0.22 + index * 0.1 }} />
      ))}
    </div>
  );
}

function SignalCard({ signal }: { signal: (typeof SIGNALS)[number] }) {
  return (
    <div style={{ background: "#F7F9F9", border: "1px solid var(--divider)", padding: "11px 12px", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--t3)" }}>{signal.label}</span>
        <span style={{ fontSize: 8.5, fontWeight: 800, color: signal.color, whiteSpace: "nowrap" }}>{signal.status.toUpperCase()}</span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 5, marginTop: 8, flexWrap: "wrap" }}>
        <strong style={{ fontFamily: "var(--font-d)", fontSize: 25, lineHeight: 1, letterSpacing: "-0.03em", color: INK }}>{signal.value}</strong>
        <span style={{ fontSize: 9.5, fontWeight: 700, color: "var(--t3)" }}>{signal.unit}</span>
      </div>
      <p style={{ fontSize: 9.5, color: "var(--t3)", lineHeight: 1.4, marginTop: 6, minHeight: 27 }}>{signal.detail}</p>
      <MiniBars values={signal.bars} color={signal.color} />
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8, color: "var(--t4)", marginTop: 4 }}><span>7 days ago</span><span>today</span></div>
    </div>
  );
}

function ModelOutput() {
  return (
    <div style={{ background: "linear-gradient(145deg, #003E48 0%, #002E35 66%, #00242A 100%)", color: "#fff", padding: "16px", display: "flex", flexDirection: "column", minWidth: 0 }}>
      <div style={{ width: 48, height: 48, display: "grid", placeItems: "center", color: "#A7E6E4", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.13)" }}><SoundShield /></div>
      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(255,255,255,0.55)" }}>Current model output</div>
        <h3 style={{ fontFamily: "var(--font-d)", fontSize: 22, lineHeight: 1.15, letterSpacing: "-0.025em", marginTop: 6 }}>Respiratory pattern shift</h3>
        <span style={{ display: "inline-block", marginTop: 9, padding: "4px 8px", border: "1px solid rgba(251,191,36,0.48)", background: "rgba(217,119,6,0.18)", color: "#FCD34D", fontSize: 9, fontWeight: 800, letterSpacing: "0.08em" }}>INVESTIGATE</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 18 }}>
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.13)", paddingTop: 9 }}>
          <strong style={{ display: "block", fontFamily: "var(--font-d)", fontSize: 22 }}>78%</strong>
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.55)" }}>signal confidence</span>
        </div>
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.13)", paddingTop: 9 }}>
          <strong style={{ display: "block", fontFamily: "var(--font-d)", fontSize: 22 }}>2 days</strong>
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.55)" }}>pattern persisted</span>
        </div>
      </div>

      <p style={{ fontSize: 10.5, lineHeight: 1.5, color: "rgba(255,255,255,0.7)", marginTop: "auto", paddingTop: 18 }}>
        A sustained pattern across multiple farm data sources—not a disease diagnosis. Inspect the birds and use veterinary confirmation.
      </p>
    </div>
  );
}

function ContextStrip() {
  return (
    <div style={{ borderTop: "1px solid var(--divider)", padding: "12px 15px 13px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--t3)", marginRight: 3 }}>Corroborating context</span>
        {CONTEXT.map((item) => (
          <span key={item.label} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 7px", background: `${item.tone}0D`, border: `1px solid ${item.tone}28`, fontSize: 9.5, color: "var(--t2)" }}>
            <span style={{ width: 5, height: 5, background: item.tone, borderRadius: "50%" }} />
            {item.label} <strong style={{ color: item.tone }}>{item.value}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

function Pipeline() {
  return (
    <div style={{ background: "#F3F7F7", borderTop: "1px solid var(--divider)", padding: "12px 15px 14px" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.09em", color: INK }}>How the analytical model works</span>
        <span style={{ fontSize: 8.5, fontWeight: 700, color: TEAL }}>FLOCK-SPECIFIC · BASELINE-DRIVEN · EXPLAINABLE</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(125px, 1fr))", marginTop: 10, border: "1px solid rgba(0,46,53,0.09)" }}>
        {PIPELINE.map((step, index) => (
          <div key={step.title} style={{ padding: "9px 10px", minWidth: 0, background: index % 2 ? "#fff" : "rgba(255,255,255,0.56)", borderLeft: index ? "1px solid var(--divider)" : "none" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 18, height: 18, display: "grid", placeItems: "center", background: index === PIPELINE.length - 1 ? TEAL : INK, color: "#fff", fontSize: 8, fontWeight: 800, flexShrink: 0 }}>{index + 1}</span>
              <strong style={{ fontSize: 10, color: INK }}>{step.title}</strong>
            </div>
            <div style={{ fontSize: 8.5, color: "var(--t3)", marginTop: 4, paddingLeft: 24 }}>{step.detail}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DashDiseaseDetection({ narrow = false }: { narrow?: boolean }) {
  return (
    <section aria-label="Early disease detection concept">
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontFamily: "var(--font-d)", fontWeight: 800, fontSize: 15, color: "var(--primary)" }}>Early disease detection</span>
            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", color: AMBER, background: "#FFFBEB", border: "1px solid #FDE68A", padding: "3px 7px" }}>CONCEPT · SAMPLE SIGNALS</span>
          </div>
          <p style={{ fontSize: 10, color: "var(--t3)", marginTop: 4 }}>An explainable multimodal early-warning model combining audio, intake, climate, production and farmer observations.</p>
        </div>
        <span style={{ fontSize: 9.5, color: "var(--t3)" }}>Early warning only · veterinary confirmation required</span>
      </div>

      <div style={{ ...cardStyle, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "280px minmax(0, 1fr)" }}>
          <ModelOutput />
          <div style={{ padding: "14px 15px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
              <div>
                <div style={{ fontFamily: "var(--font-d)", fontSize: 14, fontWeight: 800, color: INK }}>Why the pattern was raised</div>
                <div style={{ fontSize: 9.5, color: "var(--t3)", marginTop: 2 }}>Changes moved together across sound, feeding, drinking and farm records.</div>
              </div>
              <span style={{ fontSize: 8.5, color: "var(--t3)", fontWeight: 700 }}>Compared with this flock’s rolling healthy baseline</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 165px), 1fr))", gap: 8, marginTop: 11 }}>
              {SIGNALS.map((signal) => <SignalCard key={signal.label} signal={signal} />)}
            </div>
          </div>
        </div>
        <ContextStrip />
        <Pipeline />
      </div>
    </section>
  );
}
