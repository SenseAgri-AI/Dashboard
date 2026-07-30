export type DailyEntry = {
  date: string; eggs: number; small: number; medium: number; large: number; xl: number; jumbo: number;
  damaged: number; mortality: number; liveHens: number; avgWeight: number | null; revenue: number;
  hdep: number | null; feedPulses: number | null; fcr: number | null;
};

export interface ProductionData {
  date: string;
  eggs: { total: number; small: number; medium: number; large: number; xl: number; jumbo: number; damaged: number };
  revenue: number;
  hdep: number | null;
  mortality: { today: number; cumulative: number; rate: number | null };
  totalHens: number;
  daily: DailyEntry[];
}

const INK = "#002E35", TEAL = "#2A8E9A", GOLD = "#7A5C00", GREEN = "#16A34A", RED = "#DC2626";
const SIZE_RAMP = ["#BFE0E4", "#8CC7CE", "#57ABB4", "#2A8E9A", "#1B6B74"]; // S→J, one hue light→dark

const fmtR = (v: number) => `R ${v.toLocaleString("en-ZA", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
const fmtDateFull = (d: string) => new Date(d).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const lastOf = (a: number[]): number | null => (a.length ? a[a.length - 1] : null);

// % change: mean(last 7) vs mean(prior 7) for flows.
function flowChange(vals: number[]): number | null {
  if (vals.length < 4) return null;
  const last7 = vals.slice(-7), prior7 = vals.slice(-14, -7);
  if (!last7.length || !prior7.length) return null;
  const p = mean(prior7);
  return p === 0 ? null : ((mean(last7) - p) / p) * 100;
}
// % change for a stock (live hens): latest vs ~7 days prior.
function stockChange(vals: number[]): number | null {
  if (vals.length < 2) return null;
  const latest = vals[vals.length - 1], prior = vals[Math.max(0, vals.length - 8)];
  return prior === 0 ? null : ((latest - prior) / prior) * 100;
}
const sumChange = (vals: number[]): number | null => {
  if (vals.length < 8) return null;
  const p = vals.slice(-14, -7).reduce((x, y) => x + y, 0);
  return p === 0 ? null : ((vals.slice(-7).reduce((x, y) => x + y, 0) - p) / p) * 100;
};

// Bare inline-SVG sparkline (last N values), scales to tile width.
function MiniSpark({ values, color, height = 34 }: { values: number[]; color: string; height?: number }) {
  const vals = values.filter((v) => Number.isFinite(v)).slice(-14);
  if (vals.length < 2) return <div style={{ height }} />;
  const min = Math.min(...vals), max = Math.max(...vals), range = max - min || 1;
  const W = 100, step = W / (vals.length - 1), pad = 3;
  const y = (v: number) => (height - pad - ((v - min) / range) * (height - 2 * pad)).toFixed(1);
  const pts = vals.map((v, i) => `${(i * step).toFixed(1)},${y(v)}`);
  const lastX = ((vals.length - 1) * step).toFixed(1);
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" style={{ display: "block", overflow: "visible" }}>
      <path d={`M 0,${height} L ${pts.join(" L ")} L ${W},${height} Z`} fill={color} fillOpacity={0.1} />
      <path d={`M ${pts.join(" L ")}`} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={lastX} cy={y(vals[vals.length - 1])} r={2.2} fill={color} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function DeltaPill({ delta, goodUp }: { delta: number | null; goodUp: boolean }) {
  if (delta == null || !Number.isFinite(delta)) return null;
  const up = delta > 0, flat = Math.abs(delta) < 0.05;
  const good = flat ? null : up === goodUp;
  const color = good == null ? "#6B7C80" : good ? GREEN : RED;
  const bg = good == null ? "rgba(107,124,128,0.1)" : good ? "rgba(22,163,74,0.1)" : "rgba(220,38,38,0.1)";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: 11, fontWeight: 800, color, background: bg, padding: "1px 7px", borderRadius: 20, whiteSpace: "nowrap" }}>
      {flat ? "▬" : up ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%
    </span>
  );
}

function KpiTile({ label, value, accent, delta, goodUp, sparkValues, sparkColor, extra }: {
  label: string; value: string | null; accent: string; delta: number | null; goodUp: boolean;
  sparkValues: number[]; sparkColor: string; extra?: React.ReactNode;
}) {
  return (
    <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,0.07)", borderRadius: 12, boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)", padding: "13px 15px", display: "flex", flexDirection: "column", gap: 7, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--t3)" }}>{label}</span>
        <DeltaPill delta={delta} goodUp={goodUp} />
      </div>
      <div style={{ fontFamily: "var(--font-d)", fontSize: 27, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1, color: value == null ? "var(--t4)" : accent }}>{value ?? "—"}</div>
      {extra ?? <MiniSpark values={sparkValues} color={sparkColor} />}
    </div>
  );
}

function EggSizeHistogram({ sizes }: { sizes: { label: string; value: number }[] }) {
  const max = Math.max(1, ...sizes.map((s) => s.value));
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 58 }}>
      <div style={{ flex: 1, display: "flex", alignItems: "flex-end", gap: 7 }}>
        {sizes.map((s, i) => (
          <div key={s.label} title={`${s.label}: ${s.value.toLocaleString()}`} style={{ flex: 1, height: `${(s.value / max) * 100}%`, minHeight: 3, background: SIZE_RAMP[i], borderRadius: "3px 3px 0 0" }} />
        ))}
      </div>
      <div style={{ display: "flex", gap: 7, marginTop: 5 }}>
        {sizes.map((s) => <div key={s.label} style={{ flex: 1, textAlign: "center", fontSize: 9.5, fontWeight: 800, color: "var(--t2)" }}>{s.label}</div>)}
      </div>
    </div>
  );
}

export function DashKpiGrid({ production, narrow }: { production: ProductionData | null; narrow?: boolean }) {
  const daily = production?.daily ?? [];
  const col = (k: keyof DailyEntry): number[] => daily.map((d) => d[k]).filter((v): v is number => typeof v === "number");

  const liveHens = col("liveHens"), hdep = col("hdep"), eggs = col("eggs"), weight = col("avgWeight"), damaged = col("damaged"), rev = col("revenue");
  const weeklyRev = rev.slice(-7).reduce((a, b) => a + b, 0);
  const e = production?.eggs;
  const sizes = e ? [
    { label: "S", value: e.small }, { label: "M", value: e.medium }, { label: "L", value: e.large },
    { label: "XL", value: e.xl }, { label: "J", value: e.jumbo },
  ] : [];

  const span2: React.CSSProperties = { gridColumn: "span 2" };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <span style={{ fontFamily: "var(--font-d)", fontWeight: 800, fontSize: 15, color: "var(--primary)" }}>Production</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 11, color: "var(--t3)", fontWeight: 600 }}>
          latest data
          <span style={{ background: "var(--card-alt)", border: "1px solid var(--divider)", borderRadius: 6, padding: "2px 9px", color: "var(--primary)", fontWeight: 800, fontSize: 12 }}>
            {production ? fmtDateFull(production.date) : "—"}
          </span>
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: narrow ? "repeat(2, minmax(0,1fr))" : "repeat(4, minmax(0,1fr))", gap: 10, alignItems: "stretch" }}>
        <KpiTile label="Live hens" value={lastOf(liveHens)?.toLocaleString() ?? null} accent={INK} delta={stockChange(liveHens)} goodUp sparkValues={liveHens} sparkColor={TEAL} />
        <KpiTile label="Hen-day %" value={lastOf(hdep) != null ? `${lastOf(hdep)!.toFixed(1)}%` : null} accent={INK} delta={flowChange(hdep)} goodUp sparkValues={hdep} sparkColor={TEAL} />
        <KpiTile label="Egg count" value={lastOf(eggs)?.toLocaleString() ?? null} accent={INK} delta={flowChange(eggs)} goodUp sparkValues={eggs} sparkColor={TEAL} />
        <KpiTile label="Egg weight" value={lastOf(weight) != null ? `${lastOf(weight)!.toFixed(1)} g` : null} accent={TEAL} delta={flowChange(weight)} goodUp sparkValues={weight} sparkColor={TEAL} />

        <div style={span2}>
          <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,0.07)", borderRadius: 12, boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)", padding: "13px 15px", height: "100%", display: "flex", flexDirection: "column", gap: 7, minWidth: 0 }}>
            <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--t3)" }}>Egg sizes {production ? `· ${fmtDate(production.date)}` : ""}</span>
            <EggSizeHistogram sizes={sizes} />
          </div>
        </div>

        <KpiTile label="Broken eggs" value={lastOf(damaged)?.toLocaleString() ?? null} accent={RED} delta={flowChange(damaged)} goodUp={false} sparkValues={damaged} sparkColor={RED} />
        <KpiTile label="Daily revenue" value={lastOf(rev) != null ? fmtR(lastOf(rev)!) : null} accent={GOLD} delta={flowChange(rev)} goodUp sparkValues={rev} sparkColor={GOLD} />
        <KpiTile label="Weekly revenue" value={rev.length ? fmtR(weeklyRev) : null} accent={GOLD} delta={sumChange(rev)} goodUp sparkValues={rev} sparkColor={GOLD} />
      </div>
      {production && (
        <div style={{ fontSize: 10.5, color: "var(--t3)", marginTop: 8, textAlign: "right" }}>
          Production as of {fmtDate(production.date)} · change = last 7 logged days vs the 7 before
        </div>
      )}
    </div>
  );
}
