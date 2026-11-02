"use client";

// Story: when I open Home in the morning, warn me about a hot afternoon, a storm or a cold night ahead
// without having to open Ventilation. Only the "act" hot-day / cold-night prompt, one line; silent
// when there is nothing to do or the forecast can't load (the Ventilation page shows those states).
import Link from "next/link";
import { useEffect, useState } from "react";
import { buildVentilation, headsUpPrompt, type Prompt } from "@/lib/ventilation";
import type { VentData } from "@/components/VentilationView";

export default function WeatherHeadsUp() {
  const [p, setP] = useState<Prompt | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/ventilation")
      .then((r) => (r.ok ? (r.json() as Promise<VentData>) : null))
      .then((d) => {
        if (!live || !d?.outside) return;
        const v = buildVentilation({ now: Date.now(), outside: d.outside, sun: d.sun, inside: d.inside ?? [], offsetHours: d.offsetHours, thresholds: d.thresholds });
        setP(headsUpPrompt(v.prompts));
      })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  if (!p) return null;
  const hot = p.id === "hot-day" || p.id === "storm"; // warm colours for "act before the afternoon"
  return (
    <Link href="/ventilation" role="status" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none", background: hot ? "#FFF7ED" : "#EFF6FF", border: `1px solid ${hot ? "#FED7AA" : "#BFDBFE"}`, color: hot ? "#9A3412" : "#1E40AF", borderRadius: 10, padding: "9px 12px", fontSize: 13, fontWeight: 600 }}>
      <span aria-hidden>{hot ? "☀" : p.id === "storm" ? "☂" : "☾"}</span>
      <span style={{ flex: 1, minWidth: 0 }}>{p.text}</span>
      <span style={{ fontWeight: 800, whiteSpace: "nowrap" }}>Ventilation →</span>
    </Link>
  );
}
