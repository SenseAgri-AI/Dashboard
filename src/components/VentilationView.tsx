"use client";

import { Area, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { buildVentilation, insideDayNightTrend, latestInsideAt, localHHMM, periods, type DayOutlook, type InsidePoint, type OutsideHour, type SunDay, type VentThresholds } from "@/lib/ventilation";
import WeatherIcon, { Droplet, WindMark } from "@/components/WeatherIcon";

// Ventilation page body: suggestions first, then inside now, the last 30 days day vs night,
// the next 3 days and the forecast chart. Rules and the user story behind each block:
// lib/ventilation.ts and docs/ventilation.md. Presentational only, so it can be previewed with mock data.

export type VentData = {
  hasLocation: boolean;
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
const DAY_C = "#D97706"; // warm amber — daytime inside
const NIGHT_C = "#5B6B7C"; // cool blue-grey — night inside
const LEVEL = {
  act: { dot: "#D97706", bg: "rgba(217,119,6,0.10)", text: "#92400E", word: "Soon" },
  plan: { dot: "#2A8E9A", bg: "rgba(42,142,154,0.08)", text: "#134E4A", word: "Plan" },
};
const fmt = (v: number | null | undefined, unit = "°C") => (v == null ? "–" : `${Math.round(v)}${unit}`);

export default function VentilationView({ data, now, narrow = false }: { data: VentData; now: number; narrow?: boolean }) {
  // Suggestions still read the last 8 days, the window they were tuned on. The month chart and the
  // stale banner use the full 30-day series, so a reading older than 8 days is not reported as "none".
  const insideAll = data.inside ?? [];
  const recentInside = insideAll.filter((x) => x.t > now - 8 * 24 * H);
  const v = buildVentilation({ now, outside: data.outside, sun: data.sun, inside: recentInside, offsetHours: data.offsetHours, thresholds: data.thresholds });
  const lastInsideAt = latestInsideAt(insideAll);
  const t = data.thresholds;
  const card: React.CSSProperties = { background: "#fff", border: "1px solid var(--divider)", borderRadius: 10, padding: narrow ? 12 : 16 };
  const h2: React.CSSProperties = { fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: MUTED, margin: "0 0 8px" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 880 }}>
      {!data.hasLocation && (
        <div style={{ ...card, background: "var(--warn-bg)", color: "var(--warn)", fontSize: 13 }}>
          <strong>Farm location not set.</strong> Add <code>location: {"{ lat, lon }"}</code> to the farm config to see the outside forecast. Inside readings are shown below.
        </div>
      )}
      {data.hasLocation && data.forecastError && (
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
            <Stat label="Temperature" value={fmt(v.insideNow.tempC)} sub={[v.outsideNow != null ? `outside ${fmt(v.outsideNow)}` : "", v.insideNow.warmC != null ? `warmest sensor ${fmt(v.insideNow.warmC)}` : ""].filter(Boolean).join("\n") || undefined} />
            <Stat label="Feels" value={fmt(v.insideNow.feltC)} sub={v.insideNow.rhPct != null ? `RH ${v.insideNow.rhPct}%` : undefined} />
            <Stat label="Chill estimate" value={v.insideNow.chillEstC != null ? `≈${fmt(v.insideNow.chillEstC)}` : "–"} sub={`feels (≤ actual) − ${t.chillOffsetC} °C, rough`} />
            <Stat label="CO₂" value={v.insideNow.co2 != null ? `${v.insideNow.co2.toLocaleString("en-ZA")}` : "–"} sub="ppm" />
          </div>
        ) : <InsideStale lastAt={lastInsideAt} now={now} offset={data.offsetHours} />}
      </section>

      <MonthChart data={data} now={now} narrow={narrow} card={card} h2={h2} />

      {/* Next 3 days */}
      {v.hasForecast && (
        <section style={card} aria-label="Next 3 days">
          <h2 style={h2}>Next 3 days</h2>
          {v.outsideNow != null && v.outsideNowWx && (
            <div style={{ marginBottom: 10 }} aria-label={`Outside now, ${Math.round(v.outsideNow)}°, ${v.outsideNowWx.label}`}>
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: MUTED, marginBottom: 4 }}>Outside now</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <WeatherIcon name={v.outsideNowWx.icon} size={narrow ? 32 : 40} />
                <div>
                  <div style={{ fontSize: narrow ? 22 : 26, fontWeight: 800, color: INK, fontFamily: "var(--font-d)", lineHeight: 1 }}>{Math.round(v.outsideNow)}°C</div>
                  <div style={{ fontSize: 12, color: "var(--t2)", fontWeight: 650, marginTop: 2 }}>{v.outsideNowWx.label}</div>
                </div>
              </div>
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: narrow ? 6 : 8 }}>
            {v.outlook.map((d, i) => <ForecastTile key={`${d.label}-${i}`} d={d} hotC={t.insideHotC} narrow={narrow} />)}
          </div>
        </section>
      )}

      <TempChart data={data} now={now} narrow={narrow} />
    </div>
  );
}

