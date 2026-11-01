"use client";

import { Area, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { buildVentilation, localHHMM, periods, type InsidePoint, type OutsideHour, type PeriodRow, type SunDay, type VentThresholds } from "@/lib/ventilation";

// Ventilation page body: suggestions first, then inside now, today/tonight outside vs inside, the
// next 3 days and one chart. Rules and the user story behind each block: lib/ventilation.ts and
// docs/ventilation.md. Presentational only, so it can be previewed with mock data.

export type VentData = {
  location: { lat: number; lon: number } | null;
  inside: InsidePoint[] | null;
  outside: OutsideHour[] | null;
  sun: SunDay[];
  forecastError?: boolean;
  thresholds: VentThresholds;
  offsetHours: number;
};

const H = 3_600_000;
const INK = "var(--t1)";
const MUTED = "var(--t3)";
const OUT_C = "#D97706";
const IN_C = "#0F766E";
const LEVEL = {
  act: { dot: "#D97706", bg: "rgba(217,119,6,0.10)", text: "#92400E", word: "Today" },
  plan: { dot: "#2A8E9A", bg: "rgba(42,142,154,0.08)", text: "#134E4A", word: "Plan" },
};
const fmt = (v: number | null | undefined, unit = "°C") => (v == null ? "–" : `${Math.round(v)}${unit}`);
const range = (r: { min: number; max: number } | null) => (r ? `${Math.round(r.min)}–${Math.round(r.max)}°C` : "–");

export default function VentilationView({ data, now, narrow = false }: { data: VentData; now: number; narrow?: boolean }) {
  const v = buildVentilation({ now, outside: data.outside, sun: data.sun, inside: data.inside ?? [], offsetHours: data.offsetHours, thresholds: data.thresholds });
  const t = data.thresholds;
  const card: React.CSSProperties = { background: "#fff", border: "1px solid var(--divider)", borderRadius: 10, padding: narrow ? 12 : 16 };
  const h2: React.CSSProperties = { fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: MUTED, margin: "0 0 8px" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 880 }}>
      {!data.location && (
        <div style={{ ...card, background: "var(--warn-bg)", color: "var(--warn)", fontSize: 13 }}>
          <strong>Farm location not set.</strong> Add <code>location: {"{ lat, lon }"}</code> to the farm config to see the outside forecast. Inside readings are shown below.
        </div>
      )}
      {data.location && data.forecastError && (
        <div style={{ ...card, background: "var(--warn-bg)", color: "var(--warn)", fontSize: 13 }}>The weather forecast didn&apos;t load. Try again later.</div>
      )}

      {/* Suggestions */}
      <section style={card} aria-label="Suggestions">
        <h2 style={h2}>Suggestions</h2>
        {v.prompts.length === 0 ? (
          <div style={{ fontSize: 14, color: INK }}>{v.hasForecast ? "No changes suggested right now." : "No forecast, so no outside-weather suggestions."}</div>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {v.prompts.map((p) => (
              <li key={p.id} style={{ background: LEVEL[p.level].bg, borderRadius: 8, padding: "10px 12px" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                  <span style={{ flexShrink: 0, fontSize: 9, fontWeight: 800, color: LEVEL[p.level].dot, textTransform: "uppercase", letterSpacing: "0.06em", minWidth: 34 }}>{LEVEL[p.level].word}</span>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 650, color: LEVEL[p.level].text, lineHeight: 1.35 }}>{p.text}</div>
                    <div style={{ fontSize: 11.5, color: "var(--t2)", marginTop: 3 }}>{p.why}</div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div style={{ fontSize: 10.5, color: MUTED, marginTop: 8 }}>Suggestions only: you know your house. Thresholds are provisional.</div>
      </section>

      {/* Inside now */}
      <section style={card} aria-label="Inside now">
        <h2 style={h2}>Inside now{v.insideNow ? ` · ${localHHMM(v.insideNow.at, data.offsetHours)}` : ""}</h2>
        {v.insideNow ? (
          <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr 1fr" : "repeat(4, 1fr)", gap: 10 }}>
            <Stat label="Temperature" value={fmt(v.insideNow.tempC)} sub={v.outsideNow != null ? `outside ${fmt(v.outsideNow)}` : undefined} />
            <Stat label="Feels" value={fmt(v.insideNow.feltC)} sub={v.insideNow.rhPct != null ? `RH ${v.insideNow.rhPct}%` : undefined} />
            <Stat label="Chill estimate" value={v.insideNow.chillEstC != null ? `≈${fmt(v.insideNow.chillEstC)}` : "–"} sub={`feels (≤ actual) − ${t.chillOffsetC} °C, rough`} />
            <Stat label="CO₂" value={v.insideNow.co2 != null ? `${v.insideNow.co2.toLocaleString("en-ZA")}` : "–"} sub="ppm" />
          </div>
        ) : <div style={{ fontSize: 13, color: MUTED }}>No recent inside reading (last 90 min).</div>}
      </section>

      {/* Today & tonight */}
      <section style={card} aria-label="Today and tonight">
        <h2 style={h2}>Today &amp; tonight · outside vs inside</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <PeriodBox title="Day" row={v.today} offset={data.offsetHours} insideLabel="inside so far" usualLabel="usual day" />
          <PeriodBox title="Night" row={v.tonight} offset={data.offsetHours} insideLabel="inside last night" usualLabel="usual night" />
        </div>
      </section>

      {/* Next 3 days */}
      {v.hasForecast && (
        <section style={card} aria-label="Next 3 days">
          <h2 style={h2}>Next 3 days · outside</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
            {v.outlook.map((d) => (
              <div key={d.label} style={{ borderRadius: 8, background: "rgba(0,0,0,0.03)", padding: "8px 10px" }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: "var(--t2)" }}>{d.label}</div>
                <div style={{ fontSize: 13, marginTop: 4, color: d.hot ? "#B45309" : INK, fontWeight: d.hot ? 800 : 600 }}>☀ {fmt(d.dayMax)}</div>
                <div style={{ fontSize: 13, color: d.cold ? "#1D4ED8" : INK, fontWeight: d.cold ? 800 : 600 }}>☾ {fmt(d.nightMin)}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      <TempChart data={data} now={now} narrow={narrow} />
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, color: MUTED, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: INK, fontFamily: "var(--font-d)", lineHeight: 1.15 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: MUTED }}>{sub}</div>}
    </div>
  );
}

function PeriodBox({ title, row, offset, insideLabel, usualLabel }: { title: string; row: PeriodRow | null; offset: number; insideLabel: string; usualLabel: string }) {
  if (!row) return <div style={{ fontSize: 13, color: MUTED }}>{title}: –</div>;
  const p = row.period;
  return (
    <div style={{ borderRadius: 8, background: p.kind === "night" ? "rgba(30,58,138,0.06)" : "rgba(217,119,6,0.06)", padding: "10px 12px" }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: "var(--t2)" }}>{p.kind === "day" ? "☀" : "☾"} {title} · {localHHMM(p.start, offset)}–{localHHMM(p.end, offset)}</div>
      <div style={{ marginTop: 6, fontSize: 12, color: MUTED }}>Outside (forecast)</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: OUT_C }}>{range(row.outside)}</div>
      <div style={{ marginTop: 6, fontSize: 12, color: MUTED }}>{insideLabel}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: IN_C }}>{range(row.inside)}</div>
      {row.insideUsual && <div style={{ fontSize: 11, color: MUTED }}>{usualLabel} {range(row.insideUsual)}</div>}
    </div>
  );
}

