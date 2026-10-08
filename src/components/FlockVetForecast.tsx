"use client";

import { useMemo } from "react";
import { ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import type { HpedForecast } from "@/lib/aiDemo";
import { cardStyle, fmtDay, fmtLong, LegendLine, smallBtn, SparkIcon } from "@/components/FlockVetSigns";

// Flock Vet — lay (HPED) forecast card. Prophet anchored to the breed standard, with
// previous-day shed climate and egg-quality drivers. Always labelled as a forecast with the
// date its egg data ends; the backtest is shown as measured, including where it lost.

const PRIMARY = "#002E35";
const TEAL = "#2A8E9A";
const ACTUAL = "#2a78d6"; // categorical slot 1
const MODEL = "#eb6834";  // categorical slot 2
const STD = "#6B7C80";    // reference curve, recessive
const POS = "#2a78d6", NEG = "#e34948"; // diverging poles
const AXIS = "#3a4d4f";
const GRID = "rgba(0,0,0,0.06)";
const DAY_MS = 86_400_000;
const SHOW_DAYS = 70; // history shown before the forecast starts

type Pt = { t: number; actual?: number | null; fit?: number | null; fc?: number | null; band?: [number, number] | null; standard?: number | null; drop?: boolean };

const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
const pct = (v: number, dp = 0) => `${v.toFixed(dp)}%`;
const pts = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(1)}`;

function ForecastTip(props: { active?: boolean; payload?: Array<{ payload?: Pt }> }) {
  const p = props.payload?.[0]?.payload;
  if (!props.active || !p) return null;
  const d = new Date(p.t).toISOString().slice(0, 10);
  return (
    <div style={{ background: PRIMARY, border: `1px solid ${TEAL}`, borderRadius: 6, padding: "6px 10px", fontSize: 12, color: "#fff", lineHeight: 1.5 }}>
      <div style={{ color: "#8fd0d8", fontWeight: 700 }}>{fmtDay(d)}</div>
      {p.actual != null && <div>Actual (logged): <strong>{pct(p.actual, 1)}</strong></div>}
      {p.fit != null && <div>Model fit: <strong>{pct(p.fit, 1)}</strong></div>}
      {p.fc != null && p.band && <div>Forecast: <strong>{pct(p.fc, 1)}</strong> <span style={{ color: "#cfe3e5" }}>(80% range {pct(p.band[0])}–{pct(p.band[1])})</span></div>}
      {p.standard != null && <div style={{ color: "#cfe3e5" }}>Breed standard: {pct(p.standard, 1)}</div>}
    </div>
  );
}

function DropDot(props: { cx?: number; cy?: number; index?: number; payload?: Pt }) {
  const { cx, cy, payload, index } = props;
  if (cx == null || cy == null || !payload?.drop) return <g key={`n${index}`} />;
  return <circle key={`d${index}`} cx={cx} cy={cy} r={4.5} fill={ACTUAL} stroke="#fff" strokeWidth={2} />;
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div style={{ flex: "1 1 120px", minWidth: 0, background: "var(--card)", borderRadius: 8, padding: "8px 10px" }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--t3)" }}>{label}</div>
      <div style={{ fontFamily: "var(--font-d)", fontWeight: 800, fontSize: 20, color: "var(--t1)", lineHeight: 1.2, marginTop: 2 }}>{value}</div>
      <div style={{ fontSize: 11, color: "var(--t2)", lineHeight: 1.35 }}>{sub}</div>
    </div>
  );
}

export default function FlockVetForecast({ data, busy, onInvestigate }: {
  data: HpedForecast; busy: boolean; onInvestigate: (prompt: string) => void;
}) {
  const fc = data.forecast;
  const first = fc[0], last = fc[fc.length - 1];
  const lastLogged = [...data.history].reverse().find((h) => h.hped != null);

  const chart = useMemo(() => {
    const start = ms(data.as_of) - SHOW_DAYS * DAY_MS;
    const dropDates = new Set(data.recent_drops.map((d) => d.date));
    const out: Pt[] = data.history.filter((h) => ms(h.date) >= start).map((h) => ({
      t: ms(h.date), actual: h.hped, fit: h.fitted, standard: h.standard, drop: dropDates.has(h.date),
    }));
    const join = out[out.length - 1];
    if (join && join.fit != null) { join.fc = join.fit; join.band = [join.fit, join.fit]; } // forecast starts where the fit ends
    for (const f of fc) out.push({ t: ms(f.date), fc: f.hped, band: [f.lower, f.upper], standard: f.standard });
    const vals = out.flatMap((p) => [p.actual, p.standard, p.band?.[0], p.band?.[1]]).filter((v): v is number => v != null);
    const lo = Math.max(0, Math.floor((Math.min(...vals) - 2) / 5) * 5), hi = Math.min(100, Math.ceil((Math.max(...vals) + 1) / 5) * 5);
    const ticks = Array.from({ length: (hi - lo) / 5 + 1 }, (_, i) => lo + i * 5);
    return { pts: out, domain: [lo, hi] as [number, number], ticks };
  }, [data, fc]);

  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const fcMean = avg(fc.map((f) => f.hped)), loMean = avg(fc.map((f) => f.lower)), hiMean = avg(fc.map((f) => f.upper));
  const bt = data.backtest;
  const btRows = [{ name: "This model (Prophet + breed standard)", mae: bt.mae_pts, model: true }, ...bt.baselines.map((b) => ({ name: b.name, mae: b.mae_pts, model: false }))];
  const btMax = Math.max(...btRows.map((r) => r.mae));
  const best = btRows.reduce((a, b) => (b.mae < a.mae ? b : a));
  const drvMax = Math.max(0.5, ...data.drivers.map((d) => Math.abs(d.contribution_pts)));

  const askForecast = () => onInvestigate(
    `What does the lay forecast say for ${fmtDay(first.date)} to ${fmtDay(last.date)}, how reliable is it, and what is driving it? The egg log ends on ${fmtLong(data.as_of)}.`);
  const explainDrop = (d: HpedForecast["recent_drops"][number]) => onInvestigate(
    `Explain the lay drop on ${fmtLong(d.date)}: lay was ${d.hped.toFixed(1)}% against about ${d.expected.toFixed(1)}% expected (${pts(d.drop_pts)} points). Use the forecast drivers, the daily log (eggs, cracked eggs, mortality, feed, water), events and the shed climate around that date, and tell me the likely causes and what to watch for.`);

  return (
    <section style={cardStyle} aria-labelledby="fv-fc-title">
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <h2 id="fv-fc-title" style={{ margin: 0, fontFamily: "var(--font-d)", fontWeight: 800, fontSize: 16, color: PRIMARY }}>Lay forecast</h2>
          <div style={{ fontSize: 12, color: "var(--t3)", marginTop: 2, lineHeight: 1.45 }}>
            Hen-day egg % · forecast from DailyLog egg data up to {fmtDay(data.as_of)}. The log has not been updated since, so this covers {fmtDay(first.date)} – {fmtDay(last.date)}.
          </div>
        </div>
        <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: TEAL, border: `1px solid ${TEAL}`, borderRadius: 3, padding: "1px 6px" }}>AI</span>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
        <Stat label="Forecast, next 4 weeks" value={`≈ ${pct(fcMean)}`} sub={`80% range about ${pct(loMean)}–${pct(hiMean)}`} />
        <Stat label="Breed standard" value={`${pct(first.standard ?? 0, 1)} → ${pct(last.standard ?? 0, 1)}`} sub={`weeks ${first.week}–${last.week}, generic layer curve`} />
        {lastLogged?.hped != null && <Stat label="Last logged" value={pct(lastLogged.hped, 1)} sub={`${fmtDay(lastLogged.date)} (DailyLog)`} />}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", fontSize: 11.5, color: "var(--t2)", margin: "12px 0 4px" }}>
        <LegendLine color={ACTUAL} label="Actual (logged)" />
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <svg width="18" height="10" aria-hidden><rect x="0" y="0" width="18" height="10" fill={MODEL} fillOpacity="0.18" /><line x1="0" y1="5" x2="18" y2="5" stroke={MODEL} strokeWidth="2.5" strokeDasharray="4 3" /></svg>
          Forecast + 80% range
        </span>
        <LegendLine color={STD} label="Breed standard" dashed />
      </div>
      <div style={{ width: "100%", height: 210 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chart.pts} margin={{ top: 14, right: 10, bottom: 0, left: -6 }}>
            <CartesianGrid strokeDasharray="2 4" stroke={GRID} vertical={false} />
            <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]}
              tickFormatter={(t: number) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}
              tick={{ fontSize: 10, fill: AXIS }} axisLine={{ stroke: "#d1dada" }} tickLine={false} minTickGap={36} />
            <YAxis domain={chart.domain} ticks={chart.ticks} tick={{ fontSize: 10, fill: AXIS }} axisLine={false} tickLine={false} width={40} tickFormatter={(v: number) => `${v}%`} allowDecimals={false} />
            <Tooltip content={<ForecastTip />} cursor={{ stroke: TEAL, strokeOpacity: 0.4 }} />
            <Area dataKey="band" stroke="none" fill={MODEL} fillOpacity={0.18} isAnimationActive={false} connectNulls={false} legendType="none" />
            <Line dataKey="standard" stroke={STD} strokeWidth={1.5} strokeDasharray="5 4" dot={false} isAnimationActive={false} connectNulls />
            <Line dataKey="fc" stroke={MODEL} strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} connectNulls={false} />
            <Line dataKey="actual" stroke={ACTUAL} strokeWidth={1.5} dot={<DropDot />} activeDot={{ r: 3.5 }} isAnimationActive={false} connectNulls={false} />
            <ReferenceLine x={ms(data.as_of)} stroke={PRIMARY} strokeDasharray="3 3"
              label={{ value: "Egg data ends", position: "insideTopRight", fontSize: 10, fill: PRIMARY, offset: 4 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div style={{ fontSize: 10.5, color: "var(--t3)", textAlign: "right" }}>Dots mark the recent drops listed below</div>

      {/* Backtest */}
      <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--divider)" }}>
        <div style={{ fontFamily: "var(--font-d)", fontWeight: 800, fontSize: 14, color: "var(--t1)" }}>How accurate is it?</div>
        <div style={{ fontSize: 12, color: "var(--t2)", lineHeight: 1.45, margin: "2px 0 8px" }}>
          We hid the {bt.horizon_days} days after {fmtDay(bt.cutoff)} and forecast them. Average daily error, in hen-day % points (lower is better):
        </div>
        {btRows.map((r) => (
          <div key={r.name} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 46px", gap: 8, alignItems: "center", marginBottom: 6 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, color: "var(--t1)", fontWeight: r.model ? 700 : 400 }}>{r.name}{r === best ? " · most accurate" : ""}</div>
              <div style={{ height: 8, background: "var(--card-alt)", borderRadius: 4, marginTop: 3 }}>
                <div style={{ width: `${(r.mae / btMax) * 100}%`, height: "100%", borderRadius: 4, background: r.model ? MODEL : "#9AA8AA" }} />
              </div>
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--t1)", textAlign: "right" }}>{r.mae.toFixed(1)}</div>
          </div>
        ))}
        <div style={{ fontSize: 11.5, color: "var(--t2)", lineHeight: 1.45, marginTop: 4 }}>
          {best.model
            ? "The model beat both simple baselines over this window."
            : "Lay has been flat at about 89–93% for months, so simply carrying last week forward was hardest to beat over 4 weeks. The model adds the breed-curve context, a range, and what is moving lay."}
        </div>
      </div>

      {/* Drivers */}
      <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--divider)" }}>
        <div style={{ fontFamily: "var(--font-d)", fontWeight: 800, fontSize: 14, color: "var(--t1)" }}>What is moving lay now</div>
        <div style={{ fontSize: 12, color: "var(--t2)", lineHeight: 1.45, margin: "2px 0 8px" }}>
          Average effect over the forecast, in hen-day % points against an average day, read straight from the model&apos;s components (a SHAP-style breakdown).
        </div>
        {data.drivers.map((d) => {
          const w = (Math.abs(d.contribution_pts) / drvMax) * 50;
          const up = d.contribution_pts >= 0;
          return (
            <div key={d.label} style={{ marginBottom: 7 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, color: "var(--t1)" }}>
                <span style={{ minWidth: 0 }}>{d.label}</span>
                <strong style={{ whiteSpace: "nowrap" }}>{pts(d.contribution_pts)} pts</strong>
              </div>
              <div style={{ position: "relative", height: 8, background: "#f0efec", borderRadius: 4, marginTop: 3 }}>
                <div style={{ position: "absolute", left: "50%", top: -2, bottom: -2, width: 1, background: "#9AA8AA" }} />
                <div style={{ position: "absolute", top: 0, bottom: 0, left: up ? "50%" : `${50 - w}%`, width: `${w}%`, background: up ? POS : NEG, borderRadius: up ? "0 4px 4px 0" : "4px 0 0 4px" }} />
              </div>
            </div>
          );
        })}
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "var(--t3)" }}>
          <span>← holding lay back</span><span>helping lay →</span>
        </div>
      </div>

      {/* Recent drops */}
      <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--divider)" }}>
        <div style={{ fontFamily: "var(--font-d)", fontWeight: 800, fontSize: 14, color: "var(--t1)" }}>Recent drops</div>
        {data.recent_drops.map((d) => {
          const known = d.drivers.filter((x) => !/^not explained/i.test(x.label)).reduce((a, x) => a + x.contribution_pts, 0);
          const unexplained = d.drop_pts - known;
          return (
            <div key={d.date} style={{ padding: "8px 0", borderTop: "1px solid var(--divider)" }}>
              <div style={{ fontSize: 13, color: "var(--t1)" }}>
                <strong>{fmtDay(d.date)}</strong>: {pct(d.hped, 1)} against about {pct(d.expected, 1)} expected ({pts(d.drop_pts)} pts)
              </div>
              <div style={{ fontSize: 12, color: "var(--t2)", lineHeight: 1.45, marginTop: 2 }}>
                Climate, cracked eggs and egg size account for {pts(known)} pts; {pts(unexplained)} pts is not explained by them
                {Math.abs(unexplained) > 0.6 * Math.abs(d.drop_pts)
                  ? ", so the cause is likely elsewhere — worth checking the log and events."
                  : "."}
              </div>
              <button type="button" onClick={() => explainDrop(d)} disabled={busy} style={{ ...smallBtn(false, busy), marginTop: 6 }}>
                <SparkIcon /> Explain with Flock Vet
              </button>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
        <button type="button" onClick={askForecast} disabled={busy} style={{ ...smallBtn(true, busy), minHeight: 40 }}>
          <SparkIcon /> Ask Flock Vet about the forecast
        </button>
      </div>

      <details style={{ marginTop: 12, fontSize: 12, color: "var(--t2)" }}>
        <summary style={{ cursor: "pointer", fontWeight: 700, color: PRIMARY, minHeight: 32, display: "flex", alignItems: "center" }}>How the forecast works</summary>
        <p style={{ margin: "6px 0", lineHeight: 1.5 }}>{data.model.description}</p>
        <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.5 }}>
          {data.notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      </details>
    </section>
  );
}
