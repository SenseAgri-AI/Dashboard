"use client";

import { useEffect, useState } from "react";
import { buildThisWeek, type WeekDaily, type WeekInsideDay, type WeekLine, type WeekWaterDay } from "@/lib/thisWeek";

// Home "This week" card: last 7 complete days vs the 7 before (eggs, deaths, water, hottest inside day).
// Rules and user stories: lib/thisWeek.ts and docs/this-week.md. Each source loads on its own, so a slow
// or failed one never blanks the others.

const COLOR = { neutral: "var(--t1)", amber: "#92400E", unknown: "var(--t3)" };

export default function ThisWeekCard({ ready, daily, narrow }: { ready: boolean; daily?: WeekDaily[]; narrow: boolean }) {
  const [water, setWater] = useState<WeekWaterDay[] | "loading" | undefined>("loading");
  const [inside, setInside] = useState<WeekInsideDay[] | "loading" | undefined>("loading");
  const [offset, setOffset] = useState(2);
  const [now] = useState<number>(() => Date.now());

  useEffect(() => {
    // A hung request gives up after 30 s and its line reads "couldn't load", instead of "Loading…" forever.
    const json = (url: string) => fetch(url, { signal: AbortSignal.timeout(30_000) }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))));
    json("/api/water-use").then((w) => setWater(Array.isArray(w.days) ? w.days : undefined)).catch(() => setWater(undefined));
    json("/api/this-week").then((d) => {
      setInside(Array.isArray(d.inside) ? d.inside : undefined);
      if (Number.isFinite(d.timezoneOffset)) setOffset(d.timezoneOffset);
    }).catch(() => setInside(undefined));
  }, []);

  const week = ready ? buildThisWeek({ now, offsetHours: offset, daily, water, inside }) : null;
  const loading = water === "loading" || inside === "loading";

  return (
    <section className="sa-panel" style={{ padding: 0 }} aria-label="This week">
      <div className="sa-panel-hd sa-panel-hd--production">This week{week ? ` · ${week.range} vs the week before` : ""}</div>
      <div style={{ padding: narrow ? "6px 10px 10px" : "8px 14px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
        {!week && <div style={{ fontSize: 13, color: "var(--t3)", padding: "6px 2px" }}>Loading…</div>}
        {week?.lines.map((l) => <Row key={l.key} line={l} narrow={narrow} />)}
        {week && loading && <div style={{ fontSize: 12, color: "var(--t3)", padding: "2px 2px 0" }}>Loading water and temperature…</div>}
      </div>
    </section>
  );
}

function Row({ line, narrow }: { line: WeekLine; narrow: boolean }) {
  const c = COLOR[line.rag];
  return (
    <div style={{ display: "grid", gridTemplateColumns: narrow ? "92px minmax(0,1fr)" : "120px minmax(0,1fr) auto", columnGap: 10, rowGap: 1, alignItems: "baseline",
      padding: "7px 8px", background: line.rag === "amber" ? "rgba(217,119,6,0.10)" : "transparent", borderBottom: "1px solid var(--divider)" }}>
      <strong style={{ fontSize: 13, color: "var(--t2)" }}>{line.label}</strong>
      <span style={{ fontSize: 14, fontWeight: 800, color: line.rag === "unknown" ? c : "var(--t1)", fontFamily: "var(--font-d)" }}>{line.value}</span>
      <span style={{ fontSize: 12.5, color: c, fontWeight: line.rag === "amber" ? 700 : 500, gridColumn: narrow ? "2" : undefined, textAlign: narrow ? "left" : "right" }}>{line.change}</span>
      {line.note && <span style={{ fontSize: 12, color: line.rag === "amber" ? c : "var(--t3)", fontWeight: line.rag === "amber" ? 700 : 400, gridColumn: narrow ? "2" : "2 / -1" }}>{line.note}</span>}
    </div>
  );
}
