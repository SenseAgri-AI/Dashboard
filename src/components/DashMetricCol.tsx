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

// Consistent palette: near-black values, navy bars, green/red only for direction.
const INK = "#002E35", NAVY = "#2B3F66", GREEN = "#16A34A", RED = "#DC2626", NEUTRAL = "#6B7C80";

const cardStyle: React.CSSProperties = {
  background: "#fff", border: "1px solid rgba(0,0,0,0.07)", borderRadius: 12,
  boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)",
  padding: "13px 15px", display: "flex", flexDirection: "column", gap: 6, minWidth: 0,
};

const fmtR = (v: number) => `R ${v.toLocaleString("en-ZA", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
const fmtDateFull = (d: string) => new Date(d).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const lastOf = (a: number[]): number | null => (a.length ? a[a.length - 1] : null);
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

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
// % change for a weekly sum: last-7 total vs prior-7 total.
function sumChange(vals: number[]): number | null {
  if (vals.length < 8) return null;
  const p = sum(vals.slice(-14, -7));
  return p === 0 ? null : ((sum(vals.slice(-7)) - p) / p) * 100;
}

// 7-day trend: an arrow + %, coloured by whether the move is good (green) or bad (red). Neutral grey
// when flat or unknown. The "7d" tag says what the % is measured over.
function Trend({ delta, goodUp }: { delta: number | null; goodUp: boolean }) {
  if (delta == null || !Number.isFinite(delta)) {
    return <span style={{ fontSize: 12, color: "var(--t4)", fontWeight: 700 }}>— <span style={{ fontSize: 9, letterSpacing: "0.05em" }}>7D</span></span>;
  }
  const up = delta > 0, flat = Math.abs(delta) < 0.05;
  const good = flat ? null : up === goodUp;
  const color = good == null ? NEUTRAL : good ? GREEN : RED;
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 5, whiteSpace: "nowrap" }}>
      <span style={{ fontSize: 12.5, fontWeight: 800, color }}>{flat ? "±" : up ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%</span>
      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", color: "var(--t4)" }}>7D</span>
    </span>
  );
}

// KPI tile: label, a big near-black value, and the 7-day % change. No sparkline — the trend is the number.
function KpiTile({ label, value, delta, goodUp }: {
  label: string; value: string | null; delta: number | null; goodUp: boolean;
}) {
  return (
    <div style={cardStyle}>
      <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--t3)" }}>{label}</span>
      <div style={{ fontFamily: "var(--font-d)", fontSize: 27, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1, color: value == null ? "var(--t4)" : INK }}>{value ?? "—"}</div>
      <Trend delta={delta} goodUp={goodUp} />
    </div>
  );
}

// Egg-size bars: last-7-day count per size (relative heights), each bar navy — green if that size is up
// vs the previous week, red if down. Slim bars.
function EggSizeBars({ bars }: { bars: { label: string; value: number; change: number | null }[] }) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  const barColor = (c: number | null) => (c == null || Math.abs(c) < 0.5 ? NAVY : c > 0 ? GREEN : RED);
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 58 }}>
      <div style={{ flex: 1, display: "flex", alignItems: "flex-end", gap: 12, paddingTop: 4 }}>
        {bars.map((b) => {
          const c = barColor(b.change);
          return (
            <div key={b.label} title={`${b.label}: ${b.value.toLocaleString()} eggs (last 7 days)${b.change != null ? ` · ${b.change > 0 ? "+" : ""}${b.change.toFixed(0)}% vs prev week` : ""}`}
              style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", gap: 3, minWidth: 0 }}>
              <span style={{ fontSize: 9, fontWeight: 800, lineHeight: 1, color: c, height: 10 }}>
                {b.change == null || Math.abs(b.change) < 0.5 ? "" : b.change > 0 ? "▲" : "▼"}
              </span>
              <div style={{ width: 9, height: `${(b.value / max) * 100}%`, minHeight: 3, background: c, borderRadius: 4 }} />
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 12, marginTop: 5 }}>
        {bars.map((b) => <div key={b.label} style={{ flex: 1, textAlign: "center", fontSize: 9.5, fontWeight: 800, color: "var(--t2)" }}>{b.label}</div>)}
      </div>
    </div>
  );
}

export function DashKpiGrid({ production, narrow }: { production: ProductionData | null; narrow?: boolean }) {
  const daily = production?.daily ?? [];
  const col = (k: keyof DailyEntry): number[] => daily.map((d) => d[k]).filter((v): v is number => typeof v === "number");

  const liveHens = col("liveHens"), hdep = col("hdep"), eggs = col("eggs"), weight = col("avgWeight"), damaged = col("damaged"), rev = col("revenue");
  const weeklyRev = sum(rev.slice(-7));

  // Per-size: last-7-day total + change vs the prior 7 days (drives the bar colour).
  const sizeBars = ([["S", "small"], ["M", "medium"], ["L", "large"], ["XL", "xl"], ["J", "jumbo"]] as [string, keyof DailyEntry][])
    .map(([label, key]) => {
      const s = col(key);
      const last7 = sum(s.slice(-7)), prior7 = sum(s.slice(-14, -7));
      return { label, value: last7, change: prior7 === 0 ? null : ((last7 - prior7) / prior7) * 100 };
    });

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
        <KpiTile label="Live hens" value={lastOf(liveHens)?.toLocaleString() ?? null} delta={stockChange(liveHens)} goodUp />
        <KpiTile label="Hen-day %" value={lastOf(hdep) != null ? `${lastOf(hdep)!.toFixed(1)}%` : null} delta={flowChange(hdep)} goodUp />
        <KpiTile label="Egg count" value={lastOf(eggs)?.toLocaleString() ?? null} delta={flowChange(eggs)} goodUp />
        <KpiTile label="Egg weight" value={lastOf(weight) != null ? `${lastOf(weight)!.toFixed(1)} g` : null} delta={flowChange(weight)} goodUp />

        <div style={span2}>
          <div style={{ ...cardStyle, height: "100%" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--t3)" }}>Egg sizes · last 7 days</span>
              <span style={{ fontSize: 9, fontWeight: 700, color: "var(--t4)" }}>
                <span style={{ color: GREEN }}>▲</span> up · <span style={{ color: RED }}>▼</span> down vs prev week
              </span>
            </div>
            <EggSizeBars bars={sizeBars} />
          </div>
        </div>

        <KpiTile label="Broken eggs" value={lastOf(damaged)?.toLocaleString() ?? null} delta={flowChange(damaged)} goodUp={false} />
        <KpiTile label="Daily revenue" value={lastOf(rev) != null ? fmtR(lastOf(rev)!) : null} delta={flowChange(rev)} goodUp />
        <KpiTile label="Weekly revenue" value={rev.length ? fmtR(weeklyRev) : null} delta={sumChange(rev)} goodUp />
      </div>
      {production && (
        <div style={{ fontSize: 10.5, color: "var(--t3)", marginTop: 8, textAlign: "right" }}>
          Production as of {fmtDate(production.date)} · change = last 7 logged days vs the 7 before
        </div>
      )}
    </div>
  );
}
