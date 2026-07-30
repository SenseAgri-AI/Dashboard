"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

// Compact flock-noise welfare tracker for the dashboard: 24 h noise sparkline + recent spike
// anomalies you can listen to. Reads the same farm-scoped acoustic API the Analytics section uses.
const TEAL = "#2A8E9A";
const DANGER = "#B91C1C";
const GRID = "#C8CCCC";
const TICK = { fontSize: 11, fontWeight: 600, fill: "#3a4d4f", fontFamily: "Inter,sans-serif" } as const;
const AXIS_LINE = { stroke: "#BEC8CA", strokeWidth: 1 };
const HOUR_MS = 3_600_000;

type NoiseRow = { time: string; mean: number | null; max: number | null; baseline: number | null };
type AnomalyRow = { time: string; peakDb: number | null; baselineDb: number | null; clipKey: string | null; clipSeconds: number | null };

const fmtTime = (ts: string) => new Date(ts).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false });
const dbFmt = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 10) / 10} dB`);
const anomKey = (a: AnomalyRow) => a.clipKey ?? a.time;

function NoiseTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#002E35", color: "#fff", fontSize: 10, padding: "3px 8px", fontFamily: "Inter,sans-serif", boxShadow: "0 2px 8px rgba(0,0,0,0.18)" }}>
      <span style={{ opacity: 0.55, marginRight: 5 }}>{label}</span>
      <strong>{dbFmt(payload[0].value)}</strong>
    </div>
  );
}

export default function DashAcousticCard() {
  const [series, setSeries] = useState<NoiseRow[]>([]);
  const [anomalies, setAnomalies] = useState<AnomalyRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [lastHour, setLastHour] = useState(0);
  const [playing, setPlaying] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/analytics/acoustic?range=24h");
      if (res.ok) {
        const d = await res.json();
        const anoms: AnomalyRow[] = d.anomalies ?? [];
        const nowMs = Date.now();
        setSeries(d.series ?? []);
        setAnomalies(anoms);
        setLastHour(anoms.filter((a) => nowMs - new Date(a.time).getTime() < HOUR_MS).length);
      }
    } catch { /* keep last */ } finally { setLoaded(true); }
  }, []);
  useEffect(() => { load(); const id = setInterval(load, 60_000); return () => clearInterval(id); }, [load]); // ~1 reading/min

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

  const points = useMemo(() => series.filter((r) => r.mean != null).map((r) => ({ t: fmtTime(r.time), v: r.mean as number })), [series]);
  const current = points.length ? points[points.length - 1].v : null;
  // dBFS is negative (0 = loudest) — scale to the working range, never assume a 0 baseline.
  const domain = useMemo<[number, number]>(() => {
    const vals = points.map((p) => p.v);
    const lo = vals.length ? Math.min(...vals) : -60;
    const hi = vals.length ? Math.max(...vals) : 0;
    const pad = Math.max(1, (hi - lo) * 0.2);
    return [Math.floor(lo - pad), Math.ceil(hi + pad)];
  }, [points]);

  const recent = useMemo(() => [...anomalies].reverse(), [anomalies]); // newest first
  const calm = anomalies.length === 0;

  const status = !loaded ? { text: "Loading…", color: "var(--t3)" }
    : lastHour > 0 ? { text: `${lastHour} spike${lastHour === 1 ? "" : "s"} in last hour`, color: DANGER }
    : calm ? { text: "Flock calm", color: "#166534" }
    : { text: "No recent spikes", color: "var(--t3)" };

  return (
    <div style={{ border: "1px solid var(--divider)", background: "#fff", display: "flex", flexDirection: "column", minWidth: 0 }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid var(--divider)", background: "var(--card-alt)" }}>
        <span style={{ fontFamily: "var(--font-d)", fontWeight: 800, fontSize: 14, color: "var(--primary)" }}>Flock noise</span>
        <span style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: TEAL, border: `1px solid ${TEAL}`, padding: "1px 6px", borderRadius: 3 }}>Welfare</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, marginLeft: "auto", fontSize: 11.5, fontWeight: 700, color: status.color }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: status.color, display: "inline-block" }} />
          {status.text}
        </span>
        <span style={{ fontFamily: "var(--font-d)", fontWeight: 800, fontSize: 15, color: TEAL, marginLeft: 4 }}>{dbFmt(current)}</span>
      </div>

      {/* body: sparkline + anomaly inbox */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 300px", gap: 0 }}>
        <div style={{ padding: "10px 8px 6px", minWidth: 0, borderRight: "1px solid var(--divider)" }}>
          {points.length === 0 ? (
            <div style={{ height: 150, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--t3)", fontSize: 12.5 }}>
              {loaded ? "Waiting for mic feed…" : "Loading noise data…"}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={150}>
              <AreaChart data={points} margin={{ top: 6, right: 10, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="sa-noise-g" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={TEAL} stopOpacity={0.22} />
                    <stop offset="95%" stopColor={TEAL} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={GRID} vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="t" tick={TICK} tickLine={false} axisLine={AXIS_LINE} interval={Math.max(1, Math.floor(points.length / 5))} />
                <YAxis domain={domain} tick={TICK} tickLine={false} axisLine={AXIS_LINE} width={40} tickFormatter={(v: number) => `${Math.round(v)}`} />
                <Tooltip content={<NoiseTooltip />} cursor={{ stroke: TEAL, strokeWidth: 1, strokeOpacity: 0.5 }} />
                <Area type="monotone" dataKey="v" stroke={TEAL} strokeWidth={1.8} fill="url(#sa-noise-g)" dot={false} activeDot={{ r: 3.5, fill: TEAL, strokeWidth: 0 }} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
          <div style={{ fontSize: 10.5, color: "var(--t3)", padding: "2px 6px 0" }}>Relative dBFS · 24 h · includes fan noise</div>
        </div>

        <div style={{ padding: "8px 10px", display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div style={{ fontSize: 9.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--t3)", padding: "2px 2px 6px" }}>Recent anomalies</div>
          {recent.length === 0 ? (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--t3)", fontSize: 12, textAlign: "center", padding: "8px 4px" }}>
              {loaded ? "No spikes in the last 24 h." : "…"}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, overflowY: "auto", maxHeight: 132 }}>
              {recent.slice(0, 6).map((a) => {
                const on = playing != null && a.clipKey === playing;
                return (
                  <button key={anomKey(a)} onClick={() => play(a)} disabled={!a.clipKey}
                    title={a.clipKey ? "Play clip" : "Clip unavailable"}
                    style={{ display: "flex", alignItems: "center", gap: 8, textAlign: "left", padding: "5px 7px", border: "1px solid var(--divider)", borderLeft: `3px solid ${DANGER}`, background: on ? "var(--card-alt)" : "#fff", cursor: a.clipKey ? "pointer" : "not-allowed", opacity: a.clipKey ? 1 : 0.6 }}>
                    <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: "50%", background: on ? DANGER : "rgba(185,28,28,0.1)", color: on ? "#fff" : DANGER, flexShrink: 0, fontSize: 10 }}>▶</span>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--t1)" }}>{new Date(a.time).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false })}</span>
                    <span style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--t2)" }}>peak {dbFmt(a.peakDb)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
      <audio ref={audioRef} onEnded={() => setPlaying(null)} onError={() => setPlaying(null)} style={{ display: "none" }} />
    </div>
  );
}
