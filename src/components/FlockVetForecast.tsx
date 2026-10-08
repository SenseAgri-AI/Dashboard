"use client";

import { useMemo } from "react";
import { ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import type { HpedForecast } from "@/lib/aiDemo";
import { cardStyle, fmtDay, fmtLong, LegendLine, smallBtn, SparkIcon, StatusChip } from "@/components/FlockVetSigns";

// Flock Vet — lay (HPED) forecast card. One model: the flock's recent level carried along its
// own lay curve. Always labelled as a forecast with the date its egg data ends; accuracy comes
// from forecasting every past day with only the data available then.

const PRIMARY = "#002E35";
const TEAL = "#2A8E9A";
const ACTUAL = "#2a78d6"; // categorical slot 1
const MODEL = "#eb6834";  // categorical slot 2
const STD = "#6B7C80";    // reference curve, recessive
const AXIS = "#3a4d4f";
const GRID = "rgba(0,0,0,0.06)";
const DAY_MS = 86_400_000;
const SHOW_DAYS = 70; // history shown before the forecast starts

type Pt = { t: number; actual?: number | null; fc?: number | null; band?: [number, number] | null; standard?: number | null; next?: boolean };

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
      {p.fc != null && p.band && p.band[0] !== p.band[1] && (
        <div>Forecast: <strong>{pct(p.fc, 1)}</strong> <span style={{ color: "#cfe3e5" }}>(80% range {pct(p.band[0])}–{pct(p.band[1])})</span></div>
      )}
      {p.standard != null && <div style={{ color: "#cfe3e5" }}>Breed standard: {pct(p.standard, 1)}</div>}
    </div>
  );
}

function NextDot(props: { cx?: number; cy?: number; index?: number; payload?: Pt }) {
  const { cx, cy, payload, index } = props;
  if (cx == null || cy == null || !payload?.next) return <g key={`n${index}`} />;
  return <circle key={`d${index}`} cx={cx} cy={cy} r={4} fill={MODEL} stroke="#fff" strokeWidth={1.5} />;
}

