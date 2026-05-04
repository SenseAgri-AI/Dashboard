"use client";

import { useState } from "react";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, ComposedChart, Line,
  CartesianGrid, ReferenceArea, ReferenceLine,
  ResponsiveContainer, Cell, Tooltip, LabelList,
} from "recharts";
import type { ProductionData } from "./DashMetricCol";
import type { SparklinePoint } from "./DashEnvCol";

const TEAL  = "#2A8E9A";
const GOLD  = "#D4AF37";
const T3    = "#6B7C80";
const GRID  = "#C8CCCC";
const TICK  = { fontSize: 11, fontWeight: 600, fill: "#3a4d4f", fontFamily: "Inter,sans-serif" } as const;
const AXIS_LINE = { stroke: "#BEC8CA", strokeWidth: 1 };

const SLIDES = [
  { title: "Egg count",       group: "production" },
  { title: "Revenue",         group: "financial" },
  { title: "Hen-Day %",       group: "welfare derived" },
  { title: "Feed conversion", group: "pulses/egg" },
  { title: "Feed per day",    group: "raw pulses" },
];

const NOTES = [
  "Today highlighted in teal",
  "Revenue trend",
  "Shaded band = normal zone 85–98%",
  "Uncalibrated — lower is better. Converts to kg/egg once auger calibrated",
  "Raw feed auger pulses — uncalibrated. Validates sensor activity per day",
];

type DailyEntry = ProductionData["daily"][number];

function niceTicks(max: number, targetCount = 5): { ticks: number[]; domainMax: number } {
  if (max <= 0) return { ticks: [0], domainMax: 1 };
  const rough = max / targetCount;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const n = rough / mag;
  const step = n < 1.5 ? mag : n < 3 ? 2 * mag : n < 7 ? 5 * mag : 10 * mag;
  const domainMax = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let t = 0; t <= domainMax; t += step) ticks.push(t);
  return { ticks, domainMax };
}

function niceRange(min: number, max: number, targetCount = 5): { ticks: number[]; domainMin: number; domainMax: number } {
  if (max <= min) return { ticks: [min, max], domainMin: min, domainMax: max };
  const rough = (max - min) / targetCount;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const n = rough / mag;
  const step = n < 1.5 ? mag : n < 3 ? 2 * mag : n < 7 ? 5 * mag : 10 * mag;
  const domainMin = Math.floor(min / step) * step;
  const domainMax = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let t = domainMin; t <= domainMax; t += step) ticks.push(t);
  return { ticks, domainMin, domainMax };
}

function dayLabel(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][d.getDay()];
}

function shortDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

function fmtDate(dateStr: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
}

function PendingChart({ message }: { message: string }) {
  return (
    <div style={{ flex: 1, minHeight: 120, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: "#3a4d4f", fontFamily: "Inter,sans-serif" }}>{message}</span>
    </div>
  );
}

function ChartTooltip({ active, payload, label, formatter }: {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
  formatter?: (v: number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "#002E35", color: "#fff", fontSize: 10,
      padding: "4px 8px", fontFamily: "Inter,sans-serif",
      border: "none", boxShadow: "0 2px 8px rgba(0,0,0,0.18)",
    }}>
      <span style={{ opacity: 0.6, marginRight: 6 }}>{label}</span>
      <strong>{formatter ? formatter(payload[0].value) : payload[0].value}</strong>
    </div>
  );
}

interface DashTrendsCarouselProps {
  production: ProductionData | null;
  waterSeries: SparklinePoint[];
  feedSeries: SparklinePoint[];
}

