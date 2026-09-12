"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { type AlertItem } from "@/components/DashAlertRow";
import DashAlertChat from "@/components/DashAlertChat";
import type { Alert, AlertSeverity } from "@/lib/alerts";
import DashAcousticCard from "@/components/DashAcousticCard";
import DashSleepScore from "@/components/DashSleepScore";
import DashEnvCol, { type EnvData } from "@/components/DashEnvCol";
import { DashKpiGrid, type ProductionData } from "@/components/DashMetricCol";
import DashFeedWater from "@/components/DashFeedWater";
import type { SiloLevelsData } from "@/components/DashSiloLevels";

interface DashboardSummary {
  env: EnvData;
  metrics: { vapour_pressure: number | null };
  alerts: AlertItem[];
  updatedAt: string;
}

const sevStatus = (s: AlertSeverity): AlertItem["status"] =>
  s === "danger" ? "danger" : s === "warning" ? "warning" : "neutral";

type DashboardView = "overview" | "feed-water";

function DashboardTabs({ active, onChange, narrow }: { active: DashboardView; onChange: (view: DashboardView) => void; narrow: boolean }) {
  const tabs: { id: DashboardView; label: string; detail: string; icon: React.ReactNode }[] = [
    {
      id: "overview", label: "Overview", detail: "Production & flock monitoring",
      icon: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>,
    },
    {
      id: "feed-water", label: "Feed & water", detail: "Silos, drawdown & drinking",
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 3h8v13l-4 5-4-5V3Z" /><path d="M5 7h8M18 4c0 3-2 4.5-2 7a2 2 0 0 0 4 0c0-2.5-2-4-2-7Z" /></svg>,
    },
  ];
  return (
    <nav aria-label="Dashboard views" style={{ background: "rgba(255,255,255,0.72)", border: "1px solid rgba(0,0,0,0.07)", borderRadius: 12, padding: 4 }}>
      <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr 1fr" : "repeat(2, minmax(0, 260px))", gap: 4 }}>
        {tabs.map((tab) => {
          const selected = tab.id === active;
          return (
            <button key={tab.id} type="button" aria-pressed={selected} onClick={() => onChange(tab.id)} style={{ minHeight: 48, border: selected ? "1px solid #002E35" : "1px solid transparent", borderRadius: 9, background: selected ? "#002E35" : "transparent", color: selected ? "#fff" : "var(--t2)", padding: narrow ? "7px 8px" : "7px 12px", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, cursor: "pointer", fontFamily: "var(--font-s)" }}>
              {tab.icon}
              <span style={{ minWidth: 0, textAlign: "left" }}><strong style={{ display: "block", fontSize: 11.5, lineHeight: 1.2 }}>{tab.label}</strong><span style={{ display: "block", fontSize: 8.5, color: selected ? "rgba(255,255,255,0.6)" : "var(--t3)", marginTop: 2 }}>{tab.detail}</span></span>
            </button>
          );
        })}
      </div>
    </nav>
  );
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
  const [siloLevels, setSiloLevels] = useState<SiloLevelsData | null>(null);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [alertsError, setAlertsError] = useState<string | null>(null);
  const [alertsAt, setAlertsAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<DashboardView>("overview");
  const isNarrow = useIsNarrow();

  const fetchAll = useCallback(async () => {
    try {
      const [summaryRes, productionRes, alertsRes, siloLevelsRes] = await Promise.all([
        fetch("/api/dashboard/summary"),
        fetch("/api/production"),
        fetch("/api/alerts"),
        fetch("/api/silo-levels"),
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
      if (siloLevelsRes.ok) setSiloLevels(await siloLevelsRes.json());
      if (alertsRes.ok) {
        const d: { alerts: Alert[]; updatedAt: string | null; stale?: boolean; partial?: boolean } = await alertsRes.json();
        setAlerts((d.alerts ?? []).map((a) => ({
          metric: a.title, status: sevStatus(a.severity), message: a.message, updatedAt: a.since, clipKey: a.clipKey,
        })));
        setAlertsAt(d.updatedAt ?? null);
        setAlertsError(d.stale ? "Alert checks are delayed; displayed alerts may be out of date." : d.partial ? "Some alert checks could not complete. Showing the last known alerts." : null);
      } else {
        setAlertsError("Farm alerts are temporarily unavailable. Please check again later.");
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
    // Refresh when the tab is re-focused / becomes visible again, so a returning
    // user sees the latest silo/production data without waiting for the interval.
    const onVisible = () => { if (document.visibilityState === "visible") fetchAll(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", fetchAll);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", fetchAll);
    };
  }, [fetchAll]);

  if (loading) {
    return <main className="sa-main"><div style={{ color: "var(--t3)", fontSize: 13, padding: "60px 0", textAlign: "center" }}>Loading dashboard…</div></main>;
  }
  if (error) {
    return <main className="sa-main"><div style={{ color: "var(--danger)", fontSize: 13, padding: "60px 0", textAlign: "center" }}>{error}</div></main>;
  }

  return (
    <main className="sa-main" style={{ maxWidth: 1240, width: "100%", margin: "0 auto", gap: 14 }}>
      <DashboardTabs active={activeView} onChange={setActiveView} narrow={isNarrow} />

      {activeView === "overview" ? <>
        {/* Production KPIs */}
        <DashKpiGrid production={production} narrow={isNarrow} />

        {/* Flock-noise welfare heat */}
        <DashAcousticCard narrow={isNarrow} />

        {/* Flock night-rest (sleep) score */}
        <DashSleepScore />

        {/* Environment + alerts */}
        <div style={{ display: "grid", gridTemplateColumns: isNarrow ? "1fr" : "minmax(0, 1fr) 340px", gap: 14, alignItems: "start" }}>
          <DashEnvCol env={summary?.env ?? null} narrow={isNarrow} />
          {alertsError && <p role="status" style={{ fontSize: 12, color: "#92400E" }}>{alertsError}</p>}
          <DashAlertChat alerts={alerts} updatedAt={alertsAt} />
        </div>
      </> : (
        <DashFeedWater silos={siloLevels} water={summary?.env.water.sparkline ?? []} narrow={isNarrow} />
      )}
    </main>
  );
}
