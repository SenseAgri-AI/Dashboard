"use client";

import { useEffect, useMemo, useState } from "react";
import { ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { standardHdepForWeek, HEN_STANDARD } from "@/lib/henStandard";
import { withFlockAge } from "@/lib/flockAge";

// Compact Hen-day % (HDEP) and Hen-housed % (HHEP) vs breed-standard projection for one house, to end
// of cycle. Green fill above the standard, red below (like the Analytics section), for hen-day %. Both
// series are bucketed to flock-weeks and averaged so the lines are smooth and render fast (~40–80 points).
// Hen-housed % = eggs against the hens originally housed, so deaths and culls are not taken out.
const TEAL = "#2A8E9A", NAVY = "#2B3F66", STD = "#7A5C00", GREEN = "#166534", DANGER = "#B91C1C";
const AXIS = "#3a4d4f", GRID = "rgba(42,142,154,0.14)", PRIMARY = "#002E35";
const DAY_MS = 86_400_000;
const FIRST_WEEK = HEN_STANDARD[0].week;                         // 18
const END_WEEK = HEN_STANDARD[HEN_STANDARD.length - 1].week;     // 95 (end of cycle)

type House = { id: string; name?: string; startDate: string; startAgeDays: number; startingHens?: number };
type Row = { time: string; hdep: number | null; eggs: number | null };
type Pt = { t: number; actual: number | null; hhep: number | null; standard: number | null; aboveBand?: [number, number]; belowBand?: [number, number] };

// UTC ms at the start of a given flock-week for this house.
const weekToMs = (h: House, week: number) =>
  new Date(`${h.startDate}T00:00:00Z`).getTime() + (week * 7 - h.startAgeDays) * DAY_MS;

// Flock age (in weeks) at an ISO timestamp.
function flockWeekAt(h: House, iso: string): number {
  const start = new Date(`${h.startDate}T00:00:00Z`).getTime();
  const days = h.startAgeDays + Math.floor((new Date(iso).getTime() - start) / DAY_MS);
  return days / 7;
}

// Tooltip text stays white on the dark box; each line's colour sits on a small white chip beside its
// name, so dark lines (navy, brown) stay readable.
const SERIES: { name: string; color: string; dashed: boolean }[] = [
  { name: "Hen-day", color: TEAL, dashed: false },
  { name: "Hen-housed", color: NAVY, dashed: false },
  { name: "Breed standard", color: STD, dashed: true },
];

function LineChip({ color, dashed }: { color: string; dashed: boolean }) {
  return (
    <span style={{ display: "inline-flex", background: "#fff", borderRadius: 3, padding: "2px 3px", flexShrink: 0 }}>
      <svg width="14" height="6" aria-hidden><line x1="0" y1="3" x2="14" y2="3" stroke={color} strokeWidth="2.5" strokeDasharray={dashed ? "4 2" : undefined} /></svg>
    </span>
  );
}

function HdepTip({ active, payload, label, house }: { active?: boolean; payload?: Array<{ name?: string; value?: number | null }>; label?: number; house: House }) {
  if (!active || !payload?.length || label == null) return null;
  const values = new Map(payload.map((p) => [p.name, p.value]));
  return (
    <div style={{ background: PRIMARY, border: `1px solid ${TEAL}`, padding: "6px 9px", fontSize: 12, color: "#fff", lineHeight: 1.6 }}>
      <div style={{ color: "#8fd0d8" }}>{withFlockAge(new Date(Number(label)).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }), house, Number(label))}</div>
      {SERIES.filter((s) => values.get(s.name) != null).map((s) => (
        <div key={s.name} style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <LineChip color={s.color} dashed={s.dashed} />
          <span>{s.name}</span>
          <strong style={{ marginLeft: "auto", paddingLeft: 10 }}>{Number(values.get(s.name)).toFixed(1)}%</strong>
        </div>
      ))}
    </div>
  );
}

const fmtDate = (ms: number, house: House) => withFlockAge(new Date(ms).toLocaleDateString("en-ZA", { month: "short", year: "2-digit" }), house, ms, true);

