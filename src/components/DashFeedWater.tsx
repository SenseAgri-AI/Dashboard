"use client";

import { useRef, useState } from "react";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import DashSiloLevels, { type SiloDayMedian, type SiloLevelsData } from "./DashSiloLevels";
import type { SparklinePoint } from "./DashEnvCol";
import { withFlockAge } from "@/lib/flockAge";
import { SeriesMark, TIP_BOX, TIP_LABEL, TipRow } from "@/components/ChartTooltip";

const INK = "#002E35";
const TEAL = "#2A8E9A";
const NAVY = "#2B3F66";
const GREEN = "#16A34A";
const SILO_COLORS = [NAVY, "#2A8E9A"];
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const MIN_WINDOW_MS = 3 * DAY_MS;
const PLOT_SIDE_PX = 72; // y-axis width + chart margins, excluded when converting a drag to time

const cardStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid rgba(0,0,0,0.07)",
  borderRadius: 12,
  boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)",
  padding: "13px 15px 10px",
  minWidth: 0,
};

function timeLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("en-ZA", { timeZone: "Africa/Johannesburg", hour: "2-digit", minute: "2-digit", hour12: false });
}

function dateTimeLabel(timestamp: number, house?: { startDate: string; startAgeDays: number } | null): string {
  return withFlockAge(new Date(timestamp).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }), house, timestamp, true);
}

function dayLabel(timestamp: number, house?: { startDate: string; startAgeDays: number } | null): string {
  return withFlockAge(new Date(timestamp).toLocaleDateString("en-ZA", { timeZone: "Africa/Johannesburg", weekday: "short", day: "numeric", month: "short" }), house, timestamp, true);
}

function todaySast(points: SparklinePoint[]): SparklinePoint[] {
  const today = new Date(Date.now() + SAST_OFFSET_MS).toISOString().slice(0, 10);
  return points.filter((point) => {
    const timestamp = new Date(point.time).getTime();
    return Number.isFinite(timestamp) && new Date(timestamp + SAST_OFFSET_MS).toISOString().slice(0, 10) === today;
  });
}

// A refill: the daily median fill rises by at least 5 points from the previous day with readings.
function latestRefill(daily: SiloDayMedian[]): SiloDayMedian | null {
  let refill: SiloDayMedian | null = null;
  for (let index = 1; index < daily.length; index++) {
    if (daily[index].medianFillPercent - daily[index - 1].medianFillPercent >= 5) refill = daily[index];
  }
  return refill;
}

const middayMs = (date: string) => Date.parse(`${date}T12:00:00+02:00`);

type DayRow = { t: number } & Record<string, number | null>;

function SiloTooltip(props: { active?: boolean; label?: number; payload?: Array<{ name?: string; value?: number | null; color?: string; dataKey?: string; payload?: DayRow }>; house?: { startDate: string; startAgeDays: number } | null }) {
  if (!props.active || !props.payload?.length || props.label == null) return null;
  return (
    <div style={TIP_BOX}>
      <div style={TIP_LABEL}>{dayLabel(props.label, props.house)}</div>
      {props.payload.filter((item) => item.value != null).map((item) => {
        const n = item.payload?.[`${item.dataKey}n`];
        return (
          <TipRow key={item.name} mark={<SeriesMark color={item.color ?? INK} />}
            name={`${item.name}${n ? ` · median of ${n} reading${n === 1 ? "" : "s"}` : ""}`}
            value={`${Math.round(item.value!).toLocaleString("en-ZA")} mm`} />
        );
      })}
    </div>
  );
}

function WaterTooltip(props: { active?: boolean; label?: number; payload?: Array<{ value?: number }>; house?: { startDate: string; startAgeDays: number } | null }) {
  const value = props.payload?.[0]?.value;
  if (!props.active || props.label == null || value == null) return null;
  return <div style={TIP_BOX}><div style={TIP_LABEL}>{dateTimeLabel(props.label, props.house)}</div><strong>{Math.round(value * 10) / 10} L / 30 min</strong></div>;
}

