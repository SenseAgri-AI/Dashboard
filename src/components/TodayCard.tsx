"use client";

import { useEffect, useState } from "react";
import {
  buildToday, streamFreshness, logFreshness, mergeThresholds,
  type DailyRow, type FarmAlert, type Freshness, type Rag, type SiloState, type TodayLine, type TodayThresholds,
} from "@/lib/todayStatus";

// "Today in 30 seconds" — one glanceable line per area, plus a freshness badge per data stream.
// Reuses /api/alerts, /api/silo-levels and the production + climate data Home already loads; the
// only new endpoint is /api/freshness (last-reading times). All rules live in lib/todayStatus.ts.

export type TodayClimate = { temperatureC: number | null; humidityPct: number | null; co2Ppm: number | null };
type FreshnessResponse = {
  streams: Partial<Record<"climate" | "silo" | "audio" | "eggCamera", string | null>>;
  water: { name: string; lastSeen?: string | null }[];
  thresholds: TodayThresholds;
  timezoneOffset: number;
};

const RAG_STYLE: Record<Rag, { dot: string; text: string; bg: string; word: string }> = {
  green: { dot: "#16A34A", text: "#166534", bg: "rgba(22,163,74,0.08)", word: "OK" },
  amber: { dot: "#D97706", text: "#92400E", bg: "rgba(217,119,6,0.10)", word: "Check" },
  red: { dot: "#DC2626", text: "#991B1B", bg: "rgba(220,38,38,0.10)", word: "Act now" },
  unknown: { dot: "#9CA3AF", text: "#4B5563", bg: "rgba(0,0,0,0.04)", word: "Unknown" },
};

const ms = (iso: string | null | undefined) => (iso === undefined ? undefined : iso === null ? null : Date.parse(iso));

export default function TodayCard({ ready, daily, lastLogDate, climate, narrow }: {
  /** Home has finished loading production + climate (success or failure). */
  ready: boolean;
  /** undefined while loading or on failure; Home passes DailyLog rows from /api/production. */
  daily?: DailyRow[];
  lastLogDate?: string | null;
  climate?: TodayClimate;
  narrow: boolean;
}) {
  const [alerts, setAlerts] = useState<{ list?: FarmAlert[]; stale?: boolean }>({});
  const [silos, setSilos] = useState<SiloState[] | undefined>(undefined);
  const [fresh, setFresh] = useState<FreshnessResponse | null>(null);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const json = (url: string) => fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))));
    Promise.allSettled([json("/api/alerts"), json("/api/silo-levels"), json("/api/freshness")]).then(([a, s, f]) => {
      if (a.status === "fulfilled" && Array.isArray(a.value.alerts)) setAlerts({ list: a.value.alerts, stale: a.value.stale === true });
      if (s.status === "fulfilled" && Array.isArray(s.value.silos)) {
        setSilos(s.value.silos.map((x: { low?: boolean }, i: number) => ({ name: `Silo ${i + 1}`, low: x.low === true })));
      }
      if (f.status === "fulfilled" && f.value.streams) setFresh(f.value);
      setNow(Date.now());
    });
  }, []);

  const t = fresh?.thresholds ?? mergeThresholds();
  const offset = fresh?.timezoneOffset ?? 2;
  const at = ready ? now : null;
  const freshness: Freshness[] = at == null ? [] : [
    streamFreshness("climate", "Climate", ms(fresh?.streams.climate), at, t),
    ...(fresh?.water.length
      ? [worstWater(fresh.water.map((m) => streamFreshness("water", "Water", ms(m.lastSeen), at, t)))]
      : [streamFreshness("water", "Water", undefined, at, t)]),
    streamFreshness("silo", "Silo", ms(fresh?.streams.silo), at, t),
    streamFreshness("audio", "Sound", ms(fresh?.streams.audio), at, t),
    logFreshness(daily === undefined ? undefined : lastLogDate ?? null, at, t, offset),
    streamFreshness("eggCamera", "Egg camera", ms(fresh?.streams.eggCamera), at, t),
  ];
  const lines: TodayLine[] | null = at == null ? null : buildToday({
    now: at, daily, lastLogDate, climate, silos, alerts: alerts.list, alertsStale: alerts.stale, freshness,
    waterMeters: fresh?.water.map((m) => ({ name: m.name, lastMs: ms(m.lastSeen) })),
  }, t);

  return (
    <section className="sa-panel" style={{ padding: 0 }} aria-label="Today in 30 seconds">
      <div className="sa-panel-hd sa-panel-hd--production">Today in 30 seconds</div>
      <div style={{ padding: narrow ? "8px 10px 10px" : "10px 14px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
        {!lines && <div style={{ color: "var(--t3)", fontSize: 13, padding: 6 }}>Checking the farm…</div>}
        {lines?.map((l) => <Line key={l.key} line={l} narrow={narrow} />)}
        {freshness.length > 0 && (
          <div aria-label="Data freshness" style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
            {freshness.map((f) => <Badge key={f.stream} f={f} />)}
          </div>
        )}
      </div>
    </section>
  );
}

function worstWater(list: Freshness[]): Freshness {
  const rank: Record<Rag, number> = { unknown: 0, green: 1, amber: 2, red: 3 };
  return list.reduce((a, b) => (rank[b.rag] > rank[a.rag] ? b : a));
}

function Line({ line, narrow }: { line: TodayLine; narrow: boolean }) {
  const s = RAG_STYLE[line.rag];
  return (
    <div style={{ display: "grid", gridTemplateColumns: narrow ? "12px 1fr" : "12px 92px minmax(0,1fr) auto", alignItems: "center", columnGap: 10, rowGap: 2, background: s.bg, padding: "9px 10px", minHeight: 44 }}>
      <span aria-label={s.word} title={s.word} style={{ width: 12, height: 12, borderRadius: 6, background: s.dot, gridRow: narrow ? "span 2" : undefined }} />
      {narrow ? (
        <>
          <div style={{ fontSize: 13.5, minWidth: 0 }}><strong style={{ color: "var(--t1)" }}>{line.label}</strong> <span style={{ color: s.text }}>{line.text}</span></div>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: s.text }}>{line.action}</div>
        </>
      ) : (
        <>
          <strong style={{ fontSize: 13.5, color: "var(--t1)" }}>{line.label}</strong>
          <span style={{ fontSize: 13.5, color: s.text, minWidth: 0 }}>{line.text}</span>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: s.text, textAlign: "right" }}>{line.action}</span>
        </>
      )}
    </div>
  );
}

function Badge({ f }: { f: Freshness }) {
  const s = RAG_STYLE[f.rag];
  return (
    <span title={`${f.label}: ${f.text}`} style={{ display: "inline-flex", alignItems: "center", gap: 5, border: `1px solid ${s.dot}55`, background: s.bg, color: s.text, fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 999 }}>
      <span style={{ width: 7, height: 7, borderRadius: 4, background: s.dot }} />
      {f.label} · {f.text}
    </span>
  );
}
