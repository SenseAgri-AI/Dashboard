"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import DashNav from "@/components/DashNav";
import DashStatusBar from "@/components/DashStatusBar";
import DashAlertRow, { type AlertItem } from "@/components/DashAlertRow";
import DashEnvCol, { type EnvData } from "@/components/DashEnvCol";
import { DashKpiGrid, type ProductionData } from "@/components/DashMetricCol";
import DashTrendsCarousel from "@/components/DashTrendsCarousel";

interface DashboardSummary {
  env: EnvData;
  operational?: {
    feed?: { sparkline: { time: string; value: number; cumulative?: number }[] };
  };
  metrics: { vapour_pressure: number | null };
  health: number;
  healthWord: string;
  healthLabel: "good" | "normal" | "warning" | "danger";
  alerts: AlertItem[];
  updatedAt: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [production, setProduction] = useState<ProductionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [summaryRes, productionRes] = await Promise.all([
        fetch("/api/dashboard/summary"),
        fetch("/api/production"),
      ]);

      if (summaryRes.status === 401) {
        router.push("/login");
        return;
      }

      if (!summaryRes.ok) {
        const data = await summaryRes.json();
        setError(data.error ?? "Failed to load sensor data");
        return;
      }

      const summaryData = await summaryRes.json();
      setSummary(summaryData);
      setError(null);

      if (productionRes.ok) {
        const prodData = await productionRes.json();
        setProduction(prodData);
      }
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
    return (
      <>
        <DashNav loading />
        <main className="sa-main">
          <div style={{ color: "var(--t3)", fontSize: 13, padding: "60px 0", textAlign: "center", fontFamily: "var(--font-s)" }}>
            Loading sensor data…
          </div>
        </main>
      </>
    );
  }

  if (error) {
    return (
      <>
        <DashNav />
        <main className="sa-main">
          <div style={{ color: "var(--danger)", fontSize: 13, padding: "60px 0", textAlign: "center", fontFamily: "var(--font-s)" }}>
            {error}
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <DashNav />
      <main className="sa-main">

        {/* Row 1 — Overview: gauge + combined KPI card + alert stack */}
        <div className="sa-overview-row">
          <DashStatusBar
            health={summary?.health ?? 0}
            word={summary?.healthWord ?? "Unknown"}
            label={summary?.healthLabel ?? "normal"}
          />
          <DashKpiGrid production={production} env={summary?.env ?? null} />
          <div className="sa-alert-stack">
            {(summary?.alerts ?? []).slice(0, 4).map((a) => (
              <div key={a.metric} className={`sa-alert-card ${a.status}`} style={{ flex: 1 }}>
                <div className="sa-alert-metric">{a.metric}</div>
                <div className="sa-alert-conclusion">{a.message}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Row 3 — Environmental sparklines */}
        <DashEnvCol env={summary?.env ?? null} />

        {/* Row 3 — Trends carousel + operational meters */}
        <DashTrendsCarousel
          production={production}
          waterSeries={summary?.env?.water?.sparkline ?? []}
          feedSeries={summary?.operational?.feed?.sparkline ?? []}
        />

      </main>
    </>
  );
}
