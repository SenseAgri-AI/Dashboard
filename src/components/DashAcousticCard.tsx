"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ComposedChart, Area, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

// Flock-noise welfare card: 24 h noise over a red→green "heat" backdrop (loud/stressed up, calm down),
// a Calm/Stressed badge from noise-vs-baseline, and spike anomalies surfaced on the plot (tap to hear).
const LINE = "#0c5c69";
const DANGER = "#B91C1C", GREEN = "#16A34A", AMBER = "#D97706";
const AXIS = "#3a4d4f";
const HOUR_MS = 3_600_000;

type NoiseRow = { time: string; mean: number | null; max: number | null; baseline: number | null };
type AnomalyRow = { time: string; peakDb: number | null; baselineDb: number | null; clipKey: string | null; clipSeconds: number | null };
type AnomPt = { t: number; y: number; a: AnomalyRow };
type Welfare = { label: string; color: string };

const dbFmt = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 10) / 10} dB`);

// ── Day/night timeline ────────────────────────────────────────────────────────
const SAST_OFFSET_MS = 2 * 3_600_000;
const sastHour = (tMs: number) => { const d = new Date(tMs + SAST_OFFSET_MS); return d.getUTCHours() + d.getUTCMinutes() / 60; };
// Smooth daylight fraction (1 = full day, 0 = full night), with ~1 h fades at sunrise/sunset.
function dayFrac(h: number): number {
  const sr = 6.5, ss = 18, fade = 1;
  if (h >= sr + fade && h <= ss - fade) return 1;
  if (h <= sr - fade || h >= ss + fade) return 0;
  if (h < sr + fade) return (h - (sr - fade)) / (2 * fade);
  return 1 - (h - (ss - fade)) / (2 * fade);
}
const DAY_RGB = [190, 226, 240], NIGHT_RGB = [16, 32, 54];
const mixRgb = (t: number) => `rgb(${DAY_RGB.map((d, i) => Math.round(NIGHT_RGB[i] + (d - NIGHT_RGB[i]) * t)).join(",")})`;

// A slim strip above the chart: fades from daylight to dark across the 24 h window, with a sun over
// midday and a moon over the small hours. Inset left/right to line up with the plot area (past the y-axis).
function DayNightStrip({ t0, t1 }: { t0: number; t1: number }) {
  if (!(t1 > t0)) return null;
  const N = 60;
  const stops: string[] = [];
  for (let i = 0; i < N; i++) {
    const f = i / (N - 1);
    stops.push(`${mixRgb(dayFrac(sastHour(t0 + f * (t1 - t0))))} ${(f * 100).toFixed(1)}%`);
  }
  const fracFor = (targetH: number) => {
    let best = 0, bd = 99;
    for (let i = 0; i < N; i++) {
      const f = i / (N - 1); const h = sastHour(t0 + f * (t1 - t0));
      let dd = Math.abs(h - targetH); dd = Math.min(dd, 24 - dd);
      if (dd < bd) { bd = dd; best = f; }
    }
    return best;
  };
  const sunF = fracFor(12.5), moonF = fracFor(1);
  return (
    <div style={{ position: "relative", height: 16, margin: "2px 8px 0" }} aria-hidden>
      <div style={{ position: "absolute", left: 28, right: 12, top: 0, bottom: 0, borderRadius: 5, overflow: "hidden", border: "1px solid rgba(0,0,0,0.06)", background: `linear-gradient(to right, ${stops.join(", ")})` }}>
        <span style={{ position: "absolute", left: `${sunF * 100}%`, top: "50%", transform: "translate(-50%,-50%)", lineHeight: 0 }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#E8A33E" strokeWidth="2.4" strokeLinecap="round"><circle cx="12" cy="12" r="4" fill="#F4B650" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" /></svg>
        </span>
        <span style={{ position: "absolute", left: `${moonF * 100}%`, top: "50%", transform: "translate(-50%,-50%)", lineHeight: 0 }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="#EAF2F2" stroke="none"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" /></svg>
        </span>
      </div>
    </div>
  );
}

function computeWelfare(series: NoiseRow[], anomalies: AnomalyRow[], now: number): Welfare {
  const recent = series.filter((r) => r.mean != null).slice(-30);
  if (!recent.length) return { label: "Awaiting audio", color: "#6B7C80" };
  const m = recent.reduce((a, r) => a + (r.mean as number), 0) / recent.length;
  const bl = recent.map((r) => r.baseline).filter((v): v is number => v != null);
  const base = bl.length ? bl.reduce((a, b) => a + b, 0) / bl.length : m;
  const delta = m - base; // dB above baseline (louder = higher, since dBFS)
  const anomLastHour = anomalies.filter((a) => now - new Date(a.time).getTime() < HOUR_MS).length;
  if (anomLastHour >= 1) return { label: "Stressed flock", color: DANGER };
  if (delta > 4) return { label: "Noisier than usual", color: DANGER };
  if (delta > 2) return { label: "Slightly elevated", color: AMBER };
  return { label: "Calm flock", color: GREEN };
}

function AnomalyDot(props: { cx?: number; cy?: number }) {
  const { cx, cy } = props;
  if (cx == null || cy == null) return <g />;
  return (
    <g style={{ cursor: "pointer" }}>
      <circle cx={cx} cy={cy} r={5} fill={DANGER} stroke="#fff" strokeWidth={1.5} />
    </g>
  );
}

export default function DashAcousticCard({ narrow }: { narrow?: boolean }) {
  const [series, setSeries] = useState<NoiseRow[]>([]);
  const [anomalies, setAnomalies] = useState<AnomalyRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [welfare, setWelfare] = useState<Welfare | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/analytics/acoustic?range=24h");
      if (res.ok) {
        const d = await res.json();
        const s: NoiseRow[] = d.series ?? [];
        const a: AnomalyRow[] = d.anomalies ?? [];
        setSeries(s); setAnomalies(a);
        setWelfare(computeWelfare(s, a, Date.now()));
      }
    } catch { /* keep last */ } finally { setLoaded(true); }
  }, []);
  useEffect(() => { load(); const id = setInterval(load, 60_000); return () => clearInterval(id); }, [load]);

  const play = useCallback(async (a: AnomalyRow) => {
    if (!a.clipKey) return;
    try {
      const res = await fetch(`/api/analytics/acoustic/clip?key=${encodeURIComponent(a.clipKey)}`);
      if (!res.ok) return;
      const { url } = await res.json();
      const el = audioRef.current;
      if (el) { el.src = url; await el.play(); setPlaying(a.clipKey); }
    } catch { /* ignore */ }
  }, []);

  // Rolling-average the per-minute readings so the trend reads clearly (raw is jumpy).
  const data = useMemo(() => {
    const pts = series.filter((r) => r.mean != null).map((r) => ({ t: new Date(r.time).getTime(), raw: r.mean as number }));
    const win = 7, half = win >> 1;
    return pts.map((p, i) => {
      const s = Math.max(0, i - half), e = Math.min(pts.length, i + half + 1);
      let sum = 0; for (let k = s; k < e; k++) sum += pts[k].raw;
      return { t: p.t, mean: Math.round((sum / (e - s)) * 10) / 10 };
    });
  }, [series]);

  // Tight y-domain around the smoothed line → curve fills the frame, x-axis sits higher.
  const { yMin, yMax } = useMemo(() => {
    const ms = data.map((d) => d.mean);
    if (!ms.length) return { yMin: -60, yMax: 0 };
    const lo = Math.min(...ms), hi = Math.max(...ms), range = hi - lo || 4;
    return { yMin: Math.round(lo - range * 0.25), yMax: Math.round(hi + range * 0.2) };
  }, [data]);

  // Anomaly dots sit ON the smoothed line (at the noise level at that moment) — markers of when a
  // spike/clip occurred; the actual loud spike is in the clip (tap to hear).
  const anomPts = useMemo<AnomPt[]>(() => {
    if (!data.length) return [];
    return anomalies.filter((a) => a.peakDb != null || a.baselineDb != null).map((a) => {
      const t = new Date(a.time).getTime();
      let y = data[0].mean, bd = Infinity;
      for (const d of data) { const dd = Math.abs(d.t - t); if (dd < bd) { bd = dd; y = d.mean; } }
      return { t, y, a };
    });
  }, [anomalies, data]);

  const current = data.length ? data[data.length - 1].mean : null;
  const height = narrow ? 150 : 180;

  return (
    <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,0.07)", borderRadius: 12, boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 15px 10px", flexWrap: "wrap" }}>
        <span style={{ fontFamily: "var(--font-d)", fontWeight: 800, fontSize: 15, color: "var(--primary)" }}>Flock noise</span>
        <span style={{ fontSize: 10.5, color: "var(--t3)", fontWeight: 600 }}>welfare · last 24 h</span>
        {welfare && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 20, background: `${welfare.color}14`, color: welfare.color, fontSize: 12, fontWeight: 800 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: welfare.color, boxShadow: `0 0 6px ${welfare.color}` }} />
            {welfare.label}
          </span>
        )}
        <span style={{ marginLeft: "auto", fontFamily: "var(--font-d)", fontWeight: 800, fontSize: 15, color: LINE }}>{dbFmt(current)}</span>
      </div>

      {/* day/night timeline above the chart */}
      {data.length > 0 && <DayNightStrip t0={data[0].t} t1={data[data.length - 1].t} />}

      {/* heat FILL under the smoothed curve: red (loud) near the line → green (calm) toward the floor */}
      <div style={{ position: "relative", height, margin: "0 8px 2px" }}>
        {data.length === 0 ? (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--t3)", fontSize: 12.5 }}>
            {loaded ? "Waiting for mic feed…" : "Loading…"}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 10, right: 12, bottom: 2, left: -12 }}>
              <defs>
                <linearGradient id="sa-noise-heat" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#DC2626" stopOpacity={0.5} />
                  <stop offset="48%" stopColor="#F59E0B" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="#16A34A" stopOpacity={0.32} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="2 4" stroke="rgba(0,0,0,0.06)" vertical={false} />
              <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]}
                tickFormatter={(ms) => new Date(ms).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false })}
                tick={{ fontSize: 9, fill: AXIS }} axisLine={false} tickLine={false} minTickGap={50} />
              <YAxis tick={{ fontSize: 9, fill: AXIS }} axisLine={false} tickLine={false} width={40} unit=" dB" domain={[yMin, yMax]} allowDataOverflow />
              <Tooltip cursor={{ stroke: LINE, strokeWidth: 1.25, strokeDasharray: "4 3" }}
                labelFormatter={(ms) => new Date(Number(ms)).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false })}
                formatter={(v, name) => (name === "Anomaly" ? null : [dbFmt(Number(v)), "Noise"])}
                contentStyle={{ background: "#002E35", border: `1px solid ${LINE}`, borderRadius: 6, fontSize: 12, color: "#fff", padding: "6px 10px" }}
                labelStyle={{ color: "#8fd0d8", fontWeight: 700, marginBottom: 2 }} />
              <Area type="monotone" dataKey="mean" name="Noise" stroke={LINE} strokeWidth={2} fill="url(#sa-noise-heat)" fillOpacity={1} baseValue={yMin} dot={false} connectNulls isAnimationActive={false} />
              <Scatter name="Anomaly" data={anomPts} dataKey="y" isAnimationActive={false}
                shape={(p) => <AnomalyDot {...(p as { cx?: number; cy?: number })} />}
                onClick={(d) => { const a = (d as unknown as { payload?: AnomPt }).payload?.a; if (a) play(a); }} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* anomaly strip — tap to hear (touch-friendly) */}
      <div style={{ padding: "9px 12px 12px", minHeight: 20 }}>
        {anomalies.length === 0 ? (
          <div style={{ fontSize: 11.5, color: "var(--t3)" }}>{loaded ? "No spikes in the last 24 h." : ""}</div>
        ) : (
          <div style={{ display: "flex", gap: 7, overflowX: "auto", paddingBottom: 2 }}>
            {[...anomalies].reverse().slice(0, 8).map((a) => {
              const on = playing != null && a.clipKey === playing;
              return (
                <button key={a.clipKey ?? a.time} onClick={() => play(a)} disabled={!a.clipKey}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0, minHeight: 34, padding: "6px 11px", border: `1px solid ${DANGER}33`, borderRadius: 20, background: on ? DANGER : `${DANGER}0f`, color: on ? "#fff" : DANGER, cursor: a.clipKey ? "pointer" : "not-allowed", fontSize: 11.5, fontWeight: 700 }}>
                  ▶ {new Date(a.time).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false })}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <audio ref={audioRef} onEnded={() => setPlaying(null)} onError={() => setPlaying(null)} style={{ display: "none" }} />
    </div>
  );
}
