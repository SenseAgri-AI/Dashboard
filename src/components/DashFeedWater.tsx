"use client";

import { Area, AreaChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import DashSiloLevels, { type SiloHistoryPoint, type SiloLevelsData } from "./DashSiloLevels";
import type { SparklinePoint } from "./DashEnvCol";

const INK = "#002E35";
const TEAL = "#2A8E9A";
const NAVY = "#2B3F66";
const GREEN = "#16A34A";
const SILO_COLORS = [NAVY, "#2A8E9A"];
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;

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

function dateTimeLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });
}

function todaySast(points: SparklinePoint[]): SparklinePoint[] {
  const today = new Date(Date.now() + SAST_OFFSET_MS).toISOString().slice(0, 10);
  return points.filter((point) => {
    const timestamp = new Date(point.time).getTime();
    return Number.isFinite(timestamp) && new Date(timestamp + SAST_OFFSET_MS).toISOString().slice(0, 10) === today;
  });
}

function latestRefill(history: SiloHistoryPoint[]): SiloHistoryPoint | null {
  let refill: SiloHistoryPoint | null = null;
  for (let index = 1; index < history.length; index++) {
    const rise = history[index].fillPercent - history[index - 1].fillPercent;
    if (rise >= 5) refill = history[index];
  }
  return refill;
}

function SiloTooltip(props: { active?: boolean; label?: number; payload?: Array<{ name?: string; value?: number; color?: string }> }) {
  if (!props.active || !props.payload?.length || props.label == null) return null;
  return (
    <div style={{ background: INK, color: "#fff", borderRadius: 6, padding: "7px 9px", fontSize: 10 }}>
      <div style={{ color: "rgba(255,255,255,0.6)", marginBottom: 3 }}>{dateTimeLabel(props.label)}</div>
      {props.payload.filter((item) => item.value != null).map((item) => <div key={item.name} style={{ color: item.color }}><strong>{item.name}: {Math.round(item.value!).toLocaleString("en-ZA")} mm</strong></div>)}
    </div>
  );
}

function WaterTooltip(props: { active?: boolean; label?: number; payload?: Array<{ value?: number }> }) {
  const value = props.payload?.[0]?.value;
  if (!props.active || props.label == null || value == null) return null;
  return <div style={{ background: INK, color: "#fff", borderRadius: 6, padding: "7px 9px", fontSize: 10 }}><div style={{ color: "rgba(255,255,255,0.6)", marginBottom: 3 }}>{timeLabel(props.label)}</div><strong>{Math.round(value * 10) / 10} L / 30 min</strong></div>;
}

function buildSiloTimeline(data: SiloLevelsData | null) {
  const silos = data?.silos ?? [];
  return silos.flatMap((silo, siloIndex) => silo.history.map((point) => ({ t: new Date(point.time).getTime(), [`silo${siloIndex}`]: point.distanceMm })))
    .filter((event) => Number.isFinite(event.t))
    .sort((a, b) => a.t - b.t);
}