export default function HouseHdepChart({ house, height = 150 }: { house: House; height?: number }) {
  const [raw, setRaw] = useState<Row[] | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(house.startDate)) { setRaw([]); return; }
    let alive = true;
    const now = Date.now();
    const q = new URLSearchParams({
      metrics: "hdep,eggs_total", house: house.id,
      from: `${house.startDate}T00:00:00Z`, to: new Date(now).toISOString(),
    });
    fetch(`/api/analytics/series?${q}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("fetch"))))
      .then((d: { series?: { time: string; hdep?: number | null; eggs_total?: number | null }[] }) => {
        if (!alive) return;
        setRaw((d.series ?? []).map((s) => ({
          time: String(s.time),
          hdep: typeof s.hdep === "number" ? s.hdep : null,
          eggs: typeof s.eggs_total === "number" ? s.eggs_total : null,
        })));
      })
      .catch(() => { if (alive) setErr(true); });
    return () => { alive = false; };
  }, [house.id, house.startDate]);

  const pts = useMemo<Pt[]>(() => {
    // Average daily HDEP and HHEP into flock-weeks.
    const hens = house.startingHens ?? 0;
    const byWeek = new Map<number, number[]>();
    const hhepByWeek = new Map<number, number[]>();
    for (const r of raw ?? []) {
      const w = Math.floor(flockWeekAt(house, r.time));
      if (r.hdep != null) byWeek.set(w, [...(byWeek.get(w) ?? []), r.hdep]);
      if (r.hdep != null && r.eggs != null && hens > 0) hhepByWeek.set(w, [...(hhepByWeek.get(w) ?? []), (r.eggs / hens) * 100]);
    }
    const mean = (a: number[] | undefined) =>
      a && a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : null;
    const avg = (w: number) => mean(byWeek.get(w));
    const startWeek = Math.max(FIRST_WEEK, Math.floor(house.startAgeDays / 7));
    const out: Pt[] = [];
    for (let w = startWeek; w <= END_WEEK; w++) {
      const standard = standardHdepForWeek(w);
      const actual = avg(w);
      const p: Pt = { t: weekToMs(house, w), actual, hhep: mean(hhepByWeek.get(w)), standard };
      if (actual != null && standard != null) {
        p.aboveBand = [standard, Math.max(actual, standard)];
        p.belowBand = [Math.min(actual, standard), standard];
      }
      out.push(p);
    }
    return out;
  }, [raw, house]);

  const legend: [string, string, boolean][] = [["Hen-day", TEAL, false], ["Hen-housed", NAVY, false], ["Breed standard", STD, true]];
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 12px", fontSize: 10, color: "var(--t2)", marginBottom: 2 }}>
        {legend.map(([label, color, dashed]) => (
          <span key={label} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <svg width="16" height="6" aria-hidden><line x1="0" y1="3" x2="16" y2="3" stroke={color} strokeWidth="2" strokeDasharray={dashed ? "4 3" : undefined} /></svg>
            {label}
          </span>
        ))}
      </div>
      <div style={{ width: "100%", height }}>
        {raw === null && !err ? (
          <Placeholder text="Loading HDEP…" />
        ) : err ? (
          <Placeholder text="Couldn't load HDEP." />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={pts} margin={{ top: 6, right: 10, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="2 4" stroke={GRID} vertical={false} />
              <XAxis dataKey="t" type="number" scale="time" domain={[pts[0]?.t ?? 0, pts[pts.length - 1]?.t ?? 0]}
                tickFormatter={(ms) => fmtDate(Number(ms), house)} tick={{ fontSize: 9, fill: AXIS, fontFamily: "Inter" }} axisLine={{ stroke: "#d1dada" }} tickLine={false} minTickGap={44} />
              <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={{ fontSize: 9, fill: AXIS, fontFamily: "Inter" }} axisLine={false} tickLine={false} width={30} unit="%" />
              <Tooltip content={<HdepTip house={house} />} cursor={{ stroke: TEAL, strokeOpacity: 0.4 }} />
              <Area dataKey="aboveBand" name="above" stroke="none" fill={GREEN} fillOpacity={0.22} legendType="none" isAnimationActive={false} connectNulls={false} />
              <Area dataKey="belowBand" name="below" stroke="none" fill={DANGER} fillOpacity={0.18} legendType="none" isAnimationActive={false} connectNulls={false} />
              <Line dataKey="standard" name="Breed standard" stroke={STD} strokeWidth={1.5} strokeDasharray="5 4" dot={false} connectNulls isAnimationActive={false} />
              <Line dataKey="hhep" name="Hen-housed" stroke={NAVY} strokeWidth={1.75} dot={false} connectNulls isAnimationActive={false} />
              <Line dataKey="actual" name="Hen-day" stroke={TEAL} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function Placeholder({ text }: { text: string }) {
  return <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--t3)", fontSize: 12 }}>{text}</div>;
}
