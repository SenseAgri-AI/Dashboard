"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import DashStatusBar from "@/components/DashStatusBar";
import { type AlertItem } from "@/components/DashAlertRow";
import DashAlertChat from "@/components/DashAlertChat";
import DashAcousticCard from "@/components/DashAcousticCard";
import DashEnvCol, { type EnvData } from "@/components/DashEnvCol";
import { DashKpiGrid, type ProductionData } from "@/components/DashMetricCol";

interface DashboardSummary {
  env: EnvData;
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
        router.push("/sign-in");
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
      <main className="sa-main">
        <div style={{ color: "var(--t3)", fontSize: 13, padding: "60px 0", textAlign: "center", fontFamily: "var(--font-s)" }}>
          Loading sensor data…
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="sa-main">
        <div style={{ color: "var(--danger)", fontSize: 13, padding: "60px 0", textAlign: "center", fontFamily: "var(--font-s)" }}>
          {error}
        </div>
      </main>
    );
  }

  return (
    <main className="sa-main">
      {/* Top — compact health gauge + equal-size KPI cards */}
      <div style={{ display: "grid", gridTemplateColumns: "200px minmax(0, 1fr)", gap: 10, alignItems: "stretch" }}>
        <DashStatusBar
          health={summary?.health ?? 0}
          word={summary?.healthWord ?? "Unknown"}
          label={summary?.healthLabel ?? "normal"}
        />
        <DashKpiGrid production={production} />
      </div>

      {/* Welfare — flock-noise acoustic tracker (full width) */}
      <div style={{ marginTop: 10 }}>
        <DashAcousticCard />
      </div>

      {/* Body — environment plots (stacked) on the left, alerts chat on the right */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 340px", gap: 10, alignItems: "stretch", marginTop: 10 }}>
        <DashEnvCol env={summary?.env ?? null} />
        <DashAlertChat alerts={summary?.alerts ?? []} updatedAt={summary?.updatedAt} />
      </div>
    </main>
  );
}
