"use client";

import { useEffect, useState } from "react";
import VentilationView, { type VentData } from "@/components/VentilationView";
import { timeoutSignal } from "@/lib/timeoutSignal";

// Ventilation: outside forecast vs inside readings, with plain-language suggestions.
// See docs/ventilation.md for the user story behind each block.
export default function VentilationPage() {
  const [data, setData] = useState<VentData | null>(null);
  const [error, setError] = useState(false);
  const [now, setNow] = useState(0);
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    const stop = new AbortController();
    let alive = true;
    const load = async () => {
      if (stop.signal.aborted) return;
      // Aborted when this request settles or the page unmounts, so the fallback timeout timer is cleared.
      const request = new AbortController();
      const onStop = () => request.abort();
      stop.signal.addEventListener("abort", onStop, { once: true });
      try {
        const res = await fetch("/api/ventilation", { signal: timeoutSignal(30_000, request.signal) }); // a hung request shows the error, not "Loading…" forever
        if (!res.ok) throw new Error(String(res.status));
        const d = await res.json();
        if (alive) { setData(d); setNow(Date.now()); setError(false); }
      } catch {
        if (alive) setError(true);
      } finally {
        request.abort();
        stop.signal.removeEventListener("abort", onStop);
      }
    };
    load();
    const id = window.setInterval(load, 15 * 60_000);
    return () => { alive = false; stop.abort(); window.clearInterval(id); mq.removeEventListener("change", on); };
  }, []);

  return (
    <div style={{ padding: narrow ? 10 : 20 }}>
      <h1 style={{ fontFamily: "var(--font-d)", fontSize: narrow ? 20 : 24, fontWeight: 800, color: "var(--primary)", margin: "0 0 10px" }}>Ventilation</h1>
      {error && !data && <div style={{ color: "var(--warn)", fontSize: 13 }}>Couldn&apos;t load ventilation data. Try again later.</div>}
      {!data && !error && <div style={{ color: "var(--t3)", fontSize: 13 }}>Loading…</div>}
      {data && now > 0 && <VentilationView data={data} now={now} narrow={narrow} />}
    </div>
  );
}
