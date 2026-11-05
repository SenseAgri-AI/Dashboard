"use client";

// Story: when I open Home in the morning, warn me about a hot afternoon, a storm or a cold night ahead
// without having to open Ventilation. Only the most urgent "act" prompt (storm now, storm soon, hot day,
// cold night), one line; silent
// when there is nothing to do or the forecast can't load (the Ventilation page shows those states).
import type React from "react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { buildVentilation, headsUpPrompt, type Prompt } from "@/lib/ventilation";
import type { VentData } from "@/components/VentilationView";
import { timeoutSignal } from "@/lib/timeoutSignal";

export default function WeatherHeadsUp({ style }: { style?: React.CSSProperties }) {
  const [p, setP] = useState<Prompt | null>(null);
  // Story: Home left open on a phone in the shed should still show "House cooled fast" when a storm hits,
  // so re-check every 10 min (the route caches the forecast for 30 min; inside readings are 30-min means).
  useEffect(() => {
    let live = true;
    const load = () => fetch("/api/ventilation", { signal: timeoutSignal(30_000) })
      .then((r) => (r.ok ? (r.json() as Promise<VentData>) : null))
      .then((d) => {
        if (!live || !d?.outside) return;
        const v = buildVentilation({ now: Date.now(), outside: d.outside, sun: d.sun, inside: d.inside ?? [], offsetHours: d.offsetHours, thresholds: d.thresholds });
        setP(headsUpPrompt(v.prompts));
      })
      .catch(() => {});
    load();
    // Skip the poll while the tab is hidden; catch up as soon as it's shown again.
    const id = setInterval(() => { if (!document.hidden) load(); }, 10 * 60_000);
    const onShow = () => { if (!document.hidden) load(); };
    document.addEventListener("visibilitychange", onShow);
    return () => { live = false; clearInterval(id); document.removeEventListener("visibilitychange", onShow); };
  }, []);
  if (!p) return null;
  const wet = p.id === "storm" || p.id === "storm-now";
  const hot = p.id === "hot-day" || wet; // warm colours: act before the afternoon / the storm
  return (
    <Link href="/ventilation" role="status" style={{ ...style, display: "flex", alignItems: "center", gap: 8, textDecoration: "none", background: hot ? "#FFF7ED" : "#EFF6FF", border: `1px solid ${hot ? "#FED7AA" : "#BFDBFE"}`, color: hot ? "#9A3412" : "#1E40AF", borderRadius: 10, padding: "9px 12px", fontSize: 13, fontWeight: 600 }}>
      <span aria-hidden>{wet ? "☂" : hot ? "☀" : "☾"}</span>
      <span style={{ flex: 1, minWidth: 0 }}>{p.text}</span>
      <span style={{ fontWeight: 800, whiteSpace: "nowrap" }}>Ventilation →</span>
    </Link>
  );
}
