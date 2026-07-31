"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine, ReferenceArea, ComposedChart, Scatter,
} from "recharts";
import { standardHdepForWeek } from "@/lib/henStandard";

// ── palette ──
const PRIMARY = "#002E35", TEAL = "#2A8E9A", GOLD = "#D4AF37", STD = "#7A5C00";
const DANGER = "#B91C1C", GREEN = "#166534", AXIS = "#3a4d4f", GRID = "rgba(42,142,154,0.12)";
const SAST_OFFSET_H = 2; // schedule times are farm-local (SAST = UTC+2); axis is UTC

// Schedule colours — matches the Schedule tab so a schedule reads the same everywhere.
const S_PALETTE = ["#2A8E9A", "#D4AF37", "#7A5C00", "#6B7C80", "#002E35", "#166534", "#B91C1C", "#92400E"];
const S_PRESET: Record<string, string> = {
  lights: "#D4AF37", lighting: "#D4AF37", fans: "#2A8E9A", ventilation: "#2A8E9A",
  feed: "#7A5C00", feeder: "#7A5C00", cleaning: "#6B7C80", blinds: "#002E35", "manure belt": "#166534", manure: "#166534",
};
function schedColor(name: string): string {
  const k = (name ?? "").trim().toLowerCase();
  if (S_PRESET[k]) return S_PRESET[k];
  let h = 0; for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0;
  return S_PALETTE[h % S_PALETTE.length] ?? PRIMARY;
}

type House = { id: string; name: string; startDate: string; startAgeDays: number; startingHens: number };
type Frame = Record<string, number | string | null | number[]>;
type Anno = { t: number; label: string; color: string; dash: boolean };
type Band = { x1: number; x2: number; color: string; name: string };
// An axis can carry one metric, or several (e.g. the egg-size group → 5 lines).
type AxisSpec = { unit: string; band: boolean; axisColor: string; series: { key: string; label: string; color: string }[] };
type ChartMouse = { activeLabel?: number | string } | null | undefined;
type SchedVersion = {
  scheduleId: string; effectiveDate: string; name: string; house: string; type: "do" | "onoff" | "cycle";
  recurrence: string; interval: number; dayOfMonth: number; days: string[]; times: { start: string; end: string }[];
};
type FarmEvent = { date: string; time?: string; title: string; type: string; house: string };
type FeedDelivery = { date: string; house: string };

const DAY_MS = 86_400_000;
const daysBetween = (start: string, end: string) => Math.floor((new Date(`${end}T00:00:00`).getTime() - new Date(`${start}T00:00:00`).getTime()) / DAY_MS);
const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const hmToMs = (hm: string) => { const [h, m] = (hm || "0:0").split(":").map(Number); return ((h || 0) * 60 + (m || 0)) * 60_000; };
const truncate = (s: string, n = 20) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const DOW = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// Is a schedule version active on a given UTC day?
function activeOn(v: SchedVersion, dMs: number): boolean {
  switch (v.recurrence) {
    case "daily": case "hourly": return true;
    case "weekly": case "biweekly": return v.days.includes(DOW[new Date(dMs).getUTCDay()]);
    case "everyNDays": { const diff = Math.round((dMs - dayMs(v.effectiveDate)) / DAY_MS); return v.interval > 0 && diff >= 0 && diff % v.interval === 0; }
    case "monthly": return new Date(dMs).getUTCDate() === v.dayOfMonth;
    default: return true;
  }
}

// Expand schedules into concrete intra-day occurrences over [from, to]: on/off & cycle → shaded
// windows (bands); "do" (e.g. feeder) → point markers. Only the version in effect on each day.
function expandSchedules(versions: SchedVersion[], fromMs: number, toMs: number): { bands: Band[]; marks: Anno[] } {
  const bands: Band[] = [];
  const marks: Anno[] = [];
  const byId = new Map<string, SchedVersion[]>();
  for (const v of versions) { const g = byId.get(v.scheduleId) ?? []; g.push(v); byId.set(v.scheduleId, g); }
  for (const vers of byId.values()) {
    vers.sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
    for (let d = Math.floor(fromMs / DAY_MS) * DAY_MS; d <= toMs; d += DAY_MS) {
      const day = new Date(d).toISOString().slice(0, 10);
      let ver: SchedVersion | null = null;
      for (const v of vers) { if (v.effectiveDate <= day) ver = v; else break; }
      if (!ver || !activeOn(ver, d)) continue;
      const color = schedColor(ver.name);
      const off = SAST_OFFSET_H * 3_600_000;
      for (const slot of ver.times) {
        const startMs = d + hmToMs(slot.start) - off;
        if (ver.type === "do") {
          if (startMs >= fromMs && startMs <= toMs) marks.push({ t: startMs, label: ver.name, color, dash: false });
        } else {
          const endMs = d + hmToMs(slot.end || slot.start) - off;
          const x1 = Math.max(startMs, fromMs), x2 = Math.min(endMs, toMs);
          if (x2 > x1) bands.push({ x1, x2, color, name: ver.name });
        }
      }
    }
  }
  return { bands, marks };
}

