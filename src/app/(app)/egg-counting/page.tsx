"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

// Egg Counting — live per-camera counts (InfluxDB egg_count) + annotated evidence clips (S3).
// Two Bierman collectors, one camera per A-frame house. Reads the farm-scoped /api/egg-count.
// Mobile-first: inline styles + a matchMedia hook, ≥44px targets, no horizontal scroll.

const PRIMARY = "#002E35";
const TEAL = "#2A8E9A";
const GRID = "#C8CCCC";
const PALETTE = [TEAL, "#D97706", "#7C3AED", "#166534"]; // per-camera categorical hues (fixed order)
const TICK = { fontSize: 11, fontWeight: 600, fill: "#3a4d4f", fontFamily: "Inter,sans-serif" } as const;
const AXIS_LINE = { stroke: "#BEC8CA", strokeWidth: 1 };

type Range = "24h" | "7d" | "30d";
type Camera = { cameraId: string; houseId: string | null; label: string };
type Clip = { key: string; capturedAt: string | null; url: string };
type CameraClips = Camera & { date: string | null; isFallback: boolean; clips: Clip[] };
type PerCamera = Camera & { eggsToday: number };
type SeriesPoint = { time: string } & Record<string, number | string>;
type Payload = {
  range: Range;
  cameras: Camera[];
  series: SeriesPoint[];
  totals: { perCamera: PerCamera[]; combined: number };
  clips: CameraClips[];
  liveEstimate: boolean;
};
type PlayerState = CameraClips & { selectedIdx: number; loading: boolean };

const RANGES: Range[] = ["24h", "7d", "30d"];
const todayUtc = () => new Date().toISOString().slice(0, 10);
const nInt = (v: number) => v.toLocaleString("en-ZA");

const sast = (iso: string | null | undefined, opts: Intl.DateTimeFormatOptions) =>
  iso ? new Date(iso).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", ...opts }) : "—";
const sastTime = (iso: string | null | undefined) => sast(iso, { hour: "2-digit", minute: "2-digit", hour12: false });
const sastDateTime = (iso: string | null | undefined) => sast(iso, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });

