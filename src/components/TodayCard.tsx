"use client";

import { useEffect, useState } from "react";
import { buildToday, type DailyRow, type ExtraItem, type FarmAlert, type Rag, type SeriesPoint, type SiloState, type TodayResult, type TodayThresholds } from "@/lib/todayStatus";

// "Today" card — a headline, two always-on lines (Birds, Climate) and lines that appear only on a
// problem (Water, Feed silo, Sensors). One footer when any check failed to load. Rules and the user
// story behind each line: lib/todayStatus.ts and docs/today-card.md. Reuses /api/alerts and
// /api/silo-levels plus the production + climate data Home already loads; /api/freshness is the
// only new endpoint (last-reading times).

export type TodayClimate = { temperatureC: number | null; humidityPct: number | null; co2Series: SeriesPoint[] };
type FreshnessResponse = {
  streams: { climate?: string | null; silo?: string | null };
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

export default function TodayCard({ ready, daily, lastLogDate, climate, extras, narrow }: {
  /** Home has finished loading production + climate (success or failure). */
  ready: boolean;
  /** undefined = failed to load. Home passes DailyLog rows from /api/production. */
  daily?: DailyRow[];
  lastLogDate?: string | null;
  climate?: TodayClimate;
  /** Home attention-list items (lib/attention.ts). */
  extras?: ExtraItem[];
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

  const result: TodayResult | null = !ready || now == null ? null : buildToday({
    now, daily, lastLogDate, climate, silos, extras,
    alerts: alerts.list, alertsStale: alerts.stale,
    climateLastMs: fresh ? ms(fresh.streams.climate) : undefined, // omitted key = that query failed
    siloLastMs: fresh ? ms(fresh.streams.silo) : undefined,
    waterMeters: fresh?.water.map((m) => ({ name: m.name, lastMs: ms(m.lastSeen) })),
    offsetHours: fresh?.timezoneOffset ?? 2,
  }, fresh?.thresholds);

  const headColor = !result ? "var(--t3)" : result.problems === 0 ? RAG_STYLE.green.text
    : result.lines.some((l) => l.rag === "red") ? RAG_STYLE.red.text : RAG_STYLE.amber.text;

  return (
    <section className="sa-panel" style={{ padding: 0, display: "flex", flexDirection: "column" }} aria-label="Today">
      <div className="sa-panel-hd sa-panel-hd--production">Today</div>
      <div style={{ padding: narrow ? "8px 10px 10px" : "10px 14px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
        <div role="status" style={{ fontFamily: "var(--font-d)", fontSize: narrow ? 18 : 20, fontWeight: 800, color: headColor, padding: "2px 2px 4px" }}>
          {result ? result.headline : "Checking the farm…"}
        </div>
        {result?.lines.map((l) => <Line key={l.key} rag={l.rag} label={l.label} text={l.text} action={l.action} narrow={narrow} />)}
        {result?.someChecksFailed && (
          <div style={{ fontSize: 12, color: "var(--t3)", padding: "2px 2px 0" }}>Some checks didn&apos;t load — try again later.</div>
        )}
      </div>
    </section>
  );
}

function Line({ rag, label, text, action, narrow }: { rag: Rag; label: string; text: string; action: string; narrow: boolean }) {
  const s = RAG_STYLE[rag];
  const quiet = rag === "green";
  return (
    <div style={{ display: "grid", gridTemplateColumns: narrow ? "12px 1fr" : "12px 84px minmax(0,1fr) auto", alignItems: "center", columnGap: 10, rowGap: 2, background: s.bg, padding: "9px 10px", minHeight: 44 }}>
      <span aria-label={s.word} title={s.word} style={{ width: 12, height: 12, borderRadius: 6, background: s.dot, gridRow: narrow && !quiet ? "span 2" : undefined }} />
      {narrow ? (
        <>
          <div style={{ fontSize: 13.5, minWidth: 0 }}><strong style={{ color: "var(--t1)" }}>{label}</strong> <span style={{ color: s.text }}>{text}</span></div>
          {!quiet && <div style={{ fontSize: 12.5, fontWeight: 700, color: s.text }}>{action}</div>}
        </>
      ) : (
        <>
          <strong style={{ fontSize: 13.5, color: "var(--t1)" }}>{label}</strong>
          <span style={{ fontSize: 13.5, color: s.text, minWidth: 0 }}>{text}</span>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: s.text, textAlign: "right" }}>{quiet ? "" : action}</span>
        </>
      )}
    </div>
  );
}