const CATALOG: { key: string; label: string; unit: string; env: boolean }[] = [
  { key: "temperature", label: "Temperature", unit: "°C", env: true },
  { key: "humidity", label: "Humidity", unit: "%", env: true },
  { key: "co2", label: "CO₂", unit: "ppm", env: true },
  { key: "tvoc", label: "TVOC", unit: "idx", env: true },
  { key: "pm2_5", label: "PM2.5", unit: "µg/m³", env: true },
  { key: "pm10", label: "PM10", unit: "µg/m³", env: true },
  { key: "pressure", label: "Pressure", unit: "hPa", env: true },
  { key: "light_level", label: "Light", unit: "lux", env: true },
  { key: "battery", label: "Battery", unit: "%", env: true },
  { key: "noise", label: "Sound level", unit: "dB", env: false },
  { key: "eggs_total", label: "Eggs / day", unit: "", env: false },
  { key: "egg_sizes", label: "Egg sizes (all)", unit: "", env: false },
  { key: "eggs_damaged", label: "Breakages", unit: "", env: false },
  { key: "avg_egg_weight", label: "Egg weight", unit: "g", env: false },
  { key: "cum_mortality", label: "Cumulative mortality", unit: "%", env: false },
  { key: "breakage_rate", label: "Breakage rate", unit: "%", env: false },
  { key: "hdep", label: "Hen-day %", unit: "%", env: false },
];
const META: Record<string, { key: string; label: string; unit: string }> = Object.fromEntries(CATALOG.map((c) => [c.key, c]));
const ENV_OPTIONS = CATALOG.filter((c) => c.env);
// High-res chart draws from InfluxDB: env sensors + the acoustic sound level (audio_noise).
const HR_OPTIONS = CATALOG.filter((c) => c.env || c.key === "noise");
// Only sensor metrics vary within a day → only they get a min–max band. Sheet-derived daily
// values (eggs, sizes, breakages, weight, mortality) are broadcast across the 24 hours, so their
// min = max = the day's value (a flat, meaningless band).
const BANDED = new Set(ENV_OPTIONS.map((c) => c.key));

// "Egg sizes (all)" is a GROUP: one pick that plots all five size splits as separate lines.
const EGG_SIZES = "egg_sizes";
const SIZE_MEMBERS = [
  { key: "eggs_small", label: "Small" }, { key: "eggs_medium", label: "Medium" },
  { key: "eggs_large", label: "Large" }, { key: "eggs_xl", label: "XL" }, { key: "eggs_jumbo", label: "Jumbo" },
];
const SIZE_COLORS = ["#9BC7CE", "#2A8E9A", "#D4AF37", "#B8860B", "#7A5C00"]; // small → jumbo
const expandKeys = (key: string) => (key === EGG_SIZES ? SIZE_MEMBERS.map((m) => m.key) : key ? [key] : []);

// Resolve a dropdown key into an axis spec: a single metric, or the egg-size group (5 lines).
function buildSpec(key: string, baseColor: string, showRange: boolean): AxisSpec | null {
  if (!key) return null;
  if (key === EGG_SIZES) {
    return { unit: "", band: false, axisColor: AXIS, series: SIZE_MEMBERS.map((m, i) => ({ key: m.key, label: m.label, color: SIZE_COLORS[i] })) };
  }
  const m = META[key];
  return { unit: m?.unit ?? "", band: showRange && BANDED.has(key), axisColor: baseColor, series: [{ key, label: m?.label ?? key, color: baseColor }] };
}

const SILVER_RANGES = [
  { key: "30d", days: 30, label: "30d" }, { key: "90d", days: 90, label: "90d" },
  { key: "1y", days: 365, label: "1 year" }, { key: "all", days: 0, label: "All" },
];
const HR_RANGES = [{ key: "24h", days: 1, label: "24h" }, { key: "7d", days: 7, label: "7d" }, { key: "30d", days: 30, label: "30d" }];
const HR_RES = [{ key: "15m", label: "15m" }, { key: "30m", label: "30m" }, { key: "1h", label: "1h" }, { key: "3h", label: "3h" }];