function useIsNarrow(px = 760) {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${px}px)`);
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [px]);
  return narrow;
}

function ChartTooltip({ active, payload, label, range }: {
  active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string; range: Range;
}) {
  if (!active || !payload?.length) return null;
  const when = range === "24h" ? sastTime(label) : sast(label, { day: "numeric", month: "short" });
  return (
    <div style={{ background: "#002E35", color: "#fff", fontSize: 11, padding: "6px 10px", fontFamily: "Inter,sans-serif", boxShadow: "0 2px 8px rgba(0,0,0,0.18)" }}>
      <div style={{ opacity: 0.6, marginBottom: 3 }}>{when}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color, display: "inline-block" }} />
          <span>{p.name}</span>
          <strong style={{ marginLeft: "auto" }}>{nInt(Math.round(p.value))}</strong>
        </div>
      ))}
    </div>
  );
}

export default function EggCountingPage() {
  const narrow = useIsNarrow();
  const [range, setRange] = useState<Range>("24h");
  const [data, setData] = useState<Payload | null>(null);
  const [players, setPlayers] = useState<Record<string, PlayerState>>({});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Full load: counts + totals + clips. Seeds the video players (only here — polls never touch them).
  // `isActive` guards against a stale fetch applying after the range changed / component unmounted.
  const loadFull = useCallback(async (r: Range, isActive: () => boolean) => {
    setLoaded(false);
    setError(null);
    try {
      const res = await fetch(`/api/egg-count?range=${r}`);
      if (!isActive()) return;
      if (!res.ok) { setError("Couldn't load egg-counting data."); return; }
      const payload: Payload = await res.json();
      if (!isActive()) return;
      setData(payload);
      const seeded: Record<string, PlayerState> = {};
      for (const c of payload.clips) seeded[c.cameraId] = { ...c, selectedIdx: 0, loading: false };
      setPlayers(seeded);
    } catch { if (isActive()) setError("Network error loading egg-counting data."); }
    finally { if (isActive()) setLoaded(true); }
  }, []);

  // Counts-only poll: refreshes numbers/chart without re-signing (and reloading) the videos.
  const loadCounts = useCallback(async (r: Range, isActive: () => boolean) => {
    try {
      const res = await fetch(`/api/egg-count?range=${r}&clips=0`);
      if (!res.ok || !isActive()) return;
      const payload: Payload = await res.json();
      if (!isActive()) return;
      setData((prev) => ({ ...payload, clips: prev?.clips ?? [] }));
    } catch { /* keep last */ }
  }, []);

  useEffect(() => {
    let active = true;
    const isActive = () => active;
    loadFull(range, isActive);
    const id = setInterval(() => loadCounts(range, isActive), 60_000); // counts refresh ~1/min
    return () => { active = false; clearInterval(id); };
  }, [range, loadFull, loadCounts]);

  const loadDate = useCallback(async (cameraId: string, date: string) => {
    setPlayers((p) => ({ ...p, [cameraId]: { ...p[cameraId], loading: true } }));
    try {
      const res = await fetch(`/api/egg-count/clips?camera=${encodeURIComponent(cameraId)}&date=${date}`);
      const d = res.ok ? await res.json() : { clips: [] };
      setPlayers((p) => ({
        ...p,
        [cameraId]: { ...p[cameraId], date, clips: d.clips ?? [], selectedIdx: 0, isFallback: date !== todayUtc(), loading: false },
      }));
    } catch {
      setPlayers((p) => ({ ...p, [cameraId]: { ...p[cameraId], loading: false } }));
    }
  }, []);

  const cameras = data?.cameras ?? [];
  const hasCameras = cameras.length > 0;

  return (
    <div style={{ padding: narrow ? "14px 12px 40px" : "22px 24px 48px", maxWidth: 1180, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h1 style={{ fontFamily: "var(--font-d)", fontWeight: 800, fontSize: narrow ? 20 : 26, color: PRIMARY, margin: 0, lineHeight: 1.1 }}>Egg Counting</h1>
            <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "#9A3412", background: "#FFF7ED", border: "1px solid #FED7AA", borderRadius: 999, padding: "2px 9px" }}>Pre-release</span>
          </div>
          <div style={{ fontSize: 13, color: "var(--t3)", marginTop: 3 }}>Live camera counts on the Bierman collectors — one per A-frame (A &amp; B).</div>
        </div>
        <div style={{ display: "flex", gap: 4, background: "#fff", border: "1px solid var(--divider)", borderRadius: 8, padding: 3 }}>
          {RANGES.map((r) => (
            <button key={r} onClick={() => setRange(r)}
              style={{ minWidth: 44, minHeight: 32, padding: "4px 12px", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12.5, fontWeight: 700, fontFamily: "var(--font-s)", background: range === r ? PRIMARY : "transparent", color: range === r ? "#fff" : "var(--t2)" }}>
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* Live-estimate disclaimer */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#FFF7ED", border: "1px solid #FED7AA", color: "#9A3412", padding: "8px 12px", borderRadius: 8, fontSize: 12.5, marginBottom: 18 }}>
        <span style={{ fontWeight: 800 }}>Live estimate</span>
        <span style={{ opacity: 0.9 }}>First trained model — good detection, but not yet validated against a manual hand-count.</span>
      </div>

      {!loaded ? (
        <div style={{ color: "var(--t3)", fontSize: 13, padding: "40px 0", textAlign: "center" }}>Loading egg-counting data…</div>
      ) : error ? (
        <div style={{ background: "#FEF2F2", border: "1px solid #FCA5A5", color: "#991B1B", padding: "12px 14px", borderRadius: 8, fontSize: 13 }}>{error}</div>
      ) : !hasCameras ? (
        <div style={{ background: "#fff", border: "1px solid var(--divider)", borderRadius: 10, padding: "40px 20px", textAlign: "center", color: "var(--t3)", fontSize: 13.5 }}>
          No egg-counting cameras found for this farm yet.
        </div>
      ) : (
        <>
          {/* Totals */}
          <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr 1fr" : `repeat(${(data!.totals.perCamera.length) + 1}, minmax(0,1fr))`, gap: 10, marginBottom: 18 }}>
            {data!.totals.perCamera.map((c, i) => (
              <TotalCard key={c.cameraId} label={c.label} sub={c.cameraId} value={c.eggsToday} accent={PALETTE[i % PALETTE.length]} />
            ))}
            <TotalCard label="Total today" sub="both A-frames" value={data!.totals.combined} accent={PRIMARY} highlight />
          </div>

          {/* Counts over time */}
          <section style={{ background: "#fff", border: "1px solid var(--divider)", borderRadius: 10, padding: narrow ? "12px 8px 8px" : "14px 16px 10px", marginBottom: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 6px 8px" }}>
              <span style={{ fontFamily: "var(--font-d)", fontWeight: 800, fontSize: 14, color: PRIMARY }}>Eggs counted over time</span>
              <span style={{ fontSize: 11, color: "var(--t3)", marginLeft: "auto" }}>per camera · {range}</span>
            </div>
            {data!.series.length === 0 ? (
              <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--t3)", fontSize: 13 }}>
                No collection recorded in this window yet.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={narrow ? 220 : 300}>
                <AreaChart data={data!.series} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
                  <defs>
                    {cameras.map((c, i) => (
                      <linearGradient key={c.cameraId} id={`egg-grad-${c.cameraId}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={PALETTE[i % PALETTE.length]} stopOpacity={0.24} />
                        <stop offset="95%" stopColor={PALETTE[i % PALETTE.length]} stopOpacity={0.03} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid stroke={GRID} vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="time" tick={TICK} tickLine={false} axisLine={AXIS_LINE}
                    tickFormatter={(t: string) => (range === "24h" ? sastTime(t) : sast(t, { day: "numeric", month: "short" }))}
                    minTickGap={narrow ? 40 : 60} />
                  <YAxis tick={TICK} tickLine={false} axisLine={AXIS_LINE} width={38} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip range={range} />} />
                  <Legend wrapperStyle={{ fontSize: 12, fontWeight: 600 }} iconType="plainline" />
                  {cameras.map((c, i) => (
                    <Area key={c.cameraId} type="monotone" dataKey={c.cameraId} name={c.label}
                      stroke={PALETTE[i % PALETTE.length]} strokeWidth={2} fill={`url(#egg-grad-${c.cameraId})`}
                      dot={false} activeDot={{ r: 3.5, strokeWidth: 0 }} isAnimationActive={false} connectNulls />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            )}
          </section>

          {/* Video players */}
          <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "1fr 1fr", gap: 14 }}>
            {cameras.map((c, i) => (
              <PlayerCard key={c.cameraId} camera={c} accent={PALETTE[i % PALETTE.length]}
                state={players[c.cameraId]} onSelectClip={(idx) => setPlayers((p) => ({ ...p, [c.cameraId]: { ...p[c.cameraId], selectedIdx: idx } }))}
                onChangeDate={(d) => loadDate(c.cameraId, d)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function TotalCard({ label, sub, value, accent, highlight }: { label: string; sub: string; value: number; accent: string; highlight?: boolean }) {
  return (
    <div style={{ background: highlight ? PRIMARY : "#fff", border: highlight ? "none" : "1px solid var(--divider)", borderLeft: highlight ? "none" : `3px solid ${accent}`, borderRadius: 10, padding: "12px 14px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)", minWidth: 0 }}>
      <div style={{ fontSize: 9.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.09em", color: highlight ? "rgba(255,255,255,0.75)" : "var(--t2)" }}>{label}</div>
      <div style={{ fontFamily: "var(--font-d)", fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.1, color: highlight ? "#fff" : accent, marginTop: 2 }}>{nInt(value)}</div>
      <div style={{ fontSize: 10.5, color: highlight ? "rgba(255,255,255,0.6)" : "var(--t3)", marginTop: 1 }}>{sub}</div>
    </div>
  );
}

function PlayerCard({ camera, accent, state, onSelectClip, onChangeDate }: {
  camera: Camera; accent: string; state: PlayerState | undefined;
  onSelectClip: (idx: number) => void; onChangeDate: (date: string) => void;
}) {
  const clips = state?.clips ?? [];
  const selected = clips[state?.selectedIdx ?? 0];
  const date = state?.date ?? "";
  // Play through the transcode proxy (mp4v → H.264) so it plays inline in the browser.
  const streamSrc = selected ? `/api/egg-count/clip-stream?key=${encodeURIComponent(selected.key)}` : "";

  return (
    <div style={{ background: "#fff", border: "1px solid var(--divider)", borderRadius: 10, overflow: "hidden", display: "flex", flexDirection: "column", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderBottom: "1px solid var(--divider)" }}>
        <span style={{ width: 8, height: 8, borderRadius: 2, background: accent, flexShrink: 0 }} />
        <span style={{ fontFamily: "var(--font-d)", fontWeight: 800, fontSize: 14, color: PRIMARY }}>{camera.label}</span>
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--t3)", border: "1px solid var(--divider)", borderRadius: 3, padding: "1px 6px" }}>{camera.cameraId}</span>
        {selected && <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--t3)" }}>{sastTime(selected.capturedAt)}</span>}
      </div>

      <div style={{ background: "#000", position: "relative", aspectRatio: "16 / 9", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {state?.loading ? (
          <span style={{ color: "rgba(255,255,255,0.6)", fontSize: 13 }}>Loading clips…</span>
        ) : selected ? (
          <video key={selected.key} src={streamSrc} controls playsInline preload="metadata"
            style={{ width: "100%", height: "100%", objectFit: "contain", background: "#000" }} />
        ) : (
          <span style={{ color: "rgba(255,255,255,0.55)", fontSize: 13, padding: "0 16px", textAlign: "center" }}>No clips available for this camera yet.</span>
        )}
      </div>

      {state?.isFallback && date && (
        <div style={{ fontSize: 11.5, color: "#9A3412", background: "#FFF7ED", padding: "5px 14px", borderBottom: "1px solid #FED7AA" }}>
          No collection yet today — showing the latest clips from {sast(date + "T12:00:00Z", { day: "numeric", month: "short" })}.
        </div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "10px 14px", flexWrap: "wrap" }}>
        <select value={state?.selectedIdx ?? 0} onChange={(e) => onSelectClip(Number(e.target.value))} disabled={!clips.length}
          style={{ flex: 1, minWidth: 130, minHeight: 40, padding: "8px 10px", border: "1px solid var(--divider)", borderRadius: 8, fontSize: 13, fontFamily: "var(--font-s)", background: "#fff", color: "var(--t1)" }}>
          {clips.length ? clips.map((c, i) => (
            <option key={c.key} value={i}>Clip {i + 1} · {sastDateTime(c.capturedAt)}</option>
          )) : <option>No clips</option>}
        </select>
        <input type="date" value={date} max={todayUtc()} onChange={(e) => e.target.value && onChangeDate(e.target.value)}
          style={{ minHeight: 40, padding: "8px 10px", border: "1px solid var(--divider)", borderRadius: 8, fontSize: 13, fontFamily: "var(--font-s)", background: "#fff", color: "var(--t1)" }} />
        {selected && (
          <a href={streamSrc} target="_blank" rel="noreferrer" title="Open the clip in a new tab"
            style={{ display: "inline-flex", alignItems: "center", gap: 5, minHeight: 40, padding: "8px 12px", border: `1px solid ${accent}`, borderRadius: 8, fontSize: 13, fontWeight: 700, color: accent, textDecoration: "none", background: "#fff" }}>
            Open ↗
          </a>
        )}
      </div>
    </div>
  );
}
