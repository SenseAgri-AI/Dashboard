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

const INK = "#002E35", TEAL = "#2A8E9A", NAVY = "#2B3F66", GREEN = "#16A34A", RED = "#DC2626", NEUTRAL = "#6B7C80";

const cardStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid rgba(0,0,0,0.07)",
  borderRadius: 12,
  boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)",
  padding: "13px 15px",
  display: "flex",
  flexDirection: "column",
  gap: 6,
  minWidth: 0,
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
const sumChange = (vals: number[]): number | null => {
  if (vals.length < 8) return null;
  const p = sum(vals.slice(-14, -7));
  return p === 0 ? null : ((sum(vals.slice(-7)) - p) / p) * 100;
};

function Trend({ delta, goodUp, compact = false }: { delta: number | null; goodUp: boolean; compact?: boolean }) {
  if (delta == null || !Number.isFinite(delta)) return <span style={{ fontSize: compact ? 9 : 11, color: "var(--t4)", fontWeight: 700 }}>—</span>;
  const up = delta > 0, flat = Math.abs(delta) < 0.05;
  const good = flat ? null : up === goodUp;
  const color = good == null ? NEUTRAL : good ? GREEN : RED;
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 4, whiteSpace: "nowrap" }}>
      <span style={{ fontSize: compact ? 9 : 11, fontWeight: 800, color }}>{flat ? "±" : up ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%</span>
      {!compact && <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: "0.05em", color: "var(--t4)" }}>7D</span>}
    </span>
  );
}