// Story: when the climate sensor stops, show how old the last reading is so I don't trust old numbers.
function InsideStale({ lastAt, now, offset }: { lastAt: number | null; now: number; offset: number }) {
  const h = lastAt != null ? (now - lastAt) / H : null;
  const age = h == null ? null : h < 36 ? `${Math.max(2, Math.round(h))} h ago` : `${Math.round(h / 24)} days ago`;
  return (
    <div style={{ fontSize: 13, color: "var(--warn)", background: "var(--warn-bg)", borderRadius: 8, padding: "8px 10px" }}>
      {lastAt == null ? "No inside readings in the last 30 days." : `No inside reading since ${h! >= 20 ? `${new Date(lastAt + offset * H).toLocaleDateString("en-ZA", { timeZone: "UTC", day: "numeric", month: "short" })} ` : ""}${localHHMM(lastAt, offset)} (${age}).`}
      {" "}Check the climate sensor and gateway power. The numbers below may be old.
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, color: MUTED, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: INK, fontFamily: "var(--font-d)", lineHeight: 1.15 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: MUTED, whiteSpace: "pre-line" }}>{sub}</div>}
    </div>
  );
}

function ForecastTile({ d, hotC, narrow }: { d: DayOutlook; hotC: number; narrow: boolean }) {
  const chance = d.rainPct != null && d.rainPct > 0 ? `${d.rainPct}%` : null;
  const rain = [chance, d.precipMm != null && d.precipMm > 0 ? `${d.precipMm} mm` : null].filter(Boolean).join(" · ");
  const high = d.dayMax == null ? "–" : `${Math.round(d.dayMax)}°`;
  const low = d.nightMin == null ? "–" : `${Math.round(d.nightMin)}°`;
  return (
    <div style={{ borderRadius: 8, background: "rgba(0,0,0,0.03)", padding: narrow ? "8px 4px" : "10px 8px", textAlign: "center" }} aria-label={`${d.label}${d.wx ? `, ${d.wx.label}` : ""}. High ${high}, low ${low}.`}>
      <div style={{ fontSize: 11, fontWeight: 800, color: "var(--t2)" }}>{d.label}</div>
      {d.wx && <div style={{ marginTop: 4, display: "flex", justifyContent: "center" }}><WeatherIcon name={d.wx.icon} size={narrow ? 28 : 36} /></div>}
      {d.wx && <div style={{ fontSize: 11, fontWeight: 650, color: INK, lineHeight: 1.25, minHeight: 28, marginTop: 2 }}>{d.wx.label}</div>}
      <div style={{ display: "flex", justifyContent: "center", alignItems: "baseline", gap: 6, marginTop: 2 }}>
        <span style={{ fontSize: narrow ? 18 : 22, fontWeight: 800, color: d.hot ? "#B45309" : INK, fontFamily: "var(--font-d)", lineHeight: 1 }}>{high}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: d.cold ? "#1D4ED8" : MUTED }}>{low}</span>
      </div>
      {d.insideMax != null && <div style={{ fontSize: 10.5, fontWeight: d.insideHot ? 800 : 650, color: d.insideHot ? "#B91C1C" : IN_C }}>{d.insideMeasured ? `in ${Math.round(d.insideMax)}°` : `in ~${Math.round(d.insideMax)}°`}</div>}
      {d.insideMinLikely != null && <div style={{ fontSize: 10.5, fontWeight: 800, color: "#1D4ED8" }}>in ~{Math.round(d.insideMinLikely)}°</div>}
      {d.warmEndMax != null && d.warmEndMax >= hotC && <div style={{ fontSize: 10.5, fontWeight: 700, color: "#B91C1C" }}>warm end {d.insideMeasured ? "" : "~"}{Math.round(d.warmEndMax)}°</div>}
      {rain && <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 3, marginTop: 4, fontSize: 11, fontWeight: 700, color: "#1D4ED8" }}><Droplet />{rain}</div>}
      {d.windKmh != null && <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 3, marginTop: 2, fontSize: 11, fontWeight: 650, color: MUTED }}><WindMark />{d.windKmh} km/h</div>}
    </div>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type MonthRow = {
  t: number;
  dayAvg: number | null; dayMin: number | null; dayMax: number | null; dayBase: number | null; daySpan: number | null;
  nightAvg: number | null; nightMin: number | null; nightMax: number | null; nightBase: number | null; nightSpan: number | null;
};