function SiloHistoryCard({ data, height }: { data: SiloLevelsData | null; height: number }) {
  const silos = data?.silos ?? [];
  const timeline = buildSiloTimeline(data);
  const refillTimes = silos.map((silo) => latestRefill(silo.history));
  const distances = silos.flatMap((silo) => silo.history.map((point) => point.distanceMm));
  const distanceMin = distances.length ? Math.min(...distances) : 1000;
  const distanceMax = distances.length ? Math.max(...distances) : 3800;
  const distancePad = Math.max(150, (distanceMax - distanceMin) * 0.12);
  const distanceDomain: [number, number] = [Math.max(0, Math.floor((distanceMin - distancePad) / 100) * 100), Math.ceil((distanceMax + distancePad) / 100) * 100];
  return (
    <article style={cardStyle}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div><div style={{ fontFamily: "var(--font-d)", fontSize: 15, fontWeight: 800, color: INK }}>Radar head space over time</div><div style={{ fontSize: 9.5, color: "var(--t3)", marginTop: 2 }}>Actual sensor samples · a larger head space means less feed remains</div></div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {silos.map((silo, index) => <span key={silo.deviceId} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 9.5, color: "var(--t2)", fontWeight: 700 }}><span style={{ width: 9, height: 3, borderRadius: 2, background: SILO_COLORS[index] }} />Silo {index + 1}</span>)}
        </div>
      </div>
      {timeline.length < 1 ? (
        <div style={{ height, display: "grid", placeItems: "center", color: "var(--t3)", fontSize: 11 }}>Waiting for radar history.</div>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <LineChart data={timeline} margin={{ top: 16, right: 12, bottom: 0, left: 4 }}>
            <CartesianGrid stroke="#E6EBEB" vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={dateTimeLabel} tick={{ fontSize: 8.5, fill: "#5A6A6C" }} tickLine={false} axisLine={false} minTickGap={54} />
            <YAxis domain={distanceDomain} reversed tickFormatter={(value) => `${Math.round(value).toLocaleString("en-ZA")}`} tick={{ fontSize: 8.5, fill: "#5A6A6C" }} tickLine={false} axisLine={false} width={56} label={{ value: "mm", angle: -90, position: "insideLeft", offset: 14, style: { fontSize: 8.5, fill: "#5A6A6C", fontWeight: 700 } }} />
            <Tooltip content={<SiloTooltip />} cursor={{ stroke: TEAL, strokeOpacity: 0.35 }} />
            {refillTimes.map((refill, index) => refill && <ReferenceLine key={`${refill.time}-${index}`} x={new Date(refill.time).getTime()} stroke={SILO_COLORS[index]} strokeDasharray="3 3" strokeOpacity={0.5} label={{ value: `S${index + 1} fill`, position: "insideTopRight", fontSize: 8, fill: SILO_COLORS[index] }} />)}
            {silos.map((silo, index) => <Line key={silo.deviceId} type="monotone" dataKey={`silo${index}`} name={`Silo ${index + 1}`} stroke={SILO_COLORS[index]} strokeWidth={2.2} dot={{ r: 4, fill: SILO_COLORS[index], stroke: "#fff", strokeWidth: 1.5 }} activeDot={{ r: 5 }} connectNulls isAnimationActive={false} />)}
          </LineChart>
        </ResponsiveContainer>
      )}
      {silos.length > 0 && <div style={{ borderTop: "1px solid var(--divider)", paddingTop: 7, display: "flex", gap: 14, flexWrap: "wrap" }}>
        {silos.map((silo, index) => {
          const refill = refillTimes[index];
          const latest = silo.history.at(-1);
          const sampleCount = silo.history.length;
          return <span key={silo.deviceId} style={{ fontSize: 9.5, color: "var(--t3)" }}><strong style={{ color: SILO_COLORS[index] }}>Silo {index + 1} · {silo.distanceMm.toLocaleString("en-ZA")} mm</strong>{latest ? ` · last sample ${dateTimeLabel(new Date(latest.time).getTime())}` : ""}{` · ${sampleCount} sample${sampleCount === 1 ? "" : "s"}`}{refill ? ` · refill detected ${dateTimeLabel(new Date(refill.time).getTime())}` : sampleCount > 1 ? " · no refill detected" : " · trend unavailable"}</span>;
        })}
      </div>}
    </article>
  );
}

function WaterRateCard({ points, height }: { points: SparklinePoint[]; height: number }) {
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
            <Tooltip content={<WaterTooltip />} cursor={{ stroke: TEAL, strokeOpacity: 0.35 }} />
            <Area type="monotone" dataKey="value" stroke={TEAL} strokeWidth={2.2} fill="url(#water-rate-fill)" dot={false} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </article>
  );
}

export default function DashFeedWater({ silos, water, narrow = false }: { silos: SiloLevelsData | null; water: SparklinePoint[]; narrow?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <DashSiloLevels data={silos} narrow={narrow} />
      <section aria-label="Feed and water history">
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10, flexWrap: "wrap" }}><span style={{ fontFamily: "var(--font-d)", fontWeight: 800, fontSize: 15, color: "var(--primary)" }}>Consumption history</span><span style={{ fontSize: 10, color: "var(--t3)" }}>Confirm stock is falling at the expected rate</span></div>
        <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 12 }}>
          <SiloHistoryCard data={silos} height={narrow ? 160 : 190} />
          <WaterRateCard points={water} height={narrow ? 160 : 190} />
        </div>
      </section>
    </div>
  );
}