// One row per day that has readings (either silo), holding each silo's median for that day.
function buildDailyTimeline(data: SiloLevelsData | null): DayRow[] {
  const silos = data?.silos ?? [];
  const dates = [...new Set(silos.flatMap((silo) => (silo.daily ?? []).map((day) => day.date)))].sort();
  return dates.map((date) => {
    const row: DayRow = { t: middayMs(date) };
    silos.forEach((silo, index) => {
      const day = silo.daily?.find((d) => d.date === date);
      row[`silo${index}`] = day?.medianMm ?? null;
      row[`silo${index}n`] = day?.readings ?? null;
    });
    return row;
  });
}

// Keep a [from, to] window inside the data range, preserving its length where possible.
function clampWindow([from, to]: [number, number], min: number, max: number): [number, number] {
  const span = Math.min(Math.max(to - from, MIN_WINDOW_MS), Math.max(max - min, 1));
  const start = Math.max(min, Math.min(from, max - span));
  return [start, start + span];
}

const panButton: React.CSSProperties = {
  minWidth: 30, height: 26, padding: "0 8px", border: "1px solid var(--divider)", borderRadius: 6, background: "#fff",
  color: INK, fontSize: 10.5, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-s)",
};

function SiloHistoryCard({ data, height, house }: { data: SiloLevelsData | null; height: number; house?: { startDate: string; startAgeDays: number } | null }) {
  const silos = data?.silos ?? [];
  const timeline = buildDailyTimeline(data);
  const [view, setView] = useState<[number, number] | null>(null); // null = all 30 days
  const plotRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ x: number; window: [number, number] } | null>(null);
  const [dragging, setDragging] = useState(false);
  // Half a day of margin either side so the first and last daily points are not clipped.
  const first = (timeline[0]?.t ?? 0) - DAY_MS / 2;
  const last = (timeline.at(-1)?.t ?? 0) + DAY_MS / 2;
  // Every day stays in the chart; the x-axis window only clips the drawing, so lines run to the edges.
  const windowMs = clampWindow(view ?? [first, last], first, last);
  const xTicks = Array.from({ length: 5 }, (_, i) => Math.round(windowMs[0] + (i / 4) * (windowMs[1] - windowMs[0])));
  const zoom = (factor: number) => {
    const mid = (windowMs[0] + windowMs[1]) / 2, half = ((windowMs[1] - windowMs[0]) * factor) / 2;
    setView(clampWindow([mid - half, mid + half], first, last));
  };
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    dragRef.current = { x: event.clientX, window: windowMs };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const width = (plotRef.current?.getBoundingClientRect().width ?? 0) - PLOT_SIDE_PX;
    if (!drag || width <= 0) return;
    const shift = (-(event.clientX - drag.x) / width) * (drag.window[1] - drag.window[0]);
    setView(clampWindow([drag.window[0] + shift, drag.window[1] + shift], first, last));
  };
  const endDrag = () => { dragRef.current = null; setDragging(false); };
  const refills = silos.map((silo) => (silo.lastRefillDate !== undefined
    ? (silo.lastRefillDate ? { date: silo.lastRefillDate } : null)
    : latestRefill(silo.daily ?? [])));
  const distances = silos.flatMap((silo) => (silo.daily ?? []).map((day) => day.medianMm));
  const distanceMin = distances.length ? Math.min(...distances) : 1000;
  const distanceMax = distances.length ? Math.max(...distances) : 3800;
  const distancePad = Math.max(150, (distanceMax - distanceMin) * 0.12);
  const lowMm = data?.low?.distanceMm ?? null;
  const distanceDomain: [number, number] = [Math.max(0, Math.floor((distanceMin - distancePad) / 100) * 100), Math.ceil((Math.max(distanceMax, (lowMm ?? 0) + 100) + distancePad) / 100) * 100];
  return (
    <article style={cardStyle}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div><div style={{ fontFamily: "var(--font-d)", fontSize: 15, fontWeight: 800, color: INK }}>Radar head space over time</div><div style={{ fontSize: 9.5, color: "var(--t3)", marginTop: 2 }}>Last 30 days · one point per day: the median of that day&apos;s readings · zoom in, then drag to pan</div></div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {silos.map((silo, index) => <span key={silo.deviceId} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 9.5, color: "var(--t2)", fontWeight: 700 }}><span style={{ width: 9, height: 3, borderRadius: 2, background: SILO_COLORS[index] }} />Silo {index + 1}</span>)}
        </div>
      </div>
      {timeline.length < 1 ? (
        <div style={{ height, display: "grid", placeItems: "center", color: "var(--t3)", fontSize: 11 }}>Waiting for radar history.</div>
      ) : (
        <>
        <div ref={plotRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}
          style={{ touchAction: "pan-y", cursor: dragging ? "grabbing" : "grab", userSelect: "none" }}>
        <ResponsiveContainer width="100%" height={height}>
          <LineChart data={timeline} margin={{ top: 16, right: 12, bottom: 0, left: 4 }}>
            <CartesianGrid stroke="#E6EBEB" vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="t" type="number" scale="time" domain={windowMs} allowDataOverflow ticks={xTicks} tickFormatter={(t) => dayLabel(Number(t), house)} tick={{ fontSize: 8.5, fill: "#5A6A6C" }} tickLine={false} axisLine={false} minTickGap={54} />
            <YAxis domain={distanceDomain} reversed tickFormatter={(value) => `${Math.round(value).toLocaleString("en-ZA")}`} tick={{ fontSize: 8.5, fill: "#5A6A6C" }} tickLine={false} axisLine={false} width={56} label={{ value: "mm", angle: -90, position: "insideLeft", offset: 14, style: { fontSize: 8.5, fill: "#5A6A6C", fontWeight: 700 } }} />
            <Tooltip content={<SiloTooltip house={house} />} cursor={{ stroke: TEAL, strokeOpacity: 0.35 }} />
            {lowMm != null && <ReferenceLine y={lowMm} stroke="#DC2626" strokeDasharray="5 4" strokeOpacity={0.8} label={{ value: `Low · ${lowMm.toLocaleString("en-ZA")} mm`, position: "insideBottomLeft", fontSize: 8, fill: "#DC2626" }} />}
            {refills.map((refill, index) => refill && <ReferenceLine key={`${refill.date}-${index}`} x={middayMs(refill.date)} stroke={SILO_COLORS[index]} strokeDasharray="3 3" strokeOpacity={0.5} label={{ value: `S${index + 1} fill`, position: "insideTopRight", fontSize: 8, fill: SILO_COLORS[index] }} />)}
            {silos.map((silo, index) => <Line key={silo.deviceId} type="linear" dataKey={`silo${index}`} name={`Silo ${index + 1}`} stroke={SILO_COLORS[index]} strokeWidth={2.2} dot={{ r: 3.5, fill: SILO_COLORS[index], stroke: "#fff", strokeWidth: 1.5 }} activeDot={{ r: 5 }} connectNulls isAnimationActive={false} />)}
          </LineChart>
        </ResponsiveContainer>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", margin: "4px 0 8px" }}>
          <span style={{ fontSize: 9.5, color: "var(--t3)" }}>
            Showing {dayLabel(windowMs[0])} – {dayLabel(windowMs[1])}
            {data?.validRangeMm && ` · readings under ${data.validRangeMm.min / 10} cm, over ${data.validRangeMm.max / 1000} m or with no echo are left out`}
          </span>
          <div style={{ display: "flex", gap: 4 }}>
            <button type="button" aria-label="Zoom out" onClick={() => zoom(2)} style={panButton}>−</button>
            <button type="button" aria-label="Zoom in" onClick={() => zoom(0.5)} style={panButton}>+</button>
            <button type="button" onClick={() => setView(clampWindow([last - WEEK_MS, last], first, last))} style={panButton}>Latest week</button>
            <button type="button" onClick={() => setView(null)} style={panButton}>All 30 days</button>
          </div>
        </div>
        </>
      )}
      {silos.length > 0 && <div style={{ borderTop: "1px solid var(--divider)", paddingTop: 7, display: "flex", gap: 14, flexWrap: "wrap" }}>
        {silos.map((silo, index) => {
          const refill = refills[index];
          const latest = silo.history.at(-1);
          const sampleCount = silo.history.length;
          const days = silo.daily?.length ?? 0;
          return <span key={silo.deviceId} style={{ fontSize: 9.5, color: "var(--t3)" }}>{silo.low && lowMm != null
            ? <strong style={{ color: "#DC2626" }}>Silo {index + 1} · LOW{silo.lowSince ? ` since ${dateTimeLabel(new Date(silo.lowSince).getTime())}` : ""} · stays low until refilled</strong>
            : <strong style={{ color: SILO_COLORS[index] }}>Silo {index + 1} · {(silo.medianMm ?? silo.distanceMm).toLocaleString("en-ZA")} mm (median, last 24 h)</strong>}{latest ? ` · last reading ${dateTimeLabel(new Date(latest.time).getTime())}` : ""}{` · ${sampleCount} reading${sampleCount === 1 ? "" : "s"} on ${days} day${days === 1 ? "" : "s"}`}{refill ? ` · refill detected ${dayLabel(middayMs(refill.date))}` : days > 1 ? " · no refill detected" : " · trend unavailable"}</span>;
        })}
      </div>}
    </article>
  );
}

