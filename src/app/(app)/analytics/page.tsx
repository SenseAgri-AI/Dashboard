"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { standardHdepForWeek } from "@/lib/henStandard";
import { type Horizon, horizonAvailable } from "@/lib/timeseriesSource";

// ── palette (matches the dashboard charts) ──
const PRIMARY = "#002E35";
const TEAL = "#2A8E9A";
const GOLD = "#D4AF37";
const AXIS = "#3a4d4f";
const GRID = "rgba(42,142,154,0.12)";

type House = { id: string; name: string; startDate: string; startAgeDays: number; startingHens: number };
type Device = { device_id: string; device_type: string };
type DailyProd = { date: string; eggs: number; revenue: number; hdep: number | null; feedPulses: number | null; fcr: number | null };

function daysBetween(start: string, end: string): number {
  const a = new Date(`${start}T00:00:00`).getTime();
  const b = new Date(`${end}T00:00:00`).getTime();
  return Math.floor((b - a) / 86_400_000);
}

const RANGES: { key: Horizon; label: string }[] = [
  { key: "24h", label: "24h" },
  { key: "7d", label: "7d" },
  { key: "30d", label: "30d" },
  { key: "1y", label: "1 year" },
];

const METRICS = [
  { key: "temperature", label: "Temperature", unit: "°C" },
  { key: "humidity", label: "Humidity", unit: "%" },
  { key: "co2", label: "CO₂", unit: "ppm" },
] as const;

const cardHd: React.CSSProperties = { };

export default function AnalyticsPage() {
  return (
    <main className="sa-main" style={{ maxWidth: 1100, width: "100%", margin: "0 auto", gap: 12 }}>
      <ProductionChart />
      <EnvironmentChart />
    </main>
  );
}

// ── Production: Hen-Day % actual vs breed standard ──────────
function ProductionChart() {
  const [daily, setDaily] = useState<DailyProd[]>([]);
  const [house, setHouse] = useState<House | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [prodRes, housesRes] = await Promise.all([fetch("/api/production"), fetch("/api/houses")]);
      if (prodRes.ok) setDaily((await prodRes.json()).daily ?? []);
      if (housesRes.ok) {
        const hs: House[] = (await housesRes.json()).houses ?? [];
        setHouse(hs[0] ?? null);
      }
      setLoading(false);
    })();
  }, []);

  const data = useMemo(() => {
    return daily.map((d) => {
      let standard: number | null = null;
      if (house?.startDate) {
        const ageDays = house.startAgeDays + daysBetween(house.startDate, d.date);
        const week = ageDays / 7;
        const s = standardHdepForWeek(week);
        standard = s == null ? null : Math.round(s * 10) / 10;
      }
      return { date: d.date.slice(5), actual: d.hdep, standard };
    });
  }, [daily, house]);

  return (
    <section className="sa-panel" style={{ padding: 0 }}>
      <div className="sa-panel-hd sa-panel-hd--production" style={cardHd}>Hen-Day % — actual vs breed standard</div>
      <div style={{ padding: "14px 16px 6px", height: 320 }}>
        {loading ? (
          <Placeholder text="Loading production data…" />
        ) : data.length === 0 ? (
          <Placeholder text="No production data yet." />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 6, right: 12, bottom: 4, left: -12 }}>
              <CartesianGrid strokeDasharray="2 4" stroke={GRID} vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: AXIS, fontFamily: "Inter" }} axisLine={{ stroke: "#d1dada" }} tickLine={false} minTickGap={24} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: AXIS, fontFamily: "Inter" }} axisLine={false} tickLine={false} unit="%" />
              <Tooltip contentStyle={{ background: PRIMARY, border: `1px solid ${TEAL}`, borderRadius: 0, fontSize: 12, color: "#fff" }} labelStyle={{ color: TEAL }} />
              <Legend wrapperStyle={{ fontSize: 12, fontWeight: 600 }} />
              <Line type="monotone" dataKey="standard" name="Breed standard" stroke={GOLD} strokeWidth={1.5} strokeDasharray="5 4" dot={false} connectNulls />
              <Line type="monotone" dataKey="actual" name="Actual HDEP" stroke={TEAL} strokeWidth={2} dot={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
      <div className="sa-chart-note" style={{ padding: "0 16px 12px" }}>
        Standard interpolated by flock age{house ? ` (cycle start ${house.startDate}, ${house.startAgeDays}d)` : ""}. Deep history (1&nbsp;year+) will read from the AWS gold bucket.
      </div>
    </section>
  );
}

