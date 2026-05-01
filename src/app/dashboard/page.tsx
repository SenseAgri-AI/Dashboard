"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import DashNav from "@/components/DashNav";
import DashStatusBar from "@/components/DashStatusBar";
import DashAlertRow, { type AlertItem } from "@/components/DashAlertRow";
import DashEnvCol, { type EnvData } from "@/components/DashEnvCol";
import DashMetricCol from "@/components/DashMetricCol";
import DashTrendsCarousel from "@/components/DashTrendsCarousel";

interface DashboardSummary {
  env: EnvData;
  metrics: { vapour_pressure: number | null };
  health: number;
  healthWord: string;
  healthLabel: "normal" | "warning" | "danger";
  alerts: AlertItem[];
  updatedAt: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSummary = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard/summary");
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed to load sensor data");
        return;
      }
      const data = await res.json();
      setSummary(data);
      setError(null);
    } catch {
      setError("Connection error — check your network");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    fetchSummary();
    const id = setInterval(fetchSummary, 60_000);
    return () => clearInterval(id);
  }, [fetchSummary]);

  if (loading) {
    return (
      <>
        <DashNav loading />
        <main className="sa-main">
          <div
            style={{
              color: "var(--t3)",
              fontSize: 13,
              padding: "60px 0",
              textAlign: "center",
              fontFamily: "var(--font-s)",
            }}
          >
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
          <div
            style={{
              color: "var(--danger)",
              fontSize: 13,
              padding: "60px 0",
              textAlign: "center",
              fontFamily: "var(--font-s)",
            }}
          >
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
        <DashStatusBar
          health={summary?.health ?? 0}
          word={summary?.healthWord ?? "Unknown"}
          label={summary?.healthLabel ?? "normal"}
        />
        <DashAlertRow alerts={summary?.alerts ?? []} />
        <div className="sa-col-grid">
          <DashEnvCol env={summary?.env ?? null} />
          <DashMetricCol
            env={summary?.env ?? null}
            vapourPressure={summary?.metrics?.vapour_pressure ?? null}
          />
          <DashTrendsCarousel />
        </div>
      </main>
    </>
  );
}
