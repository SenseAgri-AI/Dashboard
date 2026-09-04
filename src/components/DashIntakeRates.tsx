"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { SparklinePoint } from "./DashEnvCol";

const INK = "#002E35";
const TEAL = "#2A8E9A";
const NAVY = "#2B3F66";
const GREEN = "#16A34A";
const SAST_OFFSET_MS = 2 * 3_600_000;

function todaySast(points: SparklinePoint[]): SparklinePoint[] {
  const today = new Date(Date.now() + SAST_OFFSET_MS).toISOString().slice(0, 10);
  return points.filter((point) => {
    const time = new Date(point.time).getTime();
    return Number.isFinite(time) && new Date(time + SAST_OFFSET_MS).toISOString().slice(0, 10) === today;
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-ZA", { timeZone: "Africa/Johannesburg", hour: "2-digit", minute: "2-digit", hour12: false });
}

function sampleFeedEvents(): SparklinePoint[] {
  const today = new Date(Date.now() + SAST_OFFSET_MS).toISOString().slice(0, 10);
  const point = (time: string, value: number): SparklinePoint => ({ time: new Date(`${today}T${time}:00+02:00`).toISOString(), value });
  return [point("05:30", 0), point("06:00", 34), point("06:30", 82), point("07:00", 18), point("10:30", 0), point("11:00", 57), point("11:30", 28), point("15:30", 0), point("16:00", 71), point("16:30", 22), point("18:00", 0)];
}

function RateTooltip({ active, payload, label, unit }: { active?: boolean; payload?: { value?: number }[]; label?: string; unit: string }) {
  if (!active || !payload?.length || payload[0].value == null) return null;
  return (
    <div style={{ background: INK, color: "#fff", padding: "6px 8px", fontSize: 9.5 }}>
      <div style={{ color: "rgba(255,255,255,0.58)", marginBottom: 2 }}>{label}</div>
      <strong>{Math.round(payload[0].value * 10) / 10} {unit}</strong>
    </div>
  );
}

function RateChart({ points, color, unit, height, bars = false }: { points: SparklinePoint[]; color: string; unit: string; height: number; bars?: boolean }) {
  const data = points.map((point) => ({ time: formatTime(point.time), rate: point.value }));
  if (data.length < 2) return <div style={{ height, display: "grid", placeItems: "center", color: "var(--t3)", fontSize: 11 }}>Waiting for today’s meter history…</div>;
  if (bars) {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 10, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid stroke="#E6EBEB" vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="time" tick={{ fontSize: 8.5, fill: "#5A6A6C" }} tickLine={false} axisLine={false} minTickGap={32} />
          <YAxis tick={{ fontSize: 8.5, fill: "#5A6A6C" }} tickLine={false} axisLine={false} width={44} tickFormatter={(value) => `${Math.round(value)}`} />
          <Tooltip content={<RateTooltip unit={unit} />} cursor={{ fill: `${color}0D` }} />
          <Bar dataKey="rate" fill={color} radius={[3, 3, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 10, right: 8, bottom: 0, left: -12 }}>
        <defs>
          <linearGradient id={`intake-${color.slice(1)}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.28} />
            <stop offset="95%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#E6EBEB" vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="time" tick={{ fontSize: 8.5, fill: "#5A6A6C" }} tickLine={false} axisLine={false} minTickGap={38} />
        <YAxis tick={{ fontSize: 8.5, fill: "#5A6A6C" }} tickLine={false} axisLine={false} width={44} tickFormatter={(value) => `${Math.round(value)}`} />
        <Tooltip content={<RateTooltip unit={unit} />} cursor={{ stroke: color, strokeOpacity: 0.35 }} />
        <Area type="monotone" dataKey="rate" stroke={color} strokeWidth={2} fill={`url(#intake-${color.slice(1)})`} dot={false} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function RateCard({ title, subtitle, points, unit, totalUnit, color, height, note, bars = false, sample = false, totalLabel = "Today" }: {
  title: string; subtitle: string; points: SparklinePoint[]; unit: string; totalUnit: string; color: string; height: number; note?: string; bars?: boolean; sample?: boolean; totalLabel?: string;
}) {
  const latest = bars ? [...points].reverse().find((point) => point.value > 0)?.value ?? null : points.at(-1)?.value ?? null;
  const total = points.reduce((sum, point) => sum + point.value, 0);
  return (
    <article style={{ background: "#fff", border: "1px solid rgba(0,0,0,0.07)", boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)", padding: "12px 14px 9px", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontFamily: "var(--font-d)", fontSize: 14, fontWeight: 800, color: INK }}>{title}</div>
          <div style={{ fontSize: 9.5, color: "var(--t3)", marginTop: 2 }}>{subtitle}</div>
        </div>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 8.5, fontWeight: 800, color: sample ? "#D97706" : GREEN }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: sample ? "#D97706" : GREEN }} /> {sample ? "SAMPLE EVENTS" : "LIVE METER"}</span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 5, marginTop: 12 }}>
        <strong style={{ fontFamily: "var(--font-d)", fontSize: 27, lineHeight: 1, color: INK }}>{latest == null ? "—" : Math.round(latest * 10) / 10}</strong>
        <span style={{ fontSize: 10, fontWeight: 700, color: "var(--t3)" }}>{unit}</span>
        <span style={{ marginLeft: "auto", fontSize: 9.5, color: "var(--t3)" }}>{totalLabel} <strong style={{ color }}>{Math.round(total).toLocaleString("en-ZA")} {totalUnit}</strong></span>
      </div>
      <RateChart points={points} color={color} unit={unit} height={height} bars={bars} />
      {note && <div style={{ fontSize: 8.5, color: "var(--t3)", borderTop: "1px solid var(--divider)", paddingTop: 7, marginTop: 3 }}>{note}</div>}
    </article>
  );
}

export default function DashIntakeRates({ water, feed, narrow = false }: { water: SparklinePoint[]; feed: SparklinePoint[]; narrow?: boolean }) {
  const waterToday = todaySast(water);
  const liveFeedToday = todaySast(feed).filter((point) => point.value > 0);
  const feedIsSample = liveFeedToday.length === 0;
  const feedToday = feedIsSample ? sampleFeedEvents() : todaySast(feed);
  return (
    <section aria-label="Daily feed and water intake rates">
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <div>
          <span style={{ fontFamily: "var(--font-d)", fontWeight: 800, fontSize: 15, color: "var(--primary)" }}>Today’s intake monitoring</span>
          <span style={{ fontSize: 10, color: "var(--t3)", marginLeft: 8 }}>Current SAST farm day</span>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 10 }}>
        <RateCard title="Water drinking rate" subtitle="How quickly the flock is drinking through the day" points={waterToday} unit="L / 30 min" totalUnit="L" color={TEAL} height={narrow ? 145 : 165} />
        <RateCard title="Gantry refill events" subtitle="When the auger ran and replenished the gantry" points={feedToday} unit="pulse volume" totalUnit="pulses" totalLabel="Event volume" color={NAVY} height={narrow ? 145 : 165} bars sample={feedIsSample} note={feedIsSample ? "Illustrative auger events because the feed meter has not reported activity." : "Bars represent gantry refill events—not direct bird consumption."} />
      </div>
    </section>
  );
}
