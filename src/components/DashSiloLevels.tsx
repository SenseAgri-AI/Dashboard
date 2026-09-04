const INK = "#002E35";
const TEAL = "#2A8E9A";
const NAVY = "#2B3F66";
const RED = "#DC2626";
const AMBER = "#D97706";

export interface SiloLevel {
  deviceId: string;
  distanceMm: number;
  fillPercent: number;
  battery: number | null;
  signalRssi: number | null;
  updatedAt: string;
}

export interface SiloLevelsData {
  silos: SiloLevel[];
  calibration: { fullDistanceMm: number; emptyDistanceMm: number };
  updatedAt: string | null;
}

const cardStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid rgba(0,0,0,0.07)",
  borderRadius: 12,
  boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)",
  padding: "14px 15px",
  minWidth: 0,
};

function formatSast(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date).replace(",", "") + " SAST";
}

function statusFor(fill: number) {
  if (fill < 15) return { label: "Refill soon", color: RED, background: "#FEF2F2" };
  if (fill <= 30) return { label: "Running low", color: AMBER, background: "#FFFBEB" };
  return { label: "Feed available", color: TEAL, background: "#EFF8F8" };
}

function RadarIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 12h.01" />
      <path d="M8.5 8.5a5 5 0 0 0 0 7" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M5.7 5.7a9 9 0 0 0 0 12.6" />
      <path d="M18.3 5.7a9 9 0 0 1 0 12.6" />
    </svg>
  );
}

function SiloGauge({ silo, index, narrow }: { silo: SiloLevel; index: number; narrow: boolean }) {
  const pct = Math.max(0, Math.min(100, silo.fillPercent));
  // 100% means all usable capacity is occupied, while the vessel illustration
  // retains its designed head space above that capacity. Lower levels remain
  // visually proportional to their calculated fill.
  const visualFillPercent = Math.min(80, pct);
  const surfaceY = 224 - visualFillPercent * 1.82;
  const clipId = `silo-vessel-${index}`;
  const gradientId = `silo-feed-${index}`;
  const status = statusFor(pct);

  return (
    <article style={{ ...cardStyle, display: "flex", flexDirection: "column", alignItems: "stretch", minHeight: narrow ? 420 : 340 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <div style={{ fontFamily: "var(--font-d)", fontSize: 18, fontWeight: 800, color: INK }}>Feed Silo {index + 1}</div>
          <div style={{ fontSize: 9.5, color: "var(--t3)", marginTop: 2 }}>Radar {silo.deviceId}</div>
        </div>
        <span style={{ flexShrink: 0, fontSize: 9, fontWeight: 800, color: status.color, background: status.background, border: `1px solid ${status.color}35`, padding: "4px 8px", borderRadius: 20 }}>{status.label.toUpperCase()}</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: narrow ? "minmax(0, 1fr)" : "minmax(0, 1fr) 105px", alignItems: "center", gap: 8, flex: 1, marginTop: 4 }}>
        <svg viewBox="0 0 300 270" role="img" aria-label={`Feed Silo ${index + 1} is ${pct}% full`} style={{ width: "100%", height: narrow ? 230 : 250, overflow: "visible" }}>
          <defs>
            <clipPath id={clipId}>
              <path d="M58 42 Q140 15 222 42 L222 166 L166 236 H114 L58 166 Z" />
            </clipPath>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={pct < 15 ? RED : "#43C3BE"} />
              <stop offset="1" stopColor={pct < 15 ? "#991B1B" : "#08717A"} />
            </linearGradient>
          </defs>

          <ellipse cx="140" cy="249" rx="84" ry="10" fill="#DDE5E6" />
          <path d="M58 42 Q140 15 222 42 L222 166 L166 236 H114 L58 166 Z" fill="#E8F0F3" fillOpacity="0.65" stroke="#7594A6" strokeWidth="2.5" />
          <g clipPath={`url(#${clipId})`}>
            <rect x="55" y={surfaceY} width="170" height={240 - surfaceY} fill={`url(#${gradientId})`} />
            <ellipse cx="140" cy={surfaceY} rx="82" ry="12" fill={pct < 15 ? "#F87171" : "#78DCD5"} fillOpacity="0.82" stroke="#D7FFFF" strokeWidth="1.5" />
            <path d="M78 35V203" stroke="#fff" strokeOpacity="0.28" strokeWidth="16" />
            <path d="M203 35V203" stroke="#0A5360" strokeOpacity="0.12" strokeWidth="10" />
          </g>
          <ellipse cx="140" cy="42" rx="82" ry="22" fill="#8EA8B8" stroke="#57798C" strokeWidth="1.5" />
          <rect x="127" y="22" width="26" height="22" rx="4" fill="#7896A8" stroke="#57798C" />
          <circle cx="140" cy="33" r="4" fill="#08717A" />
          <path d="M133 40q7-7 14 0" fill="none" stroke="#08717A" strokeWidth="1.5" />

          <path d={`M240 42h10M245 42V${surfaceY}M240 ${surfaceY}h10`} fill="none" stroke="#08717A" strokeWidth="1.5" strokeDasharray="4 3" />
          <rect x="253" y={(42 + surfaceY) / 2 - 18} width="44" height="36" rx="6" fill="#F0FAFA" stroke="#2A8E9A" />
          <text x="275" y={(42 + surfaceY) / 2 - 2} textAnchor="middle" fill="#08717A" fontSize="11" fontWeight="800">{silo.distanceMm}</text>
          <text x="275" y={(42 + surfaceY) / 2 + 11} textAnchor="middle" fill="#397D84" fontSize="8" fontWeight="700">mm</text>
        </svg>

        <div style={{ minWidth: 0, display: narrow ? "grid" : "block", gridTemplateColumns: narrow ? "1.25fr 1fr 0.8fr" : undefined, gap: narrow ? 10 : undefined, alignItems: "end" }}>
          <div>
            <div style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--t3)" }}>Estimated fill</div>
            <div style={{ fontFamily: "var(--font-d)", fontSize: narrow ? 30 : 38, fontWeight: 800, letterSpacing: "-0.04em", color: pct < 15 ? RED : INK, lineHeight: 1.05, marginTop: 4 }}>{pct}%</div>
            <div style={{ width: "100%", maxWidth: 120, height: 6, background: "#E2E9EA", marginTop: 10, overflow: "hidden", borderRadius: 10 }}>
              <div style={{ width: `${pct}%`, height: "100%", background: pct < 15 ? RED : `linear-gradient(90deg, ${NAVY}, ${TEAL})` }} />
            </div>
          </div>
          <div style={{ fontSize: 9.5, lineHeight: 1.5, color: "var(--t3)", marginTop: narrow ? 0 : 13 }}>
            <div>Head space</div>
            <strong style={{ color: "var(--t2)", fontSize: 11 }}>{silo.distanceMm.toLocaleString("en-ZA")} mm</strong>
          </div>
          {silo.battery != null && <div style={{ fontSize: 9.5, color: "var(--t3)", marginTop: narrow ? 0 : 8 }}>Battery<br /><strong style={{ color: "var(--t2)" }}>{silo.battery}%</strong></div>}
        </div>
      </div>

      <div style={{ borderTop: "1px solid var(--divider)", paddingTop: 9, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 9.5, color: "var(--t3)" }}>Updated {formatSast(silo.updatedAt)}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 9, fontWeight: 800, letterSpacing: "0.07em", color: TEAL }}><RadarIcon /> LIVE RADAR</span>
      </div>
    </article>
  );
}

