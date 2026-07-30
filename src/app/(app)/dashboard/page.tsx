"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { type AlertItem } from "@/components/DashAlertRow";
import DashAlertChat from "@/components/DashAlertChat";
import DashAcousticCard from "@/components/DashAcousticCard";
import DashEnvCol, { type EnvData } from "@/components/DashEnvCol";
import { DashKpiGrid, type ProductionData } from "@/components/DashMetricCol";

interface DashboardSummary {
  env: EnvData;
  metrics: { vapour_pressure: number | null };
  alerts: AlertItem[];
  updatedAt: string;
}

// Responsive without CSS media queries (globals.css can go stale in dev).
function useIsNarrow(bp = 760): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${bp}px)`);
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [bp]);
  return narrow;
}

export default function DashboardPage() {
  const router = useRouter();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [production, setProduction] = useState<ProductionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isNarrow = useIsNarrow();

  const fetchAll = useCallback(async () => {
    try {
      const [summaryRes, productionRes] = await Promise.all([
        fetch("/api/dashboard/summary"),
        fetch("/api/production"),
      ]);
      if (summaryRes.status === 401) { router.push("/sign-in"); return; }
      if (!summaryRes.ok) {
        const data = await summaryRes.json();
        setError(data.error ?? "Failed to load sensor data");
        return;
      }
      setSummary(await summaryRes.json());
      setError(null);
      if (productionRes.ok) setProduction(await productionRes.json());
    } catch {
      setError("Connection error — check your network");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, 30 * 60 * 1000);
    return () => clearInterval(id);
  }, [fetchAll]);

  if (loading) {
    return <main className="sa-main"><div style={{ color: "var(--t3)", fontSize: 13, padding: "60px 0", textAlign: "center" }}>Loading dashboard…</div></main>;
  }
  if (error) {
    return <main className="sa-main"><div style={{ color: "var(--danger)", fontSize: 13, padding: "60px 0", textAlign: "center" }}>{error}</div></main>;
  }

  return (
    <main className="sa-main" style={{ maxWidth: 1240, width: "100%", margin: "0 auto", gap: 14 }}>
      {/* Production KPIs */}
      <DashKpiGrid production={production} narrow={isNarrow} />

      {/* Flock-noise welfare heat */}
      <DashAcousticCard narrow={isNarrow} />

      {/* Environment + alerts */}
      <div style={{ display: "grid", gridTemplateColumns: isNarrow ? "1fr" : "minmax(0, 1fr) 340px", gap: 14, alignItems: "start" }}>
        <DashEnvCol env={summary?.env ?? null} narrow={isNarrow} />
        <DashAlertChat alerts={summary?.alerts ?? []} updatedAt={summary?.updatedAt} />
      </div>
    </main>
  );
}
