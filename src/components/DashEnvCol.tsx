"use client";

import { AreaChart, ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip } from "recharts";

// Environment sensor tiles (2 per row): a compact trend chart with the NORMAL band shaded (so
// too-low / too-high is obvious), a threshold line where relevant, time on the x-axis and the
// working min/max on the y-axis. Fine + coarse dust share one plot; light level added.

export interface EnvData {
  temperature: { current: number | null; status: string; sparkline: SparklinePoint[] };
  humidity:    { current: number | null; status: string; sparkline: SparklinePoint[] };
  co2:         { current: number | null; status: string; sparkline: SparklinePoint[] };
  tvoc:        { current: number | null; sparkline: SparklinePoint[]; mean: number; std: number };
  pm2_5?:      { current: number | null; sparkline: SparklinePoint[] };
  pm10?:       { current: number | null; sparkline: SparklinePoint[] };
  light?:      { current: number | null; sparkline: SparklinePoint[] };
  water:       { current: number | null; today: number | null; sparkline: SparklinePoint[]; mean: number; std: number };
}
export interface SparklinePoint { time: string; value: number; cumulative?: number; lo?: number | null; hi?: number | null; }

const TEAL = "#2A8E9A", GOLD = "#B8860B", GREEN = "#16A34A", AMBER = "#D97706", RED = "#B91C1C", NEUTRAL = "#6B7C80", AXIS = "#5a6a6c";

function statusInfo(status?: string): { color: string; word: string } {
  if (status === "danger") return { color: RED, word: "Out of range" };
  if (status === "warning") return { color: AMBER, word: "Watch" };
  if (status === "good" || status === "normal" || status === "ok") return { color: GREEN, word: "In range" };
  return { color: NEUTRAL, word: "" };
}

const fmtTime = (ts: string) => new Date(ts).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false });
const yFmt = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v * 10) / 10}`);

function ChartTip({ active, payload, label, unit }: { active?: boolean; payload?: { value: number; name?: string; color?: string }[]; label?: string; unit?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#002E35", color: "#fff", fontSize: 10, padding: "4px 8px", fontFamily: "Inter,sans-serif" }}>
      <div style={{ opacity: 0.6, marginBottom: 1 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i}><span style={{ color: p.color ?? "#fff" }}>{p.name ? `${p.name}: ` : ""}</span><strong>{Math.round(p.value * 100) / 100}{unit ? ` ${unit}` : ""}</strong></div>
      ))}
    </div>
  );
}

// Auto y-range for sensors without a fixed band (TVOC, PM, light).
function autoScale(vals: number[], dp = 0): { domain: [number, number]; ticks: number[] } {
  const v = vals.filter(Number.isFinite);
  const rnd = (x: number) => (dp ? Math.round(x * 10 ** dp) / 10 ** dp : Math.round(x));
  if (!v.length) return { domain: [0, 1], ticks: [0, 1] };
  const lo0 = Math.min(...v), hi0 = Math.max(...v), pad = Math.max((hi0 - lo0) * 0.18, hi0 * 0.05, dp ? 0.3 : 2);
  const lo = Math.max(0, lo0 - pad), hi = hi0 + pad;
  return { domain: [rnd(lo), rnd(hi)], ticks: [rnd(lo), rnd((lo + hi) / 2), rnd(hi)] };
}

function EnvChart({ data, domain, ticks, band, threshold, tipUnit, height }: {
  data: SparklinePoint[]; domain: [number, number]; ticks: number[]; band?: [number, number]; threshold?: number; tipUnit: string; height: number;
}) {
  const pts = data.filter((d) => Number.isFinite(d.value)).map((d) => ({ t: fmtTime(d.time), v: d.value }));
  if (pts.length < 2) return <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--t4)", fontSize: 11 }}>No recent data</div>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={pts} margin={{ top: 6, right: 10, bottom: 0, left: 4 }}>
        <defs>
          <linearGradient id={`env-${tipUnit}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={TEAL} stopOpacity={0.2} />
            <stop offset="95%" stopColor={TEAL} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        {band && <ReferenceArea y1={band[0]} y2={band[1]} fill={GREEN} fillOpacity={0.09} stroke="none" ifOverflow="hidden" />}
        <CartesianGrid stroke="#E6EBEB" vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="t" tick={{ fontSize: 8.5, fill: AXIS }} tickLine={false} axisLine={{ stroke: "#DCE2E2" }} interval={Math.max(1, Math.floor(pts.length / 4))} minTickGap={28} />
        <YAxis domain={domain} ticks={ticks} tick={{ fontSize: 9, fill: AXIS }} tickLine={false} axisLine={false} width={40} tickFormatter={yFmt} />
        {band && [band[0], band[1]].map((y) => <ReferenceLine key={y} y={y} stroke={GREEN} strokeOpacity={0.4} strokeDasharray="2 2" />)}
        {threshold != null && <ReferenceLine y={threshold} stroke={RED} strokeDasharray="4 3" strokeOpacity={0.7}
          label={{ value: threshold.toLocaleString(), position: "insideTopRight", fontSize: 8, fill: RED }} />}
        <Tooltip content={<ChartTip unit={tipUnit} />} cursor={{ stroke: TEAL, strokeOpacity: 0.4 }} />
        <Area type="monotone" dataKey="v" stroke={TEAL} strokeWidth={1.8} fill={`url(#env-${tipUnit})`} dot={false} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// Fine + coarse dust on one plot (two lines, shared axis).