// ── shared control-bar styling ──
const TOOLBAR: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: "10px 18px", alignItems: "center", justifyContent: "space-between", padding: "11px 16px", borderBottom: "1px solid var(--divider)", background: "var(--card-alt)" };
const GROUP: React.CSSProperties = { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" };
const GROUP_END: React.CSSProperties = { display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" };
const CHART_PAD: React.CSSProperties = { padding: "14px 8px 4px" };
const NOTE_PAD: React.CSSProperties = { padding: "2px 16px 14px" };

export default function AnalyticsPage() {
  return (
    <main className="sa-main" style={{ maxWidth: 1440, width: "100%", margin: "0 auto", gap: 14 }}>
      <AcousticExplorer />
      <HighResExplorer />
      <SilverExplorer />
    </main>
  );
}

// ── Shared plot: dual-axis, min–max bands, overlays, drag-to-zoom ──
function MetricChart({ data, domainMs, left, right, standardAxis, annos, bands, tickFormat, labelFormat }: {
  data: Frame[]; domainMs: [number, number]; left: AxisSpec; right: AxisSpec | null;
  standardAxis: "left" | "right" | null; annos: Anno[]; bands: Band[];
  tickFormat: (ms: number) => string; labelFormat: (ms: number) => string;
}) {
  const [zoom, setZoom] = useState<[number, number] | null>(null);
  const [selA, setSelA] = useState<number | null>(null);
  const [selB, setSelB] = useState<number | null>(null);
  useEffect(() => { setZoom(null); }, [domainMs[0], domainMs[1]]); // reset zoom when the window changes

  const domain = zoom ?? domainMs;
  const down = (e: ChartMouse) => { if (e?.activeLabel != null) { setSelA(Number(e.activeLabel)); setSelB(Number(e.activeLabel)); } };
  const move = (e: ChartMouse) => { if (selA != null && e?.activeLabel != null) setSelB(Number(e.activeLabel)); };
  const up = () => {
    if (selA != null && selB != null && selA !== selB) setZoom([Math.min(selA, selB), Math.max(selA, selB)]);
    setSelA(null); setSelB(null);
  };

  // Stack marker labels vertically when markers cluster near the same x, so they don't overprint.
  const stacked = useMemo(() => {
    const span = (domain[1] - domain[0]) || 1;
    const thresh = span / 20;
    return [...annos].sort((a, b) => a.t - b.t).reduce<(Anno & { row: number })[]>((acc, a) => {
      const prev = acc[acc.length - 1];
      acc.push({ ...a, row: prev && a.t - prev.t <= thresh ? prev.row + 1 : 0 });
      return acc;
    }, []);
  }, [annos, domain]);

  return (
    <div style={{ position: "relative", height: 372 }}>
      {zoom && (
        <button onClick={() => setZoom(null)}
          style={{ position: "absolute", top: 0, right: 8, zIndex: 2, fontSize: 10, fontWeight: 700, padding: "3px 8px", border: "1px solid var(--divider)", background: "#fff", cursor: "pointer" }}>Reset zoom</button>
      )}
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 16, right: right ? 4 : 12, bottom: 4, left: -12 }}
          onMouseDown={down} onMouseMove={move} onMouseUp={up}>
          <CartesianGrid strokeDasharray="2 4" stroke={GRID} vertical={false} />
          <XAxis dataKey="t" type="number" scale="time" domain={domain} allowDataOverflow
            tickFormatter={tickFormat} tick={{ fontSize: 10, fill: AXIS, fontFamily: "Inter" }} axisLine={{ stroke: "#d1dada" }} tickLine={false} minTickGap={44} />
          <YAxis yAxisId="left" tick={{ fontSize: 11, fill: left.axisColor, fontFamily: "Inter" }} axisLine={false} tickLine={false} unit={left.unit} width={52} />
          {right && <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: right.axisColor, fontFamily: "Inter" }} axisLine={false} tickLine={false} unit={right.unit} width={52} />}
          <Tooltip labelFormatter={(ms) => labelFormat(Number(ms))}
            formatter={(value, name) => { if (name === "Above standard" || name === "Below standard") return null; if (Array.isArray(value)) return `${value[0]} – ${value[1]}`; return value as number; }}
            contentStyle={{ background: PRIMARY, border: `1px solid ${TEAL}`, borderRadius: 0, fontSize: 12, color: "#fff" }} labelStyle={{ color: TEAL }} />
          <Legend wrapperStyle={{ fontSize: 12, fontWeight: 600 }} />
          {/* schedule windows (behind everything) */}
          {bands.map((b, i) => <ReferenceArea key={`b${i}`} yAxisId="left" x1={b.x1} x2={b.x2} stroke="none" fill={b.color} fillOpacity={0.1} ifOverflow="hidden" />)}
          {standardAxis && (<>
            <Area yAxisId={standardAxis} dataKey="aboveBand" name="Above standard" stroke="none" fill={GREEN} fillOpacity={0.22} legendType="none" isAnimationActive={false} connectNulls={false} />
            <Area yAxisId={standardAxis} dataKey="belowBand" name="Below standard" stroke="none" fill={DANGER} fillOpacity={0.18} legendType="none" isAnimationActive={false} connectNulls={false} />
          </>)}
          {left.band && left.series[0] && <Area yAxisId="left" type="monotone" dataKey={`${left.series[0].key}_band`} name={`${left.series[0].label} range`} stroke="none" fill={left.series[0].color} fillOpacity={0.2} legendType="none" isAnimationActive={false} connectNulls={false} />}
          {right?.band && right.series[0] && <Area yAxisId="right" type="monotone" dataKey={`${right.series[0].key}_band`} name={`${right.series[0].label} range`} stroke="none" fill={right.series[0].color} fillOpacity={0.2} legendType="none" isAnimationActive={false} connectNulls={false} />}
          {left.series.map((s) => <Line key={s.key} yAxisId="left" type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={false} connectNulls />)}
          {right && right.series.map((s) => <Line key={s.key} yAxisId="right" type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={false} connectNulls />)}
          {standardAxis && <Line yAxisId={standardAxis} type="monotone" dataKey="standard" name="Breed standard" stroke={STD} strokeWidth={1.5} strokeDasharray="5 4" dot={false} connectNulls />}
          {stacked.map((a, i) => <ReferenceLine key={`a${i}`} yAxisId="left" x={a.t} stroke={a.color} strokeDasharray={a.dash ? "3 3" : undefined} strokeWidth={1} label={<MarkLabel text={a.label} color={a.color} row={a.row} />} />)}
          {selA != null && selB != null && selA !== selB && <ReferenceArea yAxisId="left" x1={Math.min(selA, selB)} x2={Math.max(selA, selB)} strokeOpacity={0} fill={PRIMARY} fillOpacity={0.08} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── High-res: recent InfluxDB, down to 15-min, with the actual daily schedule windows ──
function HighResExplorer() {
  const [left, setLeft] = useState("temperature");
  const [right, setRight] = useState("");
  const [rangeKey, setRangeKey] = useState("7d");
  const [resKey, setResKey] = useState("1h");
  const [showRange, setShowRange] = useState(false);
  const [showWindows, setShowWindows] = useState(false);
  const [showEvents, setShowEvents] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set()); // schedules hidden from the windows overlay
  const [raw, setRaw] = useState<Frame[]>([]);
  const [range, setRange] = useState<{ fromMs: number; toMs: number }>({ fromMs: 0, toMs: 0 });
  const [sched, setSched] = useState<SchedVersion[]>([]);
  const [events, setEvents] = useState<FarmEvent[]>([]);
  const [feed, setFeed] = useState<FeedDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [s, e, f] = await Promise.all([fetch("/api/schedule"), fetch("/api/events"), fetch("/api/feed")]);
      if (s.ok) setSched((await s.json()).versions ?? []);
      if (e.ok) setEvents((await e.json()).events ?? []);
      if (f.ok) setFeed((await f.json()).deliveries ?? []);
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    const now = Date.now();
    const r = HR_RANGES.find((x) => x.key === rangeKey) ?? HR_RANGES[1];
    setRange({ fromMs: now - r.days * DAY_MS, toMs: now });
    const metrics = [...new Set([...expandKeys(left), ...expandKeys(right)])];
    const q = new URLSearchParams({ metrics: metrics.join(","), range: rangeKey, resolution: resKey });
    const res = await fetch(`/api/analytics/highres?${q}`);
    if (!res.ok) { setErr((await res.json().catch(() => ({}))).error ?? "Failed to load"); setRaw([]); setLoading(false); return; }
    setRaw((await res.json()).series ?? []);
    setLoading(false);
  }, [left, right, rangeKey, resKey]);
  useEffect(() => { load(); }, [load]);

  const data = useMemo<Frame[]>(() => raw.map((row) => ({ ...row, t: new Date(String(row.time)).getTime() })), [raw]);

  const { bands, marks, schedLegend } = useMemo(() => {
    const bands: Band[] = [];
    const marks: Anno[] = [];
    const legend = new Map<string, string>(); // name → colour (every schedule in the window)
    const inWin = (t: number) => t >= range.fromMs && t <= range.toMs;
    // Schedules = the actual operation: on/off windows (bands) + "do" run-times (marks).
    if (showWindows) {
      const ex = expandSchedules(sched, range.fromMs, range.toMs);
      for (const b of ex.bands) { legend.set(b.name, b.color); if (!hidden.has(b.name)) bands.push(b); }
      for (const m of ex.marks) { legend.set(m.label, m.color); if (!hidden.has(m.label)) marks.push(m); }
    }
    // Events = point-in-time: schedule changes (a new version starting), logged events, feed.
    if (showEvents) {
      for (const v of sched) { const t = dayMs(v.effectiveDate); if (inWin(t)) marks.push({ t, label: truncate(v.name || "schedule"), color: PRIMARY, dash: true }); }
      for (const e of events) { const t = dayMs(e.date) + (e.time ? hmToMs(e.time) - SAST_OFFSET_H * 3_600_000 : 12 * 3_600_000); if (inWin(t)) marks.push({ t, label: truncate(e.title || e.type || "event"), color: DANGER, dash: true }); }
      for (const f of feed) { const t = dayMs(f.date) + 12 * 3_600_000; if (inWin(t)) marks.push({ t, label: "Feed", color: STD, dash: true }); }
    }
    return { bands, marks, schedLegend: [...legend.entries()].map(([name, color]) => ({ name, color })).sort((a, b) => a.name.localeCompare(b.name)) };
  }, [showWindows, showEvents, hidden, sched, events, feed, range]);

  const toggleHidden = (name: string) => setHidden((prev) => { const n = new Set(prev); if (n.has(name)) n.delete(name); else n.add(name); return n; });

  const leftSpec = buildSpec(left, TEAL, showRange)!;
  const rightSpec = buildSpec(right, GOLD, showRange);
  const hasData = data.some((d) => leftSpec.series.some((s) => d[s.key] != null) || (rightSpec != null && rightSpec.series.some((s) => d[s.key] != null)));

  return (
    <section className="sa-panel" style={{ padding: 0 }}>
      <div className="sa-panel-hd sa-panel-hd--welfare">High-res (recent)</div>
      <div style={TOOLBAR}>
        <div style={GROUP}>
          <MetricSelect label="Left" value={left} onChange={setLeft} accent={TEAL} options={HR_OPTIONS} />
          <MetricSelect label="Right" value={right} onChange={setRight} accent={GOLD} allowNone options={HR_OPTIONS} />
        </div>
        <div style={GROUP_END}>
          <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
            <Toggle checked={showRange} onChange={setShowRange} label="Min–max" title="Show each metric's min–max range per bucket" />
            <Toggle checked={showWindows} onChange={setShowWindows} label="Schedules" title="Shade the actual daily on/off windows (lights, fans) + run-times" />
            <Toggle checked={showEvents} onChange={setShowEvents} label="Events" title="Mark schedule changes, logged events and feed deliveries" />
          </div>
          <Group label="Res"><Segmented options={HR_RES} value={resKey} onChange={setResKey} /></Group>
          <Group label="Range"><Segmented options={HR_RANGES} value={rangeKey} onChange={setRangeKey} /></Group>
        </div>
      </div>
      <div style={CHART_PAD}>
        {loading ? <div style={{ height: 340 }}><Placeholder text="Loading…" /></div>
          : err ? <div style={{ height: 340 }}><Placeholder text={err} /></div>
          : !hasData ? <div style={{ height: 340 }}><Placeholder text="No recent telemetry for this range." /></div>
          : <MetricChart data={data} domainMs={[range.fromMs, range.toMs]}
              left={leftSpec}
              right={rightSpec}
              standardAxis={null} annos={marks} bands={bands}
              tickFormat={(ms) => new Date(ms).toLocaleString("en-ZA", { day: "numeric", month: "short", hour: rangeKey === "24h" ? "2-digit" : undefined, minute: rangeKey === "24h" ? "2-digit" : undefined })}
              labelFormat={(ms) => new Date(ms).toLocaleString("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} />}
        {showWindows && schedLegend.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "8px 8px 0" }}>
            {schedLegend.map((s) => {
              const off = hidden.has(s.name);
              return (
                <button key={s.name} onClick={() => toggleHidden(s.name)} title={off ? "Show" : "Hide"}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 9px", border: "1px solid var(--divider)", background: off ? "transparent" : "var(--card-alt)", cursor: "pointer", fontSize: 11.5, fontWeight: 700, color: off ? "var(--t4)" : "var(--t1)" }}>
                  <span style={{ width: 11, height: 11, background: s.color, opacity: off ? 0.3 : 1, flexShrink: 0 }} />
                  {s.name}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div className="sa-chart-note" style={NOTE_PAD}>
        Recent, from InfluxDB (≤1 month) at {HR_RES.find((r) => r.key === resKey)?.label} resolution. Drag across the plot to zoom.
        {showWindows && <> Shaded blocks are the day&apos;s schedule windows + run-times.</>}
        {showEvents && <> Markers: <span style={{ color: PRIMARY, fontWeight: 700 }}>schedule change</span> · <span style={{ color: DANGER, fontWeight: 700 }}>event</span> · <span style={{ color: STD, fontWeight: 700 }}>feed</span>.</>}
      </div>
    </section>
  );
}

// ── Silver: deep history, daily. Overlays = schedule changes + events (day resolution). ──
function SilverExplorer() {
  const [left, setLeft] = useState("temperature");
  const [right, setRight] = useState("");
  const [rangeKey, setRangeKey] = useState("90d");
  const [showStd, setShowStd] = useState(false);
  const [overlays, setOverlays] = useState(false);
  const [showRange, setShowRange] = useState(false);
  const [raw, setRaw] = useState<Frame[]>([]);
  const [house, setHouse] = useState<House | null>(null);
  const [sched, setSched] = useState<SchedVersion[]>([]);
  const [events, setEvents] = useState<FarmEvent[]>([]);
  const [feed, setFeed] = useState<FeedDelivery[]>([]);
  const [range, setRange] = useState<{ fromMs: number; toMs: number }>({ fromMs: 0, toMs: 0 });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [h, s, e, f] = await Promise.all([fetch("/api/houses"), fetch("/api/schedule"), fetch("/api/events"), fetch("/api/feed")]);
      if (h.ok) setHouse(((await h.json()).houses ?? [])[0] ?? null);
      if (s.ok) setSched((await s.json()).versions ?? []);
      if (e.ok) setEvents((await e.json()).events ?? []);
      if (f.ok) setFeed((await f.json()).deliveries ?? []);
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    const now = Date.now();
    const r = SILVER_RANGES.find((x) => x.key === rangeKey) ?? SILVER_RANGES[1];
    const fromIso = r.days ? new Date(now - r.days * DAY_MS).toISOString() : "2025-01-01T00:00:00Z";
    const toIso = new Date(now).toISOString();
    setRange({ fromMs: Date.parse(fromIso), toMs: now });
    const metrics = [...new Set([...expandKeys(left), ...expandKeys(right)])];
    const q = new URLSearchParams({ metrics: metrics.join(","), from: fromIso, to: toIso });
    const res = await fetch(`/api/analytics/series?${q}`);
    if (!res.ok) { setErr((await res.json().catch(() => ({}))).error ?? "Failed to load"); setRaw([]); setLoading(false); return; }
    setRaw((await res.json()).series ?? []);
    setLoading(false);
  }, [left, right, rangeKey]);
  useEffect(() => { load(); }, [load]);

  const hdepAxis: "left" | "right" | null = left === "hdep" ? "left" : right === "hdep" ? "right" : null;
  const stdOn = showStd && !!hdepAxis && !!house;

  const data = useMemo(() => raw.map((row) => {
    const iso = String(row.time);
    const out: Frame = { ...row, t: new Date(iso).getTime() };
    if (stdOn && house) {
      const s = standardHdepForWeek((house.startAgeDays + daysBetween(house.startDate, iso.slice(0, 10))) / 7);
      const st = s == null ? null : Math.round(s * 10) / 10;
      out.standard = st;
      const hd = typeof out.hdep === "number" ? out.hdep : null;
      if (hd != null && st != null) { out.aboveBand = [st, Math.max(hd, st)]; out.belowBand = [Math.min(hd, st), st]; }
    }
    return out;
  }), [raw, stdOn, house]);

  const annos = useMemo<Anno[]>(() => {
    if (!overlays) return [];
    const { fromMs: lo, toMs: hi } = range;
    const inWin = (t: number) => t >= lo && t <= hi;
    const out: Anno[] = [];
    for (const v of sched) { const t = dayMs(v.effectiveDate); if (inWin(t)) out.push({ t, label: truncate(v.name || "schedule"), color: PRIMARY, dash: false }); }
    for (const e of events) { const t = dayMs(e.date); if (inWin(t)) out.push({ t, label: truncate(e.title || e.type || "event"), color: DANGER, dash: true }); }
    for (const f of feed) { const t = dayMs(f.date); if (inWin(t)) out.push({ t, label: "Feed", color: STD, dash: true }); }
    return out;
  }, [overlays, sched, events, feed, range]);

  const leftSpec = buildSpec(left, TEAL, showRange)!;
  const rightSpec = buildSpec(right, GOLD, showRange);
  const hasData = data.some((d) => leftSpec.series.some((s) => d[s.key] != null) || (rightSpec != null && rightSpec.series.some((s) => d[s.key] != null)));

  return (
    <section className="sa-panel" style={{ padding: 0 }}>
      <div className="sa-panel-hd sa-panel-hd--production">History (daily)</div>
      <div style={TOOLBAR}>
        <div style={GROUP}>
          <MetricSelect label="Left" value={left} onChange={setLeft} accent={TEAL} />
          <MetricSelect label="Right" value={right} onChange={setRight} accent={GOLD} allowNone />
        </div>
        <div style={GROUP_END}>
          <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
            <Toggle checked={showStd} onChange={setShowStd} disabled={!hdepAxis} accent={STD} label="Standard"
              title={hdepAxis ? "Overlay the breed-standard lay curve" : "Select Hen-day % to compare against the standard"} />
            <Toggle checked={showRange} onChange={setShowRange} label="Min–max" title="Show each metric's daily min–max range" />
            <Toggle checked={overlays} onChange={setOverlays} label="Events" title="Mark schedule changes, events and feed deliveries" />
          </div>
          <Group label="Range"><Segmented options={SILVER_RANGES} value={rangeKey} onChange={setRangeKey} /></Group>
        </div>
      </div>
      <div style={CHART_PAD}>
        {loading ? <div style={{ height: 340 }}><Placeholder text="Loading…" /></div>
          : err ? <div style={{ height: 340 }}><Placeholder text={err} /></div>
          : !hasData ? <div style={{ height: 340 }}><Placeholder text="No data for this metric / range." /></div>
          : <MetricChart data={data} domainMs={[range.fromMs, range.toMs]}
              left={leftSpec}
              right={rightSpec}
              standardAxis={stdOn ? hdepAxis : null} annos={annos} bands={[]}
              tickFormat={(ms) => new Date(ms).toLocaleDateString("en-ZA", { day: "numeric", month: "short" })}
              labelFormat={(ms) => new Date(ms).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "2-digit" })} />}
      </div>
      <div className="sa-chart-note" style={NOTE_PAD}>
        Daily, from the AWS silver layer. Drag across the plot to zoom.
        {overlays && <> Markers: <span style={{ color: PRIMARY, fontWeight: 700 }}>schedule change</span> · <span style={{ color: DANGER, fontWeight: 700 }}>event</span> · <span style={{ color: STD, fontWeight: 700 }}>feed</span>.</>}
      </div>
    </section>
  );
}

// ── Flock noise (acoustic welfare): noise level over time + clickable anomaly clips ──
type NoiseRow = { time: string; mean: number | null; max: number | null; baseline: number | null };
type AnomalyRow = { time: string; peakDb: number | null; baselineDb: number | null; clipKey: string | null; clipSeconds: number | null };
type NoiseDatum = { t: number; mean: number | null; baseline: number | null; band?: [number, number] };
type AnomPt = { t: number; y: number; a: AnomalyRow };
type ClipState = { key: string | null; state: "idle" | "loading" | "playing" | "error" };
const ACOUSTIC_RANGES = [{ key: "24h", label: "24h" }, { key: "7d", label: "7d" }, { key: "30d", label: "30d" }];
const dbFmt = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 10) / 10} dB`);
const anomKey = (a: AnomalyRow) => a.clipKey ?? a.time;

function AcousticExplorer() {
  const [rangeKey, setRangeKey] = useState("24h");
  const [series, setSeries] = useState<NoiseRow[]>([]);
  const [anomalies, setAnomalies] = useState<AnomalyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<AnomalyRow | null>(null);
  const [clip, setClip] = useState<ClipState>({ key: null, state: "idle" });
  const [win, setWin] = useState<{ fromMs: number; toMs: number }>({ fromMs: 0, toMs: 0 });
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    const toMs = Date.now();
    setWin({ fromMs: toMs - (rangeKey === "7d" ? 7 : rangeKey === "30d" ? 30 : 1) * DAY_MS, toMs });
    const res = await fetch(`/api/analytics/acoustic?range=${rangeKey}`);
    if (!res.ok) { setErr((await res.json().catch(() => ({}))).error ?? "Failed to load"); setSeries([]); setAnomalies([]); setLoading(false); return; }
    const d = await res.json();
    setSeries(d.series ?? []); setAnomalies(d.anomalies ?? []); setLoading(false);
  }, [rangeKey]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const id = setInterval(load, 60_000); return () => clearInterval(id); }, [load]); // readings arrive ~1/min

  // Click a marker or an inbox row → sign the clip and play it in the shared <audio>.
  const playClip = useCallback(async (a: AnomalyRow) => {
    setSelected(a);
    if (!a.clipKey) { setClip({ key: anomKey(a), state: "error" }); return; }
    setClip({ key: a.clipKey, state: "loading" });
    try {
      const res = await fetch(`/api/analytics/acoustic/clip?key=${encodeURIComponent(a.clipKey)}`);
      if (!res.ok) throw new Error("clip");
      const { url } = await res.json();
      const el = audioRef.current;
      if (el) { el.src = url; await el.play(); setClip({ key: a.clipKey, state: "playing" }); }
    } catch { setClip({ key: a.clipKey, state: "error" }); }
  }, []);

  const data = useMemo<NoiseDatum[]>(() => series.map((r) => ({
    t: new Date(r.time).getTime(), mean: r.mean, baseline: r.baseline,
    band: r.mean != null && r.max != null ? [r.mean, r.max] : undefined,
  })), [series]);
  const anomPts = useMemo<AnomPt[]>(() => anomalies
    .filter((a) => a.peakDb != null || a.baselineDb != null)
    .map((a) => ({ t: new Date(a.time).getTime(), y: (a.peakDb ?? a.baselineDb) as number, a })), [anomalies]);
  const hasNoise = data.some((d) => d.mean != null);
  const selectedT = selected ? new Date(selected.time).getTime() : null;

  return (
    <section className="sa-panel" style={{ padding: 0 }}>
      <div className="sa-panel-hd sa-panel-hd--welfare">Flock noise (welfare)</div>
      <div style={TOOLBAR}>
        <div style={GROUP}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--t2)" }}>Noise level &amp; spike anomalies</span>
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--t3)" }}>{anomalies.length} anomal{anomalies.length === 1 ? "y" : "ies"}</span>
        </div>
        <div style={GROUP_END}>
          <Group label="Range"><Segmented options={ACOUSTIC_RANGES} value={rangeKey} onChange={setRangeKey} /></Group>
        </div>
      </div>
      <div style={CHART_PAD}>
        {loading ? <div style={{ height: 340 }}><Placeholder text="Loading…" /></div>
          : err ? <div style={{ height: 340 }}><Placeholder text={err} /></div>
          : !hasNoise && anomPts.length === 0 ? <div style={{ height: 340 }}><Placeholder text="No acoustic data yet — the mic feed will show here once it's flowing." /></div>
          : <AcousticChart data={data} anomPts={anomPts} domainMs={[win.fromMs, win.toMs]} selectedT={selectedT} onPick={playClip}
              tickFormat={(ms) => new Date(ms).toLocaleString("en-ZA", { day: "numeric", month: "short", hour: rangeKey === "24h" ? "2-digit" : undefined, minute: rangeKey === "24h" ? "2-digit" : undefined })}
              labelFormat={(ms) => new Date(ms).toLocaleString("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} />}
      </div>
      <AnomalyInbox anomalies={anomalies} selected={selected} clip={clip} onPlay={playClip} />
      <audio ref={audioRef} onEnded={() => setClip((c) => ({ ...c, state: "idle" }))} onError={() => setClip((c) => ({ ...c, state: "error" }))} style={{ display: "none" }} />
      <div className="sa-chart-note" style={NOTE_PAD}>
        Noise level (relative dBFS — 0 is loudest; currently includes fan/mechanical noise, not calibrated).
        {" "}<span style={{ color: DANGER, fontWeight: 700 }}>Red dots</span> are sudden spikes vs the recent baseline — click one to hear the ~30 s clip. POC: house1 / mic_001.
      </div>
    </section>
  );
}

function AnomalyDot(props: { cx?: number; cy?: number; payload?: AnomPt; selectedT: number | null }) {
  const { cx, cy, payload, selectedT } = props;
  if (cx == null || cy == null) return <g />;
  const on = selectedT != null && payload?.t === selectedT;
  return (
    <g style={{ cursor: "pointer" }}>
      {on && <circle cx={cx} cy={cy} r={11} fill="none" stroke={DANGER} strokeWidth={1.5} opacity={0.5} />}
      <circle cx={cx} cy={cy} r={on ? 6.5 : 4.5} fill={DANGER} stroke="#fff" strokeWidth={1.5} />
    </g>
  );
}

function AcousticChart({ data, anomPts, domainMs, selectedT, onPick, tickFormat, labelFormat }: {
  data: NoiseDatum[]; anomPts: AnomPt[]; domainMs: [number, number]; selectedT: number | null;
  onPick: (a: AnomalyRow) => void; tickFormat: (ms: number) => string; labelFormat: (ms: number) => string;
}) {
  return (
    <div style={{ height: 340 }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 16, right: 12, bottom: 4, left: -6 }}>
          <CartesianGrid strokeDasharray="2 4" stroke={GRID} vertical={false} />
          <XAxis dataKey="t" type="number" scale="time" domain={domainMs} allowDataOverflow
            tickFormatter={tickFormat} tick={{ fontSize: 10, fill: AXIS, fontFamily: "Inter" }} axisLine={{ stroke: "#d1dada" }} tickLine={false} minTickGap={44} />
          {/* dBFS is negative (0 = loudest); let recharts auto-scale — no 0-based assumption */}
          <YAxis tick={{ fontSize: 11, fill: TEAL, fontFamily: "Inter" }} axisLine={false} tickLine={false} unit=" dB" width={56} domain={["auto", "auto"]} />
          <Tooltip labelFormatter={(ms) => labelFormat(Number(ms))}
            formatter={(value, name) => {
              if (name === "Anomaly") return null;
              if (Array.isArray(value)) return [`${Math.round(value[0])} – ${Math.round(value[1])} dB`, "Range"];
              return [dbFmt(Number(value)), name];
            }}
            contentStyle={{ background: PRIMARY, border: `1px solid ${TEAL}`, borderRadius: 0, fontSize: 12, color: "#fff" }} labelStyle={{ color: TEAL }} />
          <Legend wrapperStyle={{ fontSize: 12, fontWeight: 600 }} />
          <Area type="monotone" dataKey="band" name="Loudest (per bucket)" stroke="none" fill={TEAL} fillOpacity={0.16} legendType="none" isAnimationActive={false} connectNulls={false} />
          <Line type="monotone" dataKey="baseline" name="Baseline" stroke={AXIS} strokeWidth={1} strokeDasharray="5 4" dot={false} connectNulls isAnimationActive={false} />
          <Line type="monotone" dataKey="mean" name="Noise level" stroke={TEAL} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
          <Scatter name="Anomaly" data={anomPts} dataKey="y" isAnimationActive={false}
            shape={(p) => <AnomalyDot {...(p as { cx?: number; cy?: number; payload?: AnomPt })} selectedT={selectedT} />}
            onClick={(d) => { const a = (d as unknown as { payload?: AnomPt }).payload?.a; if (a) onPick(a); }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function AnomalyInbox({ anomalies, selected, clip, onPlay }: {
  anomalies: AnomalyRow[]; selected: AnomalyRow | null; clip: ClipState; onPlay: (a: AnomalyRow) => void;
}) {
  if (anomalies.length === 0) {
    return <div style={{ padding: "2px 16px 4px", fontSize: 12, color: "var(--t3)" }}>No spike anomalies detected in this range.</div>;
  }
  const recent = [...anomalies].reverse(); // newest first
  return (
    <div style={{ padding: "4px 12px 6px" }}>
      <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--t3)", padding: "2px 4px 6px" }}>Anomaly inbox</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 176, overflowY: "auto" }}>
        {recent.map((a) => {
          const key = anomKey(a);
          const on = selected != null && anomKey(selected) === key;
          const busy = clip.key === a.clipKey && clip.state === "loading";
          const errored = clip.key === a.clipKey && clip.state === "error";
          return (
            <button key={key} onClick={() => onPlay(a)}
              style={{ display: "flex", alignItems: "center", gap: 12, textAlign: "left", padding: "7px 10px", border: "1px solid var(--divider)", borderLeft: `3px solid ${DANGER}`, background: on ? "var(--card-alt)" : "#fff", cursor: "pointer" }}>
              <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, borderRadius: "50%", background: on && clip.state === "playing" ? DANGER : "rgba(185,28,28,0.1)", color: on && clip.state === "playing" ? "#fff" : DANGER, flexShrink: 0, fontSize: 12 }}>
                {busy ? "…" : errored ? "!" : "▶"}
              </span>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--t1)", minWidth: 128 }}>
                {new Date(a.time).toLocaleString("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              </span>
              <span style={{ fontSize: 11.5, color: "var(--t2)" }}>
                peak <strong style={{ color: DANGER }}>{dbFmt(a.peakDb)}</strong> vs baseline {dbFmt(a.baselineDb)}
              </span>
              <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--t3)" }}>
                {errored ? "clip unavailable" : a.clipSeconds ? `${a.clipSeconds}s clip` : "clip"}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MetricSelect({ label, value, onChange, accent, allowNone, options = CATALOG }: { label: string; value: string; onChange: (v: string) => void; accent: string; allowNone?: boolean; options?: { key: string; label: string }[] }) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ fontSize: 9.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: accent }}>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        style={{ fontSize: 12.5, padding: "5px 8px", border: "1px solid var(--divider)", borderLeft: `3px solid ${accent}`, background: "#fff", fontWeight: 600, color: "var(--t1)", minWidth: 128, cursor: "pointer" }}>
        {allowNone && <option value="">None</option>}
        {options.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
      </select>
    </label>
  );
}
function Toggle({ checked, onChange, label, title, disabled, accent }: { checked: boolean; onChange: (v: boolean) => void; label: string; title: string; disabled?: boolean; accent?: string }) {
  return (
    <label title={title} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 700, color: disabled ? "var(--t4)" : (accent ?? "var(--t2)"), cursor: disabled ? "not-allowed" : "pointer", userSelect: "none" }}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} style={{ accentColor: accent ?? TEAL, cursor: disabled ? "not-allowed" : "pointer" }} />{label}
    </label>
  );
}
function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
      <span style={{ fontSize: 9.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--t3)" }}>{label}</span>
      {children}
    </div>
  );
}
function Segmented({ options, value, onChange }: { options: { key: string; label: string }[]; value: string; onChange: (k: string) => void }) {
  return (
    <div style={{ display: "inline-flex", border: "1px solid var(--divider)", overflow: "hidden" }}>
      {options.map((o, i) => {
        const on = value === o.key;
        return (
          <button key={o.key} onClick={() => onChange(o.key)}
            style={{ padding: "5px 11px", fontSize: 11, fontWeight: 700, border: "none", borderLeft: i ? "1px solid var(--divider)" : "none", background: on ? "var(--grad-primary)" : "#fff", color: on ? "#fff" : "var(--t2)", boxShadow: on ? "inset 0 -2px 0 rgba(0,0,0,0.18)" : "none", cursor: "pointer" }}>{o.label}</button>
        );
      })}
    </div>
  );
}
// Custom marker label — recharts injects `viewBox`; we offset y by the marker's row so
// clustered markers stack instead of overprinting.
function MarkLabel({ viewBox, text, color, row }: { viewBox?: { x?: number; y?: number }; text: string; color: string; row: number }) {
  const x = (viewBox?.x ?? 0) + 3;
  const y = (viewBox?.y ?? 0) + 9 + row * 10;
  return <text x={x} y={y} fill={color} fontSize={8} fontWeight={700} textAnchor="start">{text}</text>;
}

function Placeholder({ text }: { text: string }) {
  return <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--t3)", fontSize: 13 }}>{text}</div>;
}