function MonthChart({ data, now, narrow, card, h2 }: { data: VentData; now: number; narrow: boolean; card: React.CSSProperties; h2: React.CSSProperties }) {
  const trend = insideDayNightTrend(data.inside ?? [], data.sun, now, data.offsetHours);
  const rows: MonthRow[] = trend.map((r) => {
    const t = Date.parse(`${r.date}T00:00:00Z`) - data.offsetHours * H;
    return {
      t,
      dayAvg: r.day?.avg ?? null, dayMin: r.day?.min ?? null, dayMax: r.day?.max ?? null,
      dayBase: r.day?.min ?? null, daySpan: r.day ? Math.round((r.day.max - r.day.min) * 10) / 10 : null,
      nightAvg: r.night?.avg ?? null, nightMin: r.night?.min ?? null, nightMax: r.night?.max ?? null,
      nightBase: r.night?.min ?? null, nightSpan: r.night ? Math.round((r.night.max - r.night.min) * 10) / 10 : null,
    };
  });
  const temps = rows.flatMap((r) => [r.dayMin, r.dayMax, r.nightMin, r.nightMax]).filter((v): v is number => v != null);
  const yLo = Math.floor(Math.min(...temps) - 1);
  const yHi = Math.ceil(Math.max(...temps) + 1);
  const tick = (ms: number) => {
    const d = new Date(ms + data.offsetHours * H);
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  };
  return (
    <section style={card} aria-label="Inside last 30 days, day versus night">
      <h2 style={h2}>Inside · last 30 days, <span style={{ color: DAY_C }}>day</span> vs <span style={{ color: NIGHT_C }}>night</span></h2>
      {temps.length === 0 ? <div style={{ fontSize: 13, color: MUTED }}>No inside readings for the last 30 days.</div> : (
        <ResponsiveContainer width="100%" height={narrow ? 168 : 200}>
          <ComposedChart data={rows} margin={{ top: 4, right: 6, bottom: 0, left: -18 }}>
            <CartesianGrid stroke="#EEF2F2" vertical={false} />
            <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={tick} interval={4} tick={{ fontSize: 9, fill: "#5A6A6C" }} />
            <YAxis tick={{ fontSize: 9, fill: "#5A6A6C" }} unit="°" domain={[yLo, yHi]} allowDataOverflow allowDecimals={false} />
            <Area dataKey="dayBase" stackId="day" stroke="none" fill={DAY_C} fillOpacity={0} legendType="none" activeDot={false} connectNulls={false} isAnimationActive={false} />
            <Area dataKey="daySpan" stackId="day" stroke="none" fill={DAY_C} fillOpacity={0.18} legendType="none" activeDot={false} connectNulls={false} isAnimationActive={false} />
            <Area dataKey="nightBase" stackId="night" stroke="none" fill={NIGHT_C} fillOpacity={0} legendType="none" activeDot={false} connectNulls={false} isAnimationActive={false} />
            <Area dataKey="nightSpan" stackId="night" stroke="none" fill={NIGHT_C} fillOpacity={0.22} legendType="none" activeDot={false} connectNulls={false} isAnimationActive={false} />
            <Line dataKey="dayAvg" name="Day" stroke={DAY_C} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
            <Line dataKey="nightAvg" name="Night" stroke={NIGHT_C} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
            <Tooltip content={(props) => <MonthTip active={props.active} row={(props.payload?.[0] as { payload?: MonthRow } | undefined)?.payload} offset={data.offsetHours} />} />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </section>
  );
}

function MonthTip({ active, row, offset }: { active?: boolean; row?: MonthRow; offset: number }) {
  if (!active || !row) return null;
  const d = new Date(row.t + offset * H);
  const label = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  const line = (name: string, avg: number | null, min: number | null, max: number | null, color: string) =>
    avg == null || min == null || max == null ? null : <div style={{ color }}>{name} {avg.toFixed(1)}°C ({min.toFixed(1)}–{max.toFixed(1)})</div>;
  return (
    <div style={{ background: "#fff", border: "1px solid var(--divider)", padding: "6px 8px", fontSize: 11 }}>
      <div style={{ fontWeight: 700, color: INK }}>{label}</div>
      {line("Day", row.dayAvg, row.dayMin, row.dayMax, DAY_C)}
      {line("Night", row.nightAvg, row.nightMin, row.nightMax, NIGHT_C)}
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