function ParticulatesChart({ pm25, pm10, height }: { pm25: SparklinePoint[]; pm10: SparklinePoint[]; height: number }) {
  const merged = pm25.map((p, i) => ({ t: fmtTime(p.time), pm25: p.value, pm10: pm10[i]?.value ?? null }));
  const { domain, ticks } = autoScale([...pm25.map((p) => p.value), ...pm10.map((p) => p.value)]);
  if (merged.length < 2) return <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--t4)", fontSize: 11 }}>No recent data</div>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={merged} margin={{ top: 6, right: 10, bottom: 0, left: 4 }}>
        <CartesianGrid stroke="#E6EBEB" vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="t" tick={{ fontSize: 8.5, fill: AXIS }} tickLine={false} axisLine={{ stroke: "#DCE2E2" }} interval={Math.max(1, Math.floor(merged.length / 4))} minTickGap={28} />
        <YAxis domain={domain} ticks={ticks} tick={{ fontSize: 9, fill: AXIS }} tickLine={false} axisLine={false} width={40} tickFormatter={yFmt} />
        <Tooltip content={<ChartTip unit="µg/m³" />} cursor={{ stroke: TEAL, strokeOpacity: 0.4 }} />
        <Line type="monotone" dataKey="pm25" name="PM2.5" stroke={TEAL} strokeWidth={1.8} dot={false} connectNulls isAnimationActive={false} />
        <Line type="monotone" dataKey="pm10" name="PM10" stroke={GOLD} strokeWidth={1.8} dot={false} connectNulls isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function TileShell({ children }: { children: React.ReactNode }) {
  return <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,0.07)", borderRadius: 12, boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.035)", padding: "12px 14px 8px", display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>{children}</div>;
}

function EnvTile({ name, value, unit, status, normal, chart }: {
  name: string; value: string | null; unit: string; status?: string; normal: string; chart: React.ReactNode;
}) {
  const si = statusInfo(status);
  const alert = status === "danger" || status === "warning";
  return (
    <TileShell>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--t3)" }}>{name}</span>
        {si.word && <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 800, color: si.color }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: si.color }} />{si.word}</span>}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
        <span style={{ fontFamily: "var(--font-d)", fontSize: 24, fontWeight: 800, lineHeight: 1, color: alert ? si.color : "var(--primary)" }}>{value ?? "—"}</span>
        <span style={{ fontSize: 11, color: "var(--t3)", fontWeight: 600 }}>{unit}</span>
        <span style={{ marginLeft: "auto", fontSize: 9.5, color: "var(--t4)" }}>{normal}</span>
      </div>
      {chart}
    </TileShell>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 700, color: "var(--t2)" }}><span style={{ width: 9, height: 3, borderRadius: 2, background: color }} />{label}</span>;
}

