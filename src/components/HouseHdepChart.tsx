"use client";

import { useEffect, useMemo, useState } from "react";
import { ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { standardHdepForWeek, HEN_STANDARD } from "@/lib/henStandard";

// Compact Hen-day % (HDEP) vs breed-standard projection for one house, to end of cycle.
// Green fill above the standard, red below (like the Analytics section). Actual HDEP is bucketed to
// flock-weeks and averaged so the line is smooth and renders fast (~40–80 points).
const TEAL = "#2A8E9A", STD = "#7A5C00", GREEN = "#166534", DANGER = "#B91C1C";
const AXIS = "#3a4d4f", GRID = "rgba(42,142,154,0.14)", PRIMARY = "#002E35";
const DAY_MS = 86_400_000;
const FIRST_WEEK = HEN_STANDARD[0].week;                         // 18
const END_WEEK = HEN_STANDARD[HEN_STANDARD.length - 1].week;     // 95 (end of cycle)

type House = { id: string; name?: string; startDate: string; startAgeDays: number };
type Row = { time: string; hdep: number | null };
type Pt = { t: number; actual: number | null; standard: number | null; aboveBand?: [number, number]; belowBand?: [number, number] };

// UTC ms at the start of a given flock-week for this house.
const weekToMs = (h: House, week: number) =>
  new Date(`${h.startDate}T00:00:00Z`).getTime() + (week * 7 - h.startAgeDays) * DAY_MS;

// Flock age (in weeks) at an ISO timestamp.
function flockWeekAt(h: House, iso: string): number {
  const start = new Date(`${h.startDate}T00:00:00Z`).getTime();
  const days = h.startAgeDays + Math.floor((new Date(iso).getTime() - start) / DAY_MS);
  return days / 7;
}

const fmtDate = (ms: number) => new Date(ms).toLocaleDateString("en-ZA", { month: "short", year: "2-digit" });

export default function HouseHdepChart({ house, height = 150 }: { house: House; height?: number }) {
  const [raw, setRaw] = useState<Row[] | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(house.startDate)) { setRaw([]); return; }
    let alive = true;
    const now = Date.now();
    const q = new URLSearchParams({
      metrics: "hdep", house: house.id,
      from: `${house.startDate}T00:00:00Z`, to: new Date(now).toISOString(),
    });
    fetch(`/api/analytics/series?${q}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("fetch"))))
      .then((d: { series?: { time: string; hdep: number | null }[] }) => {
        if (!alive) return;
        setRaw((d.series ?? []).map((s) => ({ time: String(s.time), hdep: typeof s.hdep === "number" ? s.hdep : null })));
      })
      .catch(() => { if (alive) setErr(true); });
    return () => { alive = false; };
  }, [house.id, house.startDate]);

  const pts = useMemo<Pt[]>(() => {
    // Average actual HDEP into flock-weeks.
    const byWeek = new Map<number, number[]>();
    for (const r of raw ?? []) {
      if (r.hdep == null) continue;
      const w = Math.floor(flockWeekAt(house, r.time));
      const arr = byWeek.get(w) ?? [];
      arr.push(r.hdep);
      byWeek.set(w, arr);
    }
    const avg = (w: number) => {
      const a = byWeek.get(w);
      return a && a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : null;
    };
    const startWeek = Math.max(FIRST_WEEK, Math.floor(house.startAgeDays / 7));
    const out: Pt[] = [];
    for (let w = startWeek; w <= END_WEEK; w++) {
      const standard = standardHdepForWeek(w);
      const actual = avg(w);
      const p: Pt = { t: weekToMs(house, w), actual, standard };
      if (actual != null && standard != null) {
        p.aboveBand = [standard, Math.max(actual, standard)];
        p.belowBand = [Math.min(actual, standard), standard];
      }
      out.push(p);
    }
    return out;
  }, [raw, house]);

  return (
    <div style={{ minWidth: 0 }}>
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
                tickFormatter={fmtDate} tick={{ fontSize: 9, fill: AXIS, fontFamily: "Inter" }} axisLine={{ stroke: "#d1dada" }} tickLine={false} minTickGap={44} />
              <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={{ fontSize: 9, fill: AXIS, fontFamily: "Inter" }} axisLine={false} tickLine={false} width={30} unit="%" />
              <Tooltip labelFormatter={(ms) => new Date(Number(ms)).toLocaleDateString("en-ZA", { month: "short", year: "numeric" })}
                formatter={(value, name) => {
                  if (name !== "Actual" && name !== "Breed standard") return null;
                  return [value == null ? "—" : `${Math.round(Number(value))}%`, name];
                }}
                contentStyle={{ background: PRIMARY, border: `1px solid ${TEAL}`, borderRadius: 0, fontSize: 12, color: "#fff" }} labelStyle={{ color: TEAL }} />
              <Area dataKey="aboveBand" name="above" stroke="none" fill={GREEN} fillOpacity={0.22} legendType="none" isAnimationActive={false} connectNulls={false} />
              <Area dataKey="belowBand" name="below" stroke="none" fill={DANGER} fillOpacity={0.18} legendType="none" isAnimationActive={false} connectNulls={false} />
              <Line dataKey="standard" name="Breed standard" stroke={STD} strokeWidth={1.5} strokeDasharray="5 4" dot={false} connectNulls isAnimationActive={false} />
              <Line dataKey="actual" name="Actual" stroke={TEAL} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
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