function MiniSpark({ values, compact = false }: { values: number[]; compact?: boolean }) {
  const points = values.filter(Number.isFinite).slice(-14);
  const width = compact ? 30 : 54, height = 23, pad = 2;
  if (points.length < 2) return <span style={{ width, height, display: "block" }} />;
  const low = Math.min(...points), high = Math.max(...points), span = Math.max(0.001, high - low);
  const x = (index: number) => pad + (index / (points.length - 1)) * (width - pad * 2);
  const y = (value: number) => pad + (1 - (value - low) / span) * (height - pad * 2);
  const path = points.map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(1)} ${y(point).toFixed(1)}`).join(" ");
  const area = `${path} L${x(points.length - 1).toFixed(1)} ${height - pad} L${x(0).toFixed(1)} ${height - pad} Z`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden style={{ display: "block", flexShrink: 1, minWidth: compact ? 20 : 40 }}>
      <path d={area} fill={NAVY} opacity="0.08" />
      <path d={path} fill="none" stroke={NAVY} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(points.length - 1)} cy={y(points[points.length - 1])} r="2" fill={TEAL} />
    </svg>
  );
}

function KpiTile({ label, value, delta, goodUp, values, compact = false }: {
  label: string; value: string | null; delta: number | null; goodUp: boolean; values: number[]; compact?: boolean;
}) {
  return (
    <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,0.07)", borderRadius: 12, boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)", padding: compact ? "11px 10px" : "13px 15px", display: "flex", flexDirection: "column", gap: 7, minWidth: 0 }}>
      <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--t3)" }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: compact ? 5 : 8, flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: "var(--font-d)", fontSize: compact ? 20 : 25, fontWeight: 800, letterSpacing: "-0.025em", lineHeight: 1, color: value == null ? "var(--t4)" : INK, whiteSpace: "nowrap", flexShrink: 0 }}>{value ?? "—"}</div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: compact ? 3 : 6, minWidth: 0 }}>
          <MiniSpark values={values} compact={compact} />
          <Trend delta={delta} goodUp={goodUp} compact={compact} />
        </div>
      </div>
    </div>
  );
}

const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `${n}`);

function EggSizeBars({ bars }: { bars: { label: string; last: number; prior: number }[] }) {
  const rows = bars.map((bar) => {
    const total = Math.max(bar.last, bar.prior);
    const delta = bar.last - bar.prior;
    const pct = bar.prior === 0 ? null : (delta / bar.prior) * 100;
    return { label: bar.label, last: bar.last, total, delta, pct };
  });
  const max = Math.max(1, ...rows.map((row) => row.total));

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 60 }}>
      <div style={{ display: "flex", gap: 4 }}>
        {rows.map((row) => (
          <div key={row.label} style={{ flex: 1, textAlign: "center", fontSize: 9, fontWeight: 800, color: INK, fontVariantNumeric: "tabular-nums" }}>
            {compact(row.last)}
          </div>
        ))}
      </div>
      <div style={{ flex: 1, display: "flex", alignItems: "flex-end", gap: 4, minHeight: 32 }}>
        {rows.map((row) => {
          const capPct = row.total > 0 ? (Math.abs(row.delta) / row.total) * 100 : 0;
          const showCap = Math.abs(row.delta) > 0 && capPct >= 1;
          return (
            <div
              key={row.label}
              title={`${row.label}: ${row.last.toLocaleString()} eggs (last 7 days)${row.pct != null ? ` · ${row.pct > 0 ? "+" : ""}${row.pct.toFixed(0)}% vs prev week` : ""}`}
              style={{ flex: 1, display: "flex", alignItems: "flex-end", justifyContent: "center", height: "100%" }}
            >
              <div style={{ width: "82%", maxWidth: 22, height: `${Math.max(8, (row.total / max) * 100)}%`, display: "flex", flexDirection: "column", borderRadius: "4px 4px 0 0", overflow: "hidden" }}>
                {showCap && <div style={{ height: `${capPct}%`, background: row.delta > 0 ? GREEN : RED }} />}
                <div style={{ flex: 1, background: NAVY }} />
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 4, marginTop: 5 }}>
        {rows.map((row) => <div key={row.label} style={{ flex: 1, textAlign: "center", fontSize: 9.5, fontWeight: 800, color: "var(--t2)" }}>{row.label}</div>)}
      </div>
    </div>
  );
}

export function DashKpiGrid({ production, narrow }: { production: ProductionData | null; narrow?: boolean }) {
  const daily = production?.daily ?? [];
  const col = (k: keyof DailyEntry): number[] => daily.map((d) => d[k]).filter((v): v is number => typeof v === "number");

  const liveHens = col("liveHens"), hdep = col("hdep"), eggs = col("eggs"), weight = col("avgWeight"), damaged = col("damaged"), rev = col("revenue");
  const weeklyRev = rev.slice(-7).reduce((a, b) => a + b, 0);
  const weeklyRevSeries = rev.map((_, index) => sum(rev.slice(Math.max(0, index - 6), index + 1)));
  const sizeBars = ([
    ["S", "small"], ["M", "medium"], ["L", "large"], ["XL", "xl"], ["J", "jumbo"],
  ] as [string, keyof DailyEntry][]).map(([label, key]) => {
    const series = col(key);
    return { label, last: sum(series.slice(-7)), prior: sum(series.slice(-14, -7)) };
  });

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
        <KpiTile label="Live hens" value={lastOf(liveHens)?.toLocaleString() ?? null} delta={stockChange(liveHens)} goodUp values={liveHens} compact={narrow} />
        <KpiTile label="Hen-day %" value={lastOf(hdep) != null ? `${lastOf(hdep)!.toFixed(1)}%` : null} delta={flowChange(hdep)} goodUp values={hdep} compact={narrow} />
        <KpiTile label="Egg count" value={lastOf(eggs)?.toLocaleString() ?? null} delta={flowChange(eggs)} goodUp values={eggs} compact={narrow} />
        <KpiTile label="Egg weight" value={lastOf(weight) != null ? `${lastOf(weight)!.toFixed(1)} g` : null} delta={flowChange(weight)} goodUp values={weight} compact={narrow} />

        <div style={cardStyle}>
          <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--t3)" }}>
            Egg sizes <span style={{ color: "var(--t4)" }}>· 7d</span>
          </span>
          <EggSizeBars bars={sizeBars} />
        </div>

        <KpiTile label="Broken eggs" value={lastOf(damaged)?.toLocaleString() ?? null} delta={flowChange(damaged)} goodUp={false} values={damaged} compact={narrow} />
        <KpiTile label="Daily revenue" value={lastOf(rev) != null ? fmtR(lastOf(rev)!) : null} delta={flowChange(rev)} goodUp values={rev} compact={narrow} />
        <KpiTile label="Weekly revenue" value={rev.length ? fmtR(weeklyRev) : null} delta={sumChange(rev)} goodUp values={weeklyRevSeries} compact={narrow} />
      </div>
      {production && (
        <div style={{ fontSize: 10.5, color: "var(--t3)", marginTop: 8, textAlign: "right" }}>
          Production as of {fmtDate(production.date)} · change = last 7 logged days vs the 7 before
        </div>
      )}
    </div>
  );
}
