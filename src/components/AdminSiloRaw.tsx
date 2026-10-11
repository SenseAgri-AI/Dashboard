"use client";

import { useEffect, useState } from "react";
import { CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";

// Admin: every silo radar reading (before the dashboard's filters), coloured by radar signal strength —
// orange for a weaker echo, blue for a stronger one. No-echo placeholders (signal exactly 0 with a
// -3 mm distance) are drawn as a dark cross because their 0 is not a real signal.

type Reading = { time: string; distanceMm: number; signalDb: number | null };
type RawData = { days: number; devices: { deviceId: string; readings: Reading[] }[]; filters: { minMm: number; maxMm: number } };
type Point = { t: number; m: number; mm: number; signal: number | null; noEcho: boolean; status: string };

const INK = "#002E35";
const WEAK = [235, 104, 52];    // #eb6834, orange
const MID = [201, 206, 208];    // #c9ced0, neutral
const STRONG = [42, 120, 214];  // #2a78d6, blue
const SIGNAL_DOMAIN: [number, number] = [-25, 12]; // dB; covers the readings seen so far
const NO_ECHO = "#1f2a2c";

function signalColour(db: number | null): string {
  if (db == null) return "#9aa8aa";
  const [lo, hi] = SIGNAL_DOMAIN;
  const x = Math.max(0, Math.min(1, (db - lo) / (hi - lo)));
  const [a, b, f] = x < 0.5 ? [WEAK, MID, x / 0.5] : [MID, STRONG, (x - 0.5) / 0.5];
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * f));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

const sast = (t: number) => new Date(t).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
const day = (t: number) => new Date(t).toLocaleDateString("en-ZA", { timeZone: "Africa/Johannesburg", day: "numeric", month: "short" });

function statusOf(r: Reading, filters: RawData["filters"]): string {
  if (r.signalDb === 0) return "Dropped: no echo";
  if (r.distanceMm < filters.minMm) return "Dropped: under 10 cm";
  if (r.distanceMm > filters.maxMm) return `Dropped: over ${filters.maxMm / 1000} m`;
  return "Kept on the dashboard";
}

function PointShape(props: { cx?: number; cy?: number; payload?: Point; fill?: string }) {
  const { cx, cy, payload, fill } = props;
  if (cx == null || cy == null || !payload) return <g />;
  if (payload.noEcho) {
    return <g stroke={NO_ECHO} strokeWidth={2} strokeLinecap="round"><line x1={cx - 4} y1={cy - 4} x2={cx + 4} y2={cy + 4} /><line x1={cx - 4} y1={cy + 4} x2={cx + 4} y2={cy - 4} /></g>;
  }
  return <circle cx={cx} cy={cy} r={4.5} fill={fill} stroke="#fff" strokeWidth={1} />;
}

function RawTip(props: { active?: boolean; payload?: Array<{ payload?: Point }> }) {
  const p = props.payload?.[0]?.payload;
  if (!props.active || !p) return null;
  return (
    <div style={{ background: INK, color: "#fff", borderRadius: 6, padding: "7px 9px", fontSize: 11, lineHeight: 1.5 }}>
      <div style={{ color: "rgba(255,255,255,0.65)" }}>{sast(p.t)} SAST</div>
      <div><strong>{p.mm.toLocaleString("en-ZA")} mm</strong> · signal {p.signal == null ? "—" : `${p.signal.toFixed(1)} dB`}</div>
      <div style={{ color: p.status.startsWith("Kept") ? "#9fe0d8" : "#ffc4a8" }}>{p.status}</div>
    </div>
  );
}