const r1 = (v: number | null | undefined) => (v == null ? null : `${Math.round(v * 10) / 10}`);
const r0 = (v: number | null | undefined) => (v == null ? null : `${Math.round(v).toLocaleString()}`);

export default function DashEnvCol({ env, narrow }: { env: EnvData | null; narrow?: boolean }) {
  const H = narrow ? 108 : 120;
  const tvocVals = (env?.tvoc.sparkline ?? []).map((p) => p.value);
  const tvocMean = env?.tvoc.mean ?? 0, tvocStd = env?.tvoc.std ?? 0;
  const tvocScale = autoScale([...tvocVals, Math.max(0, tvocMean - 2 * tvocStd), tvocMean + 2 * tvocStd], 1);
  const lightScale = autoScale((env?.light?.sparkline ?? []).map((p) => p.value));

  return (
    <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "repeat(2, minmax(0,1fr))", gap: 12 }}>
      <EnvTile name="Temperature" value={r1(env?.temperature.current)} unit="°C" status={env?.temperature.status} normal="18–26°C"
        chart={<EnvChart data={env?.temperature.sparkline ?? []} domain={[8, 36]} ticks={[10, 20, 30]} band={[18, 26]} tipUnit="°C" height={H} />} />
      <EnvTile name="Humidity" value={r0(env?.humidity.current)} unit="% RH" status={env?.humidity.status} normal="50–70%"
        chart={<EnvChart data={env?.humidity.sparkline ?? []} domain={[20, 105]} ticks={[30, 60, 90]} band={[50, 70]} tipUnit="%" height={H} />} />
      <EnvTile name="CO₂ / Ventilation" value={r0(env?.co2.current)} unit="ppm" status={env?.co2.status} normal="max 1,400"
        chart={<EnvChart data={env?.co2.sparkline ?? []} domain={[300, 2200]} ticks={[500, 1200, 1900]} threshold={1400} tipUnit="ppm" height={H} />} />
      <EnvTile name="Air quality" value={env?.tvoc.current != null ? `${Math.round(env.tvoc.current * 100) / 100}` : null} unit="TVOC" normal="±2σ baseline"
        chart={<EnvChart data={env?.tvoc.sparkline ?? []} domain={tvocScale.domain} ticks={tvocScale.ticks} band={tvocStd > 0 ? [Math.max(0, Math.round((tvocMean - 2 * tvocStd) * 10) / 10), Math.round((tvocMean + 2 * tvocStd) * 10) / 10] : undefined} tipUnit="idx" height={H} />} />

      {/* Particulates — fine + coarse dust on one plot */}
      <TileShell>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--t3)" }}>Particulates · dust</span>
          <span style={{ display: "inline-flex", gap: 10 }}><LegendDot color={TEAL} label="PM2.5" /><LegendDot color={GOLD} label="PM10" /></span>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
          <span style={{ fontFamily: "var(--font-d)", fontSize: 24, fontWeight: 800, lineHeight: 1, color: TEAL }}>{r0(env?.pm2_5?.current) ?? "—"}</span>
          <span style={{ fontFamily: "var(--font-d)", fontSize: 18, fontWeight: 800, color: GOLD, marginLeft: 6 }}>{r0(env?.pm10?.current) ?? "—"}</span>
          <span style={{ fontSize: 11, color: "var(--t3)", fontWeight: 600 }}>µg/m³</span>
          <span style={{ marginLeft: "auto", fontSize: 9.5, color: "var(--t4)" }}>15-min avg</span>
        </div>
        <ParticulatesChart pm25={env?.pm2_5?.sparkline ?? []} pm10={env?.pm10?.sparkline ?? []} height={H} />
      </TileShell>

      <EnvTile name="Light" value={r0(env?.light?.current)} unit="lux" normal="photoperiod"
        chart={<EnvChart data={env?.light?.sparkline ?? []} domain={lightScale.domain} ticks={lightScale.ticks} tipUnit="lux" height={H} />} />
    </div>
  );
}