function WaterRateCard({ points, height, house }: { points: SparklinePoint[]; height: number; house?: { startDate: string; startAgeDays: number } | null }) {
  const today = todaySast(points).map((point) => ({ t: new Date(point.time).getTime(), value: point.value })).filter((point) => Number.isFinite(point.t));
  const total = today.reduce((sum, point) => sum + point.value, 0);
  const latest = today.at(-1)?.value ?? null;
  return (
    <article style={cardStyle}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div><div style={{ fontFamily: "var(--font-d)", fontSize: 15, fontWeight: 800, color: INK }}>Drinking rate today</div><div style={{ fontSize: 9.5, color: "var(--t3)", marginTop: 2 }}>Water used by the flock in each 30-minute period</div></div>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 8.5, fontWeight: 800, color: GREEN }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: GREEN }} /> LIVE METER</span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 5, marginTop: 12 }}>
        <strong style={{ fontFamily: "var(--font-d)", fontSize: 27, lineHeight: 1, color: INK }}>{latest == null ? "—" : Math.round(latest * 10) / 10}</strong>
        <span style={{ fontSize: 10, fontWeight: 700, color: "var(--t3)" }}>L / 30 min</span>
        <span style={{ marginLeft: "auto", fontSize: 9.5, color: "var(--t3)" }}>Today <strong style={{ color: TEAL }}>{Math.round(total).toLocaleString("en-ZA")} L</strong></span>
      </div>
      {today.length < 2 ? (
        <div style={{ height, display: "grid", placeItems: "center", color: "var(--t3)", fontSize: 11 }}>Waiting for today’s water-meter history.</div>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <AreaChart data={today} margin={{ top: 12, right: 10, bottom: 0, left: -8 }}>
            <defs><linearGradient id="water-rate-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={TEAL} stopOpacity={0.28} /><stop offset="95%" stopColor={TEAL} stopOpacity={0.02} /></linearGradient></defs>
            <CartesianGrid stroke="#E6EBEB" vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={timeLabel} tick={{ fontSize: 8.5, fill: "#5A6A6C" }} tickLine={false} axisLine={false} minTickGap={38} />
            <YAxis tick={{ fontSize: 8.5, fill: "#5A6A6C" }} tickLine={false} axisLine={false} width={42} tickFormatter={(value) => `${Math.round(value)}`} />
            <Tooltip content={<WaterTooltip house={house} />} cursor={{ stroke: TEAL, strokeOpacity: 0.35 }} />
            <Area type="monotone" dataKey="value" stroke={TEAL} strokeWidth={2.2} fill="url(#water-rate-fill)" dot={false} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </article>
  );
}

export default function DashFeedWater({ silos, water, narrow = false, house = null }: { silos: SiloLevelsData | null; water: SparklinePoint[]; narrow?: boolean; house?: { startDate: string; startAgeDays: number } | null }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <DashSiloLevels data={silos} narrow={narrow} />
      <section aria-label="Feed and water history">
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10, flexWrap: "wrap" }}><span style={{ fontFamily: "var(--font-d)", fontWeight: 800, fontSize: 15, color: "var(--primary)" }}>Consumption history</span><span style={{ fontSize: 10, color: "var(--t3)" }}>Confirm stock is falling at the expected rate</span></div>
        <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 12 }}>
          <SiloHistoryCard data={silos} height={narrow ? 160 : 190} house={house} />
          <WaterRateCard points={water} height={narrow ? 160 : 190} house={house} />
        </div>
      </section>
    </div>
  );
}
