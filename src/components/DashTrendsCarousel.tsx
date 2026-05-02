"use client";

import { useState, useEffect, useCallback } from "react";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, ReferenceArea, ReferenceLine,
  ResponsiveContainer, Cell, Tooltip,
} from "recharts";
import type { ProductionData } from "./DashMetricCol";

const TEAL  = "#2A8E9A";
const GOLD  = "#D4AF37";
const T3    = "#6B7C80";
const GRID  = "rgba(0,0,0,0.05)";
const TICK  = { fontSize: 9, fill: T3, fontFamily: "Inter,sans-serif" } as const;
const AXIS_LINE = { stroke: "rgba(0,0,0,0.09)" };

const SLIDES = [
  { title: "Egg count",       sub: "7-day · production",     note: "Today highlighted in teal" },
  { title: "Revenue",         sub: "7-day · financial",       note: "7-day revenue trend" },
  { title: "Hen-Day %",       sub: "7-day · welfare derived", note: "Shaded band = normal zone 85–98%" },
  { title: "Feed conversion", sub: "7-day · pulses/egg",      note: "Uncalibrated — lower is better. Converts to kg/egg once auger calibrated" },
  { title: "Feed per day",    sub: "7-day · raw pulses",      note: "Raw feed auger pulses — uncalibrated. Validates sensor activity per day" },
];

function dayLabel(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][d.getDay()];
}

function PendingChart({ message }: { message: string }) {
  return (
    <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <span style={{ fontSize: 12, color: T3, fontFamily: "Inter,sans-serif" }}>{message}</span>
    </div>
  );
}

// Custom tooltip for carousel charts
function ChartTooltip({ active, payload, label, formatter }: {
  active?: boolean;
  payload?: { value: number; color: string }[];
  label?: string;
  formatter?: (v: number) => string;
}) {
  if (!active || !payload?.length) return null;
  const val = payload[0].value;
  return (
    <div style={{
      background: "#002E35", color: "#fff", fontSize: 10,
      padding: "4px 8px", fontFamily: "Inter,sans-serif",
      border: "none", boxShadow: "0 2px 8px rgba(0,0,0,0.18)",
    }}>
      <span style={{ opacity: 0.6, marginRight: 6 }}>{label}</span>
      <strong>{formatter ? formatter(val) : val}</strong>
    </div>
  );
}

interface DashTrendsCarouselProps {
  production: ProductionData | null;
}

