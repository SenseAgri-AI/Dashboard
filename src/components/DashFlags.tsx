type FlagSeverity = "info" | "warning" | "danger";
type FlagCategory = "respiratory" | "gut" | "mites" | "heat" | "welfare";

type Flag = {
  id: string;
  category: FlagCategory;
  title: string;
  severity: FlagSeverity;
  confidence: number;
  evidence: string[];
  prescription: string[];
  since: string;
  ph?: { value: number; low: number; high: number };
};

const INK = "#002E35";
const TEAL = "#2A8E9A";
const NAVY = "#2B3F66";
const RED = "#DC2626";
const AMBER = "#D97706";
const NEUTRAL = "#6B7C80";

// Deliberately local, removable demo data. These examples show the intended
// evidence + action experience before the cross-signal detection pipeline ships.
const DEMO_FLAGS: Flag[] = [
  {
    id: "demo-respiratory",
    category: "respiratory",
    title: "Possible respiratory issue",
    severity: "warning",
    confidence: 78,
    since: "Seen across 2 days",
    evidence: [
      "The 3 Sep log note says “a few birds sneezing near the east drinker line.”",
      "Night flock-noise activity has risen across two consecutive nights.",
      "Feed intake is 4.2% below the preceding 7-day baseline.",
    ],
    prescription: [
      "Listen for sneezing, coughing or rattling breathing.",
      "Check nostrils for discharge and eyes for watering or swelling.",
      "Compare feed and water intake by house.",
      "Escalate to the flock veterinarian if signs persist or spread.",
    ],
  },
  {
    id: "demo-gut",
    category: "gut",
    title: "Gut health — watch",
    severity: "warning",
    confidence: 71,
    since: "Changed this morning",
    ph: { value: 6.2, low: 6.5, high: 7.0 },
    evidence: [
      "Water-line pH is 6.2, below this farm’s 6.5–7.0 operating band.",
      "Water:feed ratio rose from 1.86 to 2.04 L/kg over 48 hours.",
      "The 3 Sep log note mentions “wetter droppings in House 1.”",
    ],
    prescription: [
      "Inspect droppings for excess water, foam or undigested feed.",
      "Check drinker pressure, leaks and litter beneath the lines.",
      "Retest pH at the tank and at the end of the line.",
      "Review the latest feed batch and any recent water treatment.",
    ],
  },
  {
    id: "demo-mites",
    category: "mites",
    title: "Red mite suspected",
    severity: "info",
    confidence: 63,
    since: "Pattern seen last night",
    evidence: [
      "Whole-night restlessness is above the flock’s recent quiet-night baseline.",
      "Night-rest score has eased for two nights without a matching heat event.",
      "The 2 Sep log note mentions “more head shaking after lights-out.”",
    ],
    prescription: [
      "Inspect cracks and beneath perches after dark for red or grey mites.",
      "Look for head shaking, pale combs and birds avoiding nest areas.",
      "Check eggs and housing surfaces for small blood spots.",
      "Record the affected house and contact the flock veterinarian before treatment.",
    ],
  },
];

const styleFor = (severity: FlagSeverity) => severity === "danger"
  ? { color: RED, background: "#FEF2F2", label: "High priority" }
  : severity === "warning"
    ? { color: AMBER, background: "#FFFBEB", label: "Investigate" }
    : { color: NAVY, background: "#F1F5F9", label: "Monitor" };

const categoryLabel: Record<FlagCategory, string> = {
  respiratory: "Respiratory",
  gut: "Gut health",
  mites: "Parasites",
  heat: "Heat",
  welfare: "Welfare",
};

function FlagIcon({ category }: { category: FlagCategory }) {
  if (category === "respiratory") {
    return (
      <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 3v9" /><path d="M12 9c-2-2-4-4-5-4-2 0-3 4-3 8 0 5 2 8 5 8 2 0 3-2 3-5" /><path d="M12 9c2-2 4-4 5-4 2 0 3 4 3 8 0 5-2 8-5 8-2 0-3-2-3-5" />
      </svg>
    );
  }
  if (category === "gut") {
    return (
      <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M8 3v5a3 3 0 0 0 3 3h2a3 3 0 0 1 3 3v1a4 4 0 0 1-4 4H9a5 5 0 0 1-5-5V9" /><path d="M16 3v4" /><path d="M12 15h.01" />
      </svg>
    );
  }
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.9 4.9 7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1" />
    </svg>
  );
}