export default function FlockVetForecast({ data, busy, onInvestigate }: {
  data: HpedForecast; busy: boolean; onInvestigate: (prompt: string) => void;
}) {
  const next = data.next_days;
  const acc = data.accuracy;
  const watch = data.dip_watch;
  const last = data.outlook[data.outlook.length - 1];

  const chart = useMemo(() => {
    const start = ms(data.as_of) - SHOW_DAYS * DAY_MS;
    const out: Pt[] = data.history.filter((h) => ms(h.date) >= start)
      .map((h) => ({ t: ms(h.date), actual: h.excluded ? null : h.hped, standard: h.standard }));
    const lastActual = [...out].reverse().find((p) => p.actual != null);
    if (lastActual?.actual != null) { lastActual.fc = lastActual.actual; lastActual.band = [lastActual.actual, lastActual.actual]; }
    data.outlook.forEach((f, i) => out.push({ t: ms(f.date), fc: f.hped, band: [f.lower, f.upper], standard: f.standard, next: i < next.length }));
    const vals = out.flatMap((p) => [p.actual, p.standard, p.band?.[0], p.band?.[1]]).filter((v): v is number => v != null);
    const lo = Math.max(0, Math.floor((Math.min(...vals) - 2) / 5) * 5), hi = Math.min(100, Math.ceil((Math.max(...vals) + 1) / 5) * 5);
    return { pts: out, domain: [lo, hi] as [number, number], ticks: Array.from({ length: (hi - lo) / 5 + 1 }, (_, i) => lo + i * 5) };
  }, [data, next.length]);

  const askForecast = () => onInvestigate(
    `What does the lay forecast say for the next 3 days (${fmtDay(next[0].date)} to ${fmtDay(next[next.length - 1].date)}) and the coming weeks? How reliable is it, and is a dip likely? The egg log ends on ${fmtLong(data.as_of)}.`);
  const explainDip = (d: HpedForecast["recent_dips"][number]) => onInvestigate(
    `Investigate the lay dip on ${fmtLong(d.date)}: lay was ${d.hped.toFixed(1)}% against about ${d.expected.toFixed(1)}% expected (${pts(d.drop_pts)} points)` +
    `${d.next_day_hped != null ? `, and ${d.next_day_hped.toFixed(1)}% the next day` : ""}. Was it a real drop or a counting issue? Check the daily log (eggs, cracked eggs, mortality, feed, water), events, water per bird and shed climate around that date, and tell me the likely causes and what to watch for.`);

  return (
    <section style={cardStyle} aria-labelledby="fv-fc-title">
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <h2 id="fv-fc-title" style={{ margin: 0, fontFamily: "var(--font-d)", fontWeight: 800, fontSize: 16, color: PRIMARY }}>Lay forecast</h2>
          <div style={{ fontSize: 12, color: "var(--t3)", marginTop: 2, lineHeight: 1.45 }}>
            {`Hen-day egg % · forecast from DailyLog egg data up to ${fmtDay(data.as_of)}. The log has not been updated since, so the next 3 days are ${fmtDay(next[0].date)} – ${fmtDay(next[next.length - 1].date)}.`}
          </div>
        </div>
        <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: TEAL, border: `1px solid ${TEAL}`, borderRadius: 3, padding: "1px 6px" }}>AI</span>
      </div>

      {/* Next 3 days */}
      <div style={{ fontWeight: 700, fontSize: 12.5, color: "var(--t1)", margin: "12px 0 6px" }}>Next 3 days</div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${next.length}, minmax(0, 1fr))`, gap: 8 }}>
        {next.map((d) => (
          <div key={d.date} style={{ background: "var(--card)", borderRadius: 8, padding: "8px 10px", minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--t3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{fmtDay(d.date)}</div>
            <div style={{ fontFamily: "var(--font-d)", fontWeight: 800, fontSize: 20, color: "var(--t1)", lineHeight: 1.2, marginTop: 2 }}>{pct(d.hped)}</div>
            <div style={{ fontSize: 11, color: "var(--t2)" }}>{pct(d.lower)}–{pct(d.upper)}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 8, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--divider)" }}>
        <StatusChip status={watch.status} text={watch.status === "watch" ? "Dip watch" : "No dip warning"} />
        <span style={{ fontSize: 12, color: "var(--t2)", lineHeight: 1.45 }}>{watch.message}</span>
      </div>

      {/* Chart */}
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
            <YAxis domain={chart.domain} ticks={chart.ticks} tick={{ fontSize: 10, fill: AXIS }} axisLine={false} tickLine={false} width={40}
              tickFormatter={(v: number) => `${v}%`} allowDecimals={false} />
            <Tooltip content={<ForecastTip />} cursor={{ stroke: TEAL, strokeOpacity: 0.4 }} />
            <Area dataKey="band" stroke="none" fill={MODEL} fillOpacity={0.18} isAnimationActive={false} connectNulls={false} legendType="none" />
            <Line dataKey="standard" stroke={STD} strokeWidth={1.5} strokeDasharray="5 4" dot={false} isAnimationActive={false} connectNulls />
            <Line dataKey="fc" stroke={MODEL} strokeWidth={2} strokeDasharray="5 4" dot={<NextDot />} activeDot={{ r: 3.5 }} isAnimationActive={false} connectNulls={false} />
            <Line dataKey="actual" stroke={ACTUAL} strokeWidth={1.5} dot={false} activeDot={{ r: 3.5 }} isAnimationActive={false} connectNulls={false} />
            <ReferenceLine x={ms(data.as_of)} stroke={PRIMARY} strokeDasharray="3 3"
              label={{ value: "Egg data ends", position: "insideTopRight", fontSize: 10, fill: PRIMARY, offset: 4 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div style={{ fontSize: 10.5, color: "var(--t3)", textAlign: "right" }}>
        Dots mark the next 3 days · 4 weeks out: {pct(last.hped)} ({pct(last.lower)}–{pct(last.upper)})
      </div>

      {/* Accuracy */}
      <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--divider)" }}>
        <div style={{ fontFamily: "var(--font-d)", fontWeight: 800, fontSize: 14, color: "var(--t1)" }}>How accurate is it?</div>
        <div style={{ fontSize: 12, color: "var(--t2)", lineHeight: 1.45, margin: "2px 0 8px" }}>
          {`We forecast from every day since ${fmtDay(acc.tested_from)} (${acc.forecasts_made} forecasts), each time using only the data available that day. Average error, in hen-day % points:`}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
          {([["Next day", acc.next_day_mae], ["Next 3 days", acc.three_day_mae], ["Next 4 weeks", acc.four_week_mae]] as const).map(([label, v]) => (
            <div key={label} style={{ background: "var(--card)", borderRadius: 8, padding: "8px 10px" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--t3)" }}>{label}</div>
              <div style={{ fontFamily: "var(--font-d)", fontWeight: 800, fontSize: 18, color: "var(--t1)" }}>±{v.toFixed(1)}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--t2)", lineHeight: 1.5, marginTop: 8 }}>
          {`Lay has been flat, and much of the day-to-day movement looks like counting noise: ${acc.dips_bounced_back} of the ${acc.dips} dips since ${fmtDay(acc.tested_from)} bounced straight back the next day. That is why no model beats the recent level by much — simply repeating the last 7-day average scores the same (±${acc.benchmark.three_day_mae.toFixed(1)} over 3 days).`}
        </div>
        <div style={{ fontSize: 11, color: "var(--t3)", lineHeight: 1.45, marginTop: 4 }}>{acc.signals_note}</div>
      </div>

      {/* Recent dips */}
      <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--divider)" }}>
        <div style={{ fontFamily: "var(--font-d)", fontWeight: 800, fontSize: 14, color: "var(--t1)" }}>Recent dips</div>
        {data.recent_dips.length === 0 && <div style={{ fontSize: 12, color: "var(--t3)", marginTop: 4 }}>No dips in the last 60 days of the log.</div>}
        {data.recent_dips.map((d) => (
          <div key={d.date} style={{ padding: "8px 0", borderTop: "1px solid var(--divider)" }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13, color: "var(--t1)" }}>
                <strong>{fmtDay(d.date)}</strong>: {pct(d.hped, 1)} against about {pct(d.expected, 1)} expected ({pts(d.drop_pts)} pts)
              </span>
              <StatusChip status={d.bounced_back ? "watch" : "alert"} text={d.bounced_back ? "Bounced back" : "Real dip"} />
            </div>
            <div style={{ fontSize: 12, color: "var(--t2)", lineHeight: 1.45, marginTop: 2 }}>
              {d.bounced_back
                ? `Back to ${d.next_day_hped?.toFixed(1)}% the next day — most likely eggs counted on the wrong day rather than a real drop.`
                : `Still ${d.next_day_hped != null ? `${d.next_day_hped.toFixed(1)}%` : "low"} the next day — worth investigating.`}
              {d.water_drop_before ? " Water per bird dropped sharply in the 3 days before." : ""}
            </div>
            <button type="button" onClick={() => explainDip(d)} disabled={busy} style={{ ...smallBtn(false, busy), marginTop: 6 }}>
              <SparkIcon /> Investigate with Flock Vet
            </button>
          </div>
        ))}
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