// ── Environment: telemetry metric over a selectable range ───
function EnvironmentChart() {
  const [device, setDevice] = useState<Device | null>(null);
  const [metric, setMetric] = useState<(typeof METRICS)[number]["key"]>("temperature");
  const [range, setRange] = useState<Horizon>("7d");
  const [series, setSeries] = useState<{ time: string; value: number | null }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/devices");
      if (res.ok) {
        const devices: Device[] = (await res.json()).devices ?? [];
        setDevice(devices.find((d) => d.device_type === "AM308-1") ?? devices[0] ?? null);
      }
    })();
  }, []);

  const load = useCallback(async () => {
    if (!device || !horizonAvailable(range)) { setSeries([]); setLoading(false); return; }
    setLoading(true);
    const q = new URLSearchParams({ device_id: device.device_id, device_type: device.device_type, metric, range });
    const res = await fetch(`/api/telemetry/history?${q}`);
    if (res.ok) {
      const rows = (await res.json()).series ?? [];
      setSeries(rows.map((r: { time: string; value: number | null }) => ({
        time: new Date(r.time).toLocaleString("en-ZA", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
        value: r.value,
      })));
    }
    setLoading(false);
  }, [device, metric, range]);

  useEffect(() => { load(); }, [load]);

  const activeMetric = METRICS.find((m) => m.key === metric)!;

  return (
    <section className="sa-panel" style={{ padding: 0 }}>
      <div className="sa-panel-hd sa-panel-hd--welfare" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <span>Environment — {activeMetric.label}</span>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <select value={metric} onChange={(e) => setMetric(e.target.value as typeof metric)} style={{ fontSize: 12, padding: "3px 6px", border: "1px solid rgba(0,0,0,0.14)", background: "#fff", fontWeight: 600 }}>
            {METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
          {RANGES.map((r) => {
            const disabled = !horizonAvailable(r.key);
            return (
              <button
                key={r.key}
                onClick={() => !disabled && setRange(r.key)}
                disabled={disabled}
                title={disabled ? "Deep history from the AWS gold bucket — coming soon" : undefined}
                style={{
                  fontSize: 11, fontWeight: 700, padding: "4px 9px", border: "none", cursor: disabled ? "not-allowed" : "pointer",
                  background: range === r.key ? PRIMARY : "transparent",
                  color: range === r.key ? "#fff" : disabled ? "var(--t4)" : "var(--t3)",
                }}
              >
                {r.label}
              </button>
            );
          })}
        </div>
      </div>
      <div style={{ padding: "14px 16px 6px", height: 320 }}>
        {loading ? (
          <Placeholder text="Loading telemetry…" />
        ) : !horizonAvailable(range) ? (
          <Placeholder text="Deep history (1 year+) will load from the AWS gold bucket — coming soon." />
        ) : series.length === 0 ? (
          <Placeholder text="No telemetry for this range." />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 6, right: 12, bottom: 4, left: -12 }}>
              <CartesianGrid strokeDasharray="2 4" stroke={GRID} vertical={false} />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: AXIS, fontFamily: "Inter" }} axisLine={{ stroke: "#d1dada" }} tickLine={false} minTickGap={40} />
              <YAxis tick={{ fontSize: 11, fill: AXIS, fontFamily: "Inter" }} axisLine={false} tickLine={false} unit={activeMetric.unit} width={48} />
              <Tooltip contentStyle={{ background: PRIMARY, border: `1px solid ${TEAL}`, borderRadius: 0, fontSize: 12, color: "#fff" }} labelStyle={{ color: TEAL }} />
              <Line type="monotone" dataKey="value" name={activeMetric.label} stroke={TEAL} strokeWidth={2} dot={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}

function Placeholder({ text }: { text: string }) {
  return (
    <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--t3)", fontSize: 13 }}>
      {text}
    </div>
  );
}