function TempChart({ data, now, narrow }: { data: VentData; now: number; narrow: boolean }) {
  const from = now - 24 * H, to = now + 72 * H;
  const byT = new Map<number, { t: number; outside?: number; inside?: number }>();
  for (const h of data.outside ?? []) if (h.t >= from && h.t <= to) byT.set(h.t, { t: h.t, outside: h.tempC });
  for (const x of data.inside ?? []) if (x.t >= from && x.t <= now && x.tempC != null) byT.set(x.t, { ...(byT.get(x.t) ?? { t: x.t }), inside: x.tempC });
  const rows = [...byT.values()].sort((a, b) => a.t - b.t);
  if (rows.length < 2) return null;
  const nights = periods(data.sun, from, to, data.offsetHours).filter((p) => p.kind === "night");
  const tick = (ms: number) => {
    const d = new Date(ms + data.offsetHours * H);
    return `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()]} ${String(d.getUTCHours()).padStart(2, "0")}h`;
  };
  return (
    <section style={{ background: "#fff", border: "1px solid var(--divider)", borderRadius: 10, padding: narrow ? 10 : 14 }} aria-label="Temperature chart">
      <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: MUTED, marginBottom: 6 }}>
        Last 24 h and next 3 days · <span style={{ color: OUT_C }}>outside</span> vs <span style={{ color: IN_C }}>inside</span> · shaded = night
      </div>
      <ResponsiveContainer width="100%" height={narrow ? 190 : 230}>
        <ComposedChart data={rows} margin={{ top: 4, right: 6, bottom: 0, left: -18 }}>
          <CartesianGrid stroke="#EEF2F2" vertical={false} />
          {nights.map((n) => <ReferenceArea key={n.start} x1={Math.max(n.start, from)} x2={Math.min(n.end, to)} fill="#1E3A8A" fillOpacity={0.06} stroke="none" />)}
          <XAxis dataKey="t" type="number" domain={[from, to]} scale="time" tickFormatter={tick} ticks={tickList(from, to, data.offsetHours)} tick={{ fontSize: 9, fill: "#5A6A6C" }} />
          <YAxis tick={{ fontSize: 9, fill: "#5A6A6C" }} unit="°" domain={["dataMin - 2", "dataMax + 2"]} allowDecimals={false} />
          <ReferenceLine x={now} stroke="#334155" strokeDasharray="3 3" label={{ value: "now", position: "insideTopLeft", fontSize: 9, fill: "#334155" }} />
          <Area dataKey="inside" stroke={IN_C} fill={IN_C} fillOpacity={0.08} strokeWidth={2} connectNulls dot={false} isAnimationActive={false} />
          <Line dataKey="outside" stroke={OUT_C} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
          <Tooltip labelFormatter={(l) => tick(Number(l))} formatter={(val, name) => [`${Math.round(Number(val) * 10) / 10}°C`, name === "inside" ? "Inside" : "Outside"]} />
        </ComposedChart>
      </ResponsiveContainer>
    </section>
  );
}

/** Ticks at local midnight and midday. */
function tickList(from: number, to: number, offset: number): number[] {
  const out: number[] = [];
  const start = Math.ceil((from + offset * H) / (12 * H)) * 12 * H - offset * H;
  for (let t = start; t <= to; t += 12 * H) out.push(t);
  return out;
}