function SiloRawChart({ index, deviceId, readings, filters }: { index: number; deviceId: string; readings: Reading[]; filters: RawData["filters"] }) {
  const points: Point[] = readings.map((r) => ({
    t: Date.parse(r.time), m: r.distanceMm / 1000, mm: r.distanceMm, signal: r.signalDb,
    noEcho: r.signalDb === 0, status: statusOf(r, filters),
  }));
  const dropped = points.filter((p) => !p.status.startsWith("Kept")).length;
  const yMax = Math.max(4, Math.ceil(Math.max(...points.map((p) => p.m)) + 0.5));
  const step = yMax > 8 ? 2 : 1;
  const yTicks = Array.from({ length: Math.floor(yMax / step) + 1 }, (_, i) => i * step);
  return (
    <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,0.07)", borderRadius: 12, padding: "13px 15px 8px", minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
        <div style={{ fontFamily: "var(--font-d)", fontSize: 15, fontWeight: 800, color: INK }}>Silo {index + 1} <span style={{ fontSize: 10, fontWeight: 600, color: "var(--t3)" }}>radar {deviceId}</span></div>
        <div style={{ fontSize: 10.5, color: "var(--t3)" }}>{points.length} readings · {dropped} dropped on the dashboard</div>
      </div>
      <div style={{ width: "100%", height: 250 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 14, right: 14, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="#E6EBEB" vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={(t: number) => day(t)}
              tick={{ fontSize: 9, fill: "#5A6A6C" }} tickLine={false} axisLine={false} minTickGap={40} />
            <YAxis dataKey="m" type="number" domain={[-0.5, yMax]} ticks={yTicks} tickFormatter={(v: number) => `${v} m`}
              tick={{ fontSize: 9, fill: "#5A6A6C" }} tickLine={false} axisLine={false} width={44} />
            <Tooltip content={<RawTip />} cursor={{ stroke: "#2A8E9A", strokeOpacity: 0.3 }} />
            <ReferenceLine y={filters.maxMm / 1000} stroke="#8a9597" strokeDasharray="4 3"
              label={{ value: `${filters.maxMm / 1000} m dashboard limit`, position: "insideTopLeft", fontSize: 9, fill: "#5A6A6C" }} />
            <ReferenceLine y={filters.minMm / 1000} stroke="#8a9597" strokeDasharray="4 3"
              label={{ value: "10 cm", position: "insideBottomLeft", fontSize: 9, fill: "#5A6A6C" }} />
            <Scatter data={points} shape={<PointShape />} isAnimationActive={false}>
              {points.map((p) => <Cell key={`${p.t}-${p.mm}`} fill={signalColour(p.signal)} />)}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function AdminSiloRaw() {
  const [data, setData] = useState<RawData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/admin/silo-raw")
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json().catch(() => ({}))).error ?? "Failed to load"))))
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, []);

  const gradient = `linear-gradient(90deg, rgb(${WEAK.join(",")}), rgb(${MID.join(",")}), rgb(${STRONG.join(",")}))`;
  return (
    <section className="sa-main" style={{ maxWidth: 1100, width: "100%", margin: "0 auto", gap: 12 }} aria-label="Silo radar raw readings">
      <div>
        <div style={{ fontFamily: "var(--font-d)", fontWeight: 800, fontSize: 18, color: INK }}>Silo radar · raw readings</div>
        <div style={{ fontSize: 12, color: "var(--t3)", marginTop: 2 }}>
          {`Every reading from the last ${data?.days ?? 30} days, before the dashboard's filters. Each point is coloured by the radar's signal strength.`}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", fontSize: 11, color: "var(--t2)" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span>Weaker {SIGNAL_DOMAIN[0]} dB</span>
          <span style={{ width: 140, height: 10, borderRadius: 5, background: gradient }} />
          <span>Stronger +{SIGNAL_DOMAIN[1]} dB</span>
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <svg width="12" height="12" aria-hidden><g stroke={NO_ECHO} strokeWidth="2" strokeLinecap="round"><line x1="2" y1="2" x2="10" y2="10" /><line x1="2" y1="10" x2="10" y2="2" /></g></svg>
          No echo (signal exactly 0)
        </span>
      </div>
      {error && <div style={{ color: "var(--danger)", fontSize: 13 }}>{error}</div>}
      {!data && !error && <div style={{ color: "var(--t3)", fontSize: 13 }}>Loading radar readings…</div>}
      {data && data.devices.length === 0 && <div style={{ color: "var(--t3)", fontSize: 13 }}>No silo radar readings in the last {data.days} days.</div>}
      {data?.devices.map((d, i) => <SiloRawChart key={d.deviceId} index={i} deviceId={d.deviceId} readings={d.readings} filters={data.filters} />)}
    </section>
  );
}