export default function DashTrendsCarousel({ production }: DashTrendsCarouselProps) {
  const [cur, setCur] = useState(0);
  const next = useCallback(() => setCur((c) => (c + 1) % SLIDES.length), []);

  useEffect(() => {
    const tmr = setInterval(next, 5000);
    return () => clearInterval(tmr);
  }, [next]);

  const daily = production?.daily ?? [];
  const chartData = daily.map((d, i) => ({
    ...d,
    label: dayLabel(d.date),
    isToday: i === daily.length - 1,
  }));

  function renderSlide(idx: number) {
    if (chartData.length === 0) return <PendingChart message="Loading data…" />;

    switch (idx) {
      // ── Egg count bar chart ──────────────────────────────────────────────
      case 0:
        return (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={AXIS_LINE} />
              <YAxis tick={TICK} tickLine={false} axisLine={false} width={44}
                tickFormatter={v => `${(v / 1000).toFixed(1)}k`} tickCount={4} />
              <Tooltip content={<ChartTooltip formatter={v => `${Math.round(v).toLocaleString()} eggs`} />} cursor={{ fill: "rgba(0,46,53,0.04)" }} />
              <Bar dataKey="eggs" radius={0} isAnimationActive={false}>
                {chartData.map((entry, i) => (
                  <Cell key={i} fill={entry.isToday ? TEAL : "rgba(0,46,53,0.09)"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        );

      // ── Revenue area chart ───────────────────────────────────────────────
      case 1:
        return (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="sa-rev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={GOLD} stopOpacity={0.28} />
                  <stop offset="95%" stopColor={GOLD} stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={AXIS_LINE} />
              <YAxis tick={TICK} tickLine={false} axisLine={false} width={50}
                tickFormatter={v => `R${(v / 1000).toFixed(1)}k`} tickCount={4} />
              <Tooltip content={<ChartTooltip formatter={v => `R ${v.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}`} />} cursor={{ stroke: GOLD, strokeWidth: 1, strokeOpacity: 0.3 }} />
              <Area type="monotone" dataKey="revenue" stroke={GOLD} strokeWidth={2}
                fill="url(#sa-rev)" dot={false} activeDot={{ r: 3, fill: GOLD }} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        );

      // ── HDEP band chart ──────────────────────────────────────────────────
      case 2: {
        const hdepData = chartData.filter(d => d.hdep !== null);
        return (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={hdepData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="sa-hdep" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={TEAL} stopOpacity={0.28} />
                  <stop offset="95%" stopColor={TEAL} stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={GRID} vertical={false} />
              <ReferenceArea y1={85} y2={98} fill={TEAL} fillOpacity={0.08} stroke="none" />
              <ReferenceLine y={85} stroke={TEAL} strokeDasharray="4 3" strokeOpacity={0.35}
                label={{ value: "85%", position: "insideTopRight", fontSize: 8, fill: TEAL, opacity: 0.5 }} />
              <ReferenceLine y={98} stroke={TEAL} strokeDasharray="4 3" strokeOpacity={0.35}
                label={{ value: "98%", position: "insideBottomRight", fontSize: 8, fill: TEAL, opacity: 0.5 }} />
              <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={AXIS_LINE} />
              <YAxis domain={[80, 100]} tick={TICK} tickLine={false} axisLine={false} width={38}
                tickFormatter={v => `${v}%`} tickCount={5} />
              <Tooltip content={<ChartTooltip formatter={v => `${v.toFixed(1)}%`} />} cursor={{ stroke: TEAL, strokeWidth: 1, strokeOpacity: 0.3 }} />
              <Area type="monotone" dataKey="hdep" stroke={TEAL} strokeWidth={2}
                fill="url(#sa-hdep)" dot={false} activeDot={{ r: 3, fill: TEAL }} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        );
      }

      // ── FCR proxy area (dashed) ──────────────────────────────────────────
      case 3: {
        const fcrData = chartData.filter(d => d.fcr !== null);
        if (fcrData.length < 2) return <PendingChart message="Loading feed conversion data…" />;
        return (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={fcrData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="sa-fcr" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={T3} stopOpacity={0.18} />
                  <stop offset="95%" stopColor={T3} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={AXIS_LINE} />
              <YAxis tick={TICK} tickLine={false} axisLine={false} width={38} tickCount={4}
                tickFormatter={v => v.toFixed(1)} />
              <Tooltip content={<ChartTooltip formatter={v => `${v.toFixed(2)} pulses/egg`} />} cursor={{ stroke: T3, strokeWidth: 1, strokeOpacity: 0.3 }} />
              <Area type="monotone" dataKey="fcr" stroke={T3} strokeWidth={2} strokeDasharray="6 3"
                fill="url(#sa-fcr)" dot={false} activeDot={{ r: 3, fill: T3 }} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        );
      }

      // ── Raw feed pulses bar chart ────────────────────────────────────────
      case 4: {
        const feedData = chartData.filter(d => d.feedPulses !== null);
        if (feedData.length === 0) return <PendingChart message="Loading feed data…" />;
        return (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={feedData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={AXIS_LINE} />
              <YAxis tick={TICK} tickLine={false} axisLine={false} width={44}
                tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v}`} tickCount={4} />
              <Tooltip content={<ChartTooltip formatter={v => `${Math.round(v).toLocaleString()} pulses`} />} cursor={{ fill: "rgba(0,46,53,0.04)" }} />
              <Bar dataKey="feedPulses" fill={T3} fillOpacity={0.55} radius={0} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        );
      }

      default:
        return null;
    }
  }

  const slide = SLIDES[cur];

  return (
    <div className="sa-trends-col">
      <div className="sa-col-header">Trends</div>
      <div className="sa-carousel-card">
        <div className="sa-carousel-body">
          <div className="sa-chart-title">{slide.title}</div>
          <div className="sa-chart-sub">{slide.sub}</div>
          <div className="sa-chart-area sa-slide-in" key={cur}>
            {renderSlide(cur)}
          </div>
          <div className="sa-chart-note">{slide.note}</div>
        </div>
        <div className="sa-carousel-footer">
          {SLIDES.map((_, i) => (
            <button key={i} className={`sa-c-dot${i === cur ? " active" : ""}`}
              onClick={() => setCur(i)} aria-label={`Go to slide ${i + 1}`} />
          ))}
        </div>
      </div>
    </div>
  );
}