function PhRange({ ph }: { ph: NonNullable<Flag["ph"]> }) {
  const scaleMin = 5.5;
  const scaleMax = 7.5;
  const at = (value: number) => `${Math.max(0, Math.min(100, ((value - scaleMin) / (scaleMax - scaleMin)) * 100))}%`;
  return (
    <div style={{ padding: "9px 10px 8px", background: "#F6F9F9", border: "1px solid var(--divider)", marginTop: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--t3)" }}>Water-line pH</span>
        <strong style={{ fontFamily: "var(--font-d)", fontSize: 15, color: AMBER }}>{ph.value.toFixed(1)}</strong>
      </div>
      <div style={{ height: 7, background: "#E1E8E9", position: "relative", marginTop: 8 }}>
        <span style={{ position: "absolute", left: at(ph.low), right: `calc(100% - ${at(ph.high)})`, top: 0, bottom: 0, background: "#86D4B0" }} />
        <span style={{ position: "absolute", left: at(ph.value), top: -3, width: 3, height: 13, background: AMBER, transform: "translateX(-1px)" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8.5, color: "var(--t3)", marginTop: 5 }}>
        <span>{scaleMin.toFixed(1)}</span><span style={{ color: "#16845A", fontWeight: 700 }}>Operating band {ph.low.toFixed(1)}–{ph.high.toFixed(1)}</span><span>{scaleMax.toFixed(1)}</span>
      </div>
    </div>
  );
}

function EvidenceList({ items }: { items: string[] }) {
  return (
    <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 7, marginTop: 8 }}>
      {items.map((item) => (
        <li key={item} style={{ display: "grid", gridTemplateColumns: "8px minmax(0, 1fr)", gap: 7, fontSize: 10.5, lineHeight: 1.45, color: "var(--t2)" }}>
          <span style={{ width: 5, height: 5, background: TEAL, borderRadius: "50%", marginTop: 5 }} />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function PrescriptionList({ items }: { items: string[] }) {
  return (
    <ol style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 7, marginTop: 8 }}>
      {items.map((item, index) => (
        <li key={item} style={{ display: "grid", gridTemplateColumns: "18px minmax(0, 1fr)", gap: 7, fontSize: 10.5, lineHeight: 1.4, color: "var(--t2)" }}>
          <span style={{ width: 17, height: 17, border: "1px solid #B8C6C8", color: NEUTRAL, display: "grid", placeItems: "center", fontSize: 8, fontWeight: 800 }}>{index + 1}</span>
          <span>{item}</span>
        </li>
      ))}
    </ol>
  );
}

function FlagCard({ flag }: { flag: Flag }) {
  const severity = styleFor(flag.severity);
  return (
    <article style={{ background: "#fff", border: "1px solid rgba(0,0,0,0.07)", borderTop: `3px solid ${severity.color}`, borderRadius: 12, boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)", padding: "13px 14px", display: "flex", flexDirection: "column", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <span style={{ width: 38, height: 38, display: "grid", placeItems: "center", color: severity.color, background: severity.background, border: `1px solid ${severity.color}25`, flexShrink: 0 }}><FlagIcon category={flag.category} /></span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--t3)" }}>{categoryLabel[flag.category]}</div>
          <h3 style={{ fontFamily: "var(--font-d)", fontSize: 17, lineHeight: 1.2, fontWeight: 800, color: INK, marginTop: 3 }}>{flag.title}</h3>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", marginTop: 11 }}>
        <span style={{ fontSize: 9, fontWeight: 800, color: severity.color, background: severity.background, border: `1px solid ${severity.color}30`, padding: "3px 7px" }}>{severity.label.toUpperCase()}</span>
        <span style={{ fontSize: 9.5, fontWeight: 700, color: "var(--t2)" }}>{flag.confidence}% confidence</span>
        <span style={{ color: "var(--t4)" }}>·</span>
        <span style={{ fontSize: 9.5, color: "var(--t3)" }}>{flag.since}</span>
      </div>

      {flag.ph && <PhRange ph={flag.ph} />}

      <div style={{ marginTop: 13 }}>
        <div style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.09em", color: "var(--t3)" }}>Why it was flagged</div>
        <EvidenceList items={flag.evidence} />
      </div>

      <div style={{ borderTop: "1px solid var(--divider)", marginTop: 13, paddingTop: 12, flex: 1 }}>
        <div style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.09em", color: INK }}>What to inspect now</div>
        <PrescriptionList items={flag.prescription} />
      </div>
    </article>
  );
}

export default function DashFlags() {
  return (
    <section aria-label="Flags and inspection guidance">
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontFamily: "var(--font-d)", fontWeight: 800, fontSize: 15, color: "var(--primary)" }}>Flags & prescriptions</span>
            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", color: AMBER, background: "#FFFBEB", border: "1px solid #FDE68A", padding: "3px 7px" }}>DEMO · SAMPLE SIGNALS</span>
          </div>
          <p style={{ fontSize: 10, color: "var(--t3)", marginTop: 4 }}>Multiple farm signals brought together into a focused inspection plan.</p>
        </div>
        <span style={{ fontSize: 9.5, color: "var(--t3)" }}>Screening support—not a diagnosis or medication recommendation.</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 290px), 1fr))", gap: 10, alignItems: "stretch" }}>
        {DEMO_FLAGS.map((flag) => <FlagCard key={flag.id} flag={flag} />)}
      </div>
    </section>
  );
}