export default function DashSiloLevels({ data, narrow = false }: { data: SiloLevelsData | null; narrow?: boolean }) {
  const silos = data?.silos ?? [];

  return (
    <section aria-label="Silo feed levels">
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <div>
          <span style={{ fontFamily: "var(--font-d)", fontWeight: 800, fontSize: 15, color: "var(--primary)" }}>Silo feed levels</span>
          <span style={{ fontSize: 10, color: "var(--t3)", marginLeft: 8 }}>EM411 radar level monitoring</span>
        </div>
        {silos.length > 0 && <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", color: "#08717A", background: "#EAF7F7", border: "1px solid #ABD8D8", padding: "4px 9px", borderRadius: 20 }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: "#08717A" }} /> LIVE</span>}
      </div>

      {silos.length > 0 ? (
        <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 14, alignItems: "stretch" }}>
          {silos.map((silo, index) => <SiloGauge key={silo.deviceId} silo={silo} index={index} narrow={narrow} />)}
        </div>
      ) : (
        <div style={{ ...cardStyle, minHeight: 128, display: "grid", placeItems: "center", textAlign: "center" }}>
          <div>
            <div style={{ color: "var(--t2)", fontSize: 12, fontWeight: 700 }}>No silo radar readings available</div>
            <div style={{ color: "var(--t3)", fontSize: 10.5, marginTop: 5 }}>Waiting for an EM411-RDL device to report.</div>
          </div>
        </div>
      )}

      {silos.length > 0 && data && (
        <div style={{ fontSize: 9.5, color: "var(--t3)", marginTop: 7, textAlign: "right" }}>
          Fill estimate calibrated from {data.calibration.fullDistanceMm.toLocaleString("en-ZA")} mm full to {data.calibration.emptyDistanceMm.toLocaleString("en-ZA")} mm empty.
        </div>
      )}
    </section>
  );
}