function OperationalMeterChart({
  title, sub, data, barUnit, cumUnit, note,
}: {
  title: string; sub: string; data: SparklinePoint[];
  barUnit: string; cumUnit: string; note: string;
}) {
  const pts = data
    .filter(pt => isFinite(pt.value))
    .map(pt => ({
      v: pt.value,
      cum: pt.cumulative ?? 0,
      t: new Date(pt.time).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false }),
    }));

  const barMax = pts.length ? Math.max(...pts.map(p => p.v)) : 10;
  const { ticks: barTicks, domainMax: barDomainMax } = niceTicks(barMax, 4);
  const cumMax = pts.length ? Math.max(...pts.map(p => p.cum)) : 10;

  return (
    <div className="sa-meter-card sa-trend-card">
      <div className="sa-trend-title">{title}</div>
      <div className="sa-trend-sub">{sub}</div>
      {pts.length > 0 ? (
        <ResponsiveContainer width="100%" height={190}>
          <ComposedChart data={pts} margin={{ top: 8, right: 48, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={GRID} vertical={false} strokeDasharray="4 3" />
            <XAxis dataKey="t" tick={TICK} tickLine={true} axisLine={AXIS_LINE}
              interval={Math.max(1, Math.floor(pts.length / 5))} />
            <YAxis yAxisId={0} ticks={barTicks} domain={[0, barDomainMax]}
              tick={TICK} tickLine={false} axisLine={AXIS_LINE} width={42}
              tickFormatter={v => `${Math.round(v)}`} />
            <YAxis yAxisId={1} orientation="right" ticks={[cumMax]} domain={[0, Math.ceil(cumMax * 1.05)]}
              tick={TICK} tickLine={false} axisLine={AXIS_LINE} width={48}
              tickFormatter={v => `${Math.round(v)}${cumUnit}`} />
            <Tooltip content={<ChartTooltip formatter={v => `${Math.round(v).toLocaleString()} ${barUnit}`} />} cursor={{ fill: "rgba(0,46,53,0.04)" }} />
            <Bar yAxisId={0} dataKey="v" fill={TEAL} fillOpacity={0.72} radius={0} isAnimationActive={false} />
            <Line yAxisId={1} type="monotone" dataKey="cum" stroke={GOLD} strokeWidth={1.8}
              dot={false} activeDot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      ) : (
        <PendingChart message="Loading meter data…" />
      )}
      <div className="sa-trend-note">{note}</div>
    </div>
  );
}

export default function DashTrendsCarousel({ production, waterSeries, feedSeries }: DashTrendsCarouselProps) {
  const [cur, setCur] = useState(0);
  const [preset, setPreset] = useState<7 | 14 | 30>(7);
  const [showCustom, setShowCustom] = useState(false);
  const [fromInput, setFromInput] = useState("");
  const [toInput, setToInput] = useState("");
  const [customRange, setCustomRange] = useState<{ from: string; to: string; data: DailyEntry[] } | null>(null);
  const [fetching, setFetching] = useState(false);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [showGraphMenu, setShowGraphMenu] = useState(false);

  const daily = production?.daily ?? [];
  const viewData: DailyEntry[] = customRange ? customRange.data : daily.slice(-preset);

  const chartData = viewData.map((d, i) => ({
    ...d,
    label: viewData.length > 10 ? shortDate(d.date) : dayLabel(d.date),
    isToday: !customRange && i === viewData.length - 1,
  }));

  const xInterval = chartData.length > 10 ? Math.max(0, Math.floor(chartData.length / 6) - 1) : 0;
  const showDots  = chartData.length <= 14;
  const showBarLabels = chartData.length <= 7;

  const viewLabel = customRange
    ? `${fmtDate(customRange.from)} – ${fmtDate(customRange.to)}`
    : `${preset}-day`;

  // Axis ranges
  const eggValues = chartData.map(d => d.eggs).filter(v => isFinite(v));
  const eggMin = eggValues.length ? Math.min(...eggValues) : 0;
  const eggMax = eggValues.length ? Math.max(...eggValues) : 5000;
  const eggRange = eggMax - eggMin;
  const { ticks: eggTicks, domainMin: eggDomainMin, domainMax: eggDomainMax } = niceRange(eggMin, eggMax, 6);
  const eggFmt = (v: number) => eggRange < 800 ? v.toLocaleString("en-ZA") : `${(v / 1000).toFixed(1)}k`;

  const revValues = chartData.map(d => d.revenue).filter(v => isFinite(v));
  const { ticks: revTicks, domainMin: revDomainMin, domainMax: revDomainMax } = niceRange(
    revValues.length ? Math.min(...revValues) : 0,
    revValues.length ? Math.max(...revValues) : 5000, 5
  );

  const fcrVals = chartData.filter(d => d.fcr !== null).map(d => d.fcr as number).filter(isFinite);
  const fcrMax = fcrVals.length ? Math.max(...fcrVals) : 5;
  const { ticks: fcrTicks, domainMax: fcrDomainMax } = niceTicks(fcrMax, 6);

  const feedVals = chartData.filter(d => d.feedPulses !== null).map(d => d.feedPulses as number).filter(isFinite);
  const { ticks: feedTicks, domainMax: feedDomainMax } = niceTicks(feedVals.length ? Math.max(...feedVals) : 1000, 6);

  async function applyCustomRange() {
    if (!fromInput || !toInput) return;
    setFetching(true);
    try {
      const res = await fetch(`/api/production?from=${fromInput}&to=${toInput}`);
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      setCustomRange({ from: fromInput, to: toInput, data: data.daily ?? [] });
      setShowCustom(false);
    } finally {
      setFetching(false);
    }
  }

  function openCustom() {
    if (!fromInput && !toInput) {
      const today = new Date().toISOString().slice(0, 10);
      const ago30 = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
      setFromInput(ago30);
      setToInput(today);
    }
    setShowCustom(s => !s);
  }

  function selectPreset(d: 7 | 14 | 30) {
    setPreset(d);
    setCustomRange(null);
    setShowCustom(false);
  }

  function clearCustom() {
    setCustomRange(null);
    setShowCustom(false);
  }

  function renderSlide(idx: number) {
    switch (idx) {
      case 0:
        if (chartData.length === 0) return <PendingChart message="Loading production data…" />;
        return (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 18, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={GRID} vertical={true} strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={TICK} tickLine={true} axisLine={AXIS_LINE} interval={xInterval} />
              <YAxis ticks={eggTicks} domain={[eggDomainMin, eggDomainMax]}
                tick={TICK} tickLine={false} axisLine={AXIS_LINE} width={52} tickFormatter={eggFmt} />
              <Tooltip content={<ChartTooltip formatter={v => `${Math.round(v).toLocaleString()} eggs`} />} cursor={{ fill: "rgba(0,46,53,0.04)" }} />
              <Bar dataKey="eggs" radius={0} isAnimationActive={false}>
                {chartData.map((entry, i) => (
                  <Cell key={i} fill={entry.isToday ? TEAL : "rgba(0,46,53,0.09)"} />
                ))}
                {showBarLabels && (
                  <LabelList dataKey="eggs" position="top"
                    formatter={(v: unknown) => eggFmt(Number(v))}
                    style={{ fontSize: 10, fontWeight: 600, fill: "#3a4d4f", fontFamily: "Inter,sans-serif" }} />
                )}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        );

      case 1:
        if (chartData.length === 0) return <PendingChart message="Loading production data…" />;
        return (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="sa-rev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={GOLD} stopOpacity={0.28} />
                  <stop offset="95%" stopColor={GOLD} stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={GRID} vertical={true} strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={TICK} tickLine={true} axisLine={AXIS_LINE} interval={xInterval} />
              <YAxis ticks={revTicks} domain={[revDomainMin, revDomainMax]}
                tick={TICK} tickLine={false} axisLine={AXIS_LINE} width={52}
                tickFormatter={v => `R${(v / 1000).toFixed(1)}k`} />
              <Tooltip content={<ChartTooltip formatter={v => `R ${v.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}`} />} cursor={{ stroke: GOLD, strokeWidth: 1, strokeOpacity: 0.3 }} />
              <Area type="monotone" dataKey="revenue" stroke={GOLD} strokeWidth={2}
                fill="url(#sa-rev)" dot={showDots ? { r: 3, fill: GOLD, strokeWidth: 0 } : false} activeDot={{ r: 4, fill: GOLD }} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        );

      case 2: {
        if (chartData.length === 0) return <PendingChart message="Loading production data…" />;
        const hdepData = chartData.filter(d => d.hdep !== null);
        return (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={hdepData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="sa-hdep" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={TEAL} stopOpacity={0.28} />
                  <stop offset="95%" stopColor={TEAL} stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={GRID} vertical={true} strokeDasharray="3 3" />
              <ReferenceArea y1={85} y2={98} fill={TEAL} fillOpacity={0.08} stroke="none" />
              <ReferenceLine y={85} stroke={TEAL} strokeDasharray="4 3" strokeOpacity={0.45}
                label={{ value: "85% min", position: "insideTopLeft", fontSize: 8, fill: TEAL, opacity: 0.7 }} />
              <ReferenceLine y={98} stroke={TEAL} strokeDasharray="4 3" strokeOpacity={0.45}
                label={{ value: "98% max", position: "insideBottomLeft", fontSize: 8, fill: TEAL, opacity: 0.7 }} />
              <XAxis dataKey="label" tick={TICK} tickLine={true} axisLine={AXIS_LINE} interval={xInterval} />
              <YAxis ticks={[80, 84, 88, 92, 96, 100]} domain={[80, 100]}
                tick={TICK} tickLine={false} axisLine={AXIS_LINE} width={38} tickFormatter={v => `${v}%`} />
              <Tooltip content={<ChartTooltip formatter={v => `${v.toFixed(1)}%`} />} cursor={{ stroke: TEAL, strokeWidth: 1, strokeOpacity: 0.3 }} />
              <Area type="monotone" dataKey="hdep" stroke={TEAL} strokeWidth={2}
                fill="url(#sa-hdep)" dot={showDots ? { r: 3, fill: TEAL, strokeWidth: 0 } : false} activeDot={{ r: 4, fill: TEAL }} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        );
      }

      case 3: {
        if (chartData.length === 0) return <PendingChart message="Loading production data…" />;
        const fcrData = chartData.filter(d => d.fcr !== null);
        if (fcrData.length < 2) return <PendingChart message="Loading feed conversion data…" />;
        return (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={fcrData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="sa-fcr" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={T3} stopOpacity={0.18} />
                  <stop offset="95%" stopColor={T3} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={GRID} vertical={true} strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={TICK} tickLine={true} axisLine={AXIS_LINE} interval={xInterval} />
              <YAxis ticks={fcrTicks} domain={[0, fcrDomainMax]}
                tick={TICK} tickLine={false} axisLine={AXIS_LINE} width={38} tickFormatter={v => v.toFixed(1)} />
              <Tooltip content={<ChartTooltip formatter={v => `${v.toFixed(2)} pulses/egg`} />} cursor={{ stroke: T3, strokeWidth: 1, strokeOpacity: 0.3 }} />
              <Area type="monotone" dataKey="fcr" stroke={T3} strokeWidth={2} strokeDasharray="6 3"
                fill="url(#sa-fcr)" dot={showDots ? { r: 3, fill: T3, strokeWidth: 0 } : false} activeDot={{ r: 4, fill: T3 }} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        );
      }

      case 4: {
        if (chartData.length === 0) return <PendingChart message="Loading production data…" />;
        const feedData = chartData.filter(d => d.feedPulses !== null);
        if (feedData.length === 0) return <PendingChart message="Loading feed data…" />;
        return (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={feedData} margin={{ top: 18, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={GRID} vertical={true} strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={TICK} tickLine={true} axisLine={AXIS_LINE} interval={xInterval} />
              <YAxis ticks={feedTicks} domain={[0, feedDomainMax]}
                tick={TICK} tickLine={false} axisLine={AXIS_LINE} width={44}
                tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v}`} />
              <Tooltip content={<ChartTooltip formatter={v => `${Math.round(v).toLocaleString()} pulses`} />} cursor={{ fill: "rgba(0,46,53,0.04)" }} />
              <Bar dataKey="feedPulses" fill={T3} fillOpacity={0.55} radius={0} isAnimationActive={false}>
                {showBarLabels && (
                  <LabelList dataKey="feedPulses" position="top"
                    formatter={(v: unknown) => { const n = Number(v); return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`; }}
                    style={{ fontSize: 10, fontWeight: 600, fill: "#3a4d4f", fontFamily: "Inter,sans-serif" }} />
                )}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        );
      }

      default:
        return null;
    }
  }

  const slide = SLIDES[cur];

  const handleTouchStart = (e: React.TouchEvent) => setTouchStart(e.touches[0].clientX);
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStart === null) return;
    const delta = e.changedTouches[0].clientX - touchStart;
    if (Math.abs(delta) > 50) {
      setCur(c => delta < 0 ? (c + 1) % SLIDES.length : (c - 1 + SLIDES.length) % SLIDES.length);
    }
    setTouchStart(null);
  };

  return (
    <div className="sa-trends-row">
      <div className="sa-carousel-card">
        <div className="sa-carousel-body">

          {/* Header: graph picker (left) + range controls (right) */}
          <div className="sa-carousel-header">

            {/* Graph name dropdown */}
            <div className="sa-graph-picker" onClick={() => setShowGraphMenu(s => !s)}>
              <span className="sa-chart-title" style={{ marginBottom: 0 }}>{slide.title}</span>
              <span style={{ fontSize: 18, color: "#D4AF37", opacity: 0.85, lineHeight: 1, marginLeft: 3, flexShrink: 0 }}>▾</span>
              {showGraphMenu && (
                <>
                  <div className="sa-graph-backdrop" onClick={e => { e.stopPropagation(); setShowGraphMenu(false); }} />
                  <div className="sa-graph-menu">
                    {SLIDES.map((s, i) => (
                      <button key={i}
                        className={`sa-graph-option${i === cur ? " active" : ""}`}
                        onClick={e => { e.stopPropagation(); setCur(i); setShowGraphMenu(false); }}
                      >{s.title}</button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Date range controls — all inline */}
            <div className="sa-range-controls">
              {([7, 14, 30] as const).map(d => (
                <button key={d}
                  className={`sa-vt-btn${!customRange && preset === d ? " active" : ""}`}
                  onClick={() => selectPreset(d)}
                >{d}d</button>
              ))}
              <div className="sa-range-divider" />
              {showCustom ? (
                <>
                  <input type="date" className="sa-date-input-inline" value={fromInput}
                    onChange={e => setFromInput(e.target.value)} />
                  <span className="sa-date-sep-inline">→</span>
                  <input type="date" className="sa-date-input-inline" value={toInput}
                    onChange={e => setToInput(e.target.value)} />
                  <button className="sa-range-apply-inline"
                    onClick={applyCustomRange}
                    disabled={!fromInput || !toInput || fetching}
                  >{fetching ? "…" : "Apply"}</button>
                  <button className="sa-range-clear"
                    onClick={() => { setShowCustom(false); clearCustom(); }}
                  >✕</button>
                </>
              ) : (
                <button
                  className={`sa-vt-btn${customRange ? " active" : ""}`}
                  onClick={openCustom}
                >Custom</button>
              )}
            </div>
          </div>

          <div className="sa-chart-sub">{viewLabel} · {slide.group}</div>

          {/* Chart */}
          <div
            className="sa-chart-area"
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            {renderSlide(cur)}
          </div>
          <div className="sa-chart-note">{NOTES[cur]}</div>
        </div>
      </div>

      <div className="sa-meter-stack" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <OperationalMeterChart
          title="Water consumption"
          sub="Today · litres"
          data={waterSeries}
          barUnit="litres"
          cumUnit="L"
          note="Meter reads in 10 L increments"
        />
        <OperationalMeterChart
          title="Feed auger"
          sub="Today · raw pulses"
          data={feedSeries}
          barUnit="pulses"
          cumUnit=""
          note="Raw pulses — uncalibrated"
        />
      </div>
    </div>
  );
}
