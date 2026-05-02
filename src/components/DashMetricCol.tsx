import type { EnvData } from "./DashEnvCol";

export interface ProductionData {
  date: string;
  eggs: { total: number; small: number; medium: number; large: number; xl: number; jumbo: number; damaged: number };
  revenue: number;
  hdep: number | null;
  mortality: { today: number; cumulative: number; rate: number | null };
  totalHens: number;
  daily: { date: string; eggs: number; revenue: number; hdep: number | null }[];
}

function PendingCard({ label, note }: { label: string; note: string }) {
  return (
    <div className="sa-metric-card pending">
      <div className="sa-metric-lbl">{label}</div>
      <div className="sa-pending-dash">—</div>
      <div className="sa-pending-note">{note}</div>
    </div>
  );
}

interface MetricCardProps {
  label: string;
  value: string;
  sub?: string;
  statusText?: string;
  statusClass?: "ok" | "warn" | "danger";
}

function MetricCard({ label, value, sub, statusText, statusClass }: MetricCardProps) {
  return (
    <div className="sa-metric-card">
      <div className="sa-metric-lbl">{label}</div>
      <div className="sa-metric-val">{value}</div>
      {sub && <div className="sa-metric-sub">{sub}</div>}
      {statusText && (
        <div className={`sa-metric-status${statusClass ? ` ${statusClass}` : ""}`}>{statusText}</div>
      )}
    </div>
  );
}

interface DashMetricColProps {
  env: EnvData | null;
  production: ProductionData | null;
}

export default function DashMetricCol({ env, production }: DashMetricColProps) {
  const waterCurrent = env?.water?.current ?? null;
  const waterDisplay = waterCurrent !== null ? `${Math.round(waterCurrent).toLocaleString()} L` : null;

  const hdepStatus: "ok" | "warn" | "danger" | undefined =
    production?.hdep !== null && production?.hdep !== undefined
      ? production.hdep >= 85 ? "ok" : production.hdep >= 70 ? "warn" : "danger"
      : undefined;

  const hdepStatusText =
    production?.hdep !== null && production?.hdep !== undefined
      ? production.hdep >= 85
        ? "Normal production rate"
        : production.hdep >= 70
        ? "Below target — monitor flock"
        : "Poor — investigate immediately"
      : undefined;

  const mortalityRate = production?.mortality?.rate ?? null;
  const mortalityStatus: "ok" | "warn" | "danger" | undefined =
    mortalityRate !== null
      ? mortalityRate < 3 ? "ok" : mortalityRate < 6 ? "warn" : "danger"
      : undefined;

  const dataDate = production?.date
    ? new Date(production.date).toLocaleDateString("en-ZA", { day: "numeric", month: "short" })
    : null;

  return (
    <div className="sa-metric-col">
      <div className="sa-col-header">Welfare &amp; Financial</div>

      <div className="sa-section-label">Production</div>

      {production ? (
        <MetricCard
          label="Hen-Day %"
          value={production.hdep !== null ? `${production.hdep.toFixed(1)}%` : "—"}
          sub={dataDate ? `${dataDate} · ${production.totalHens.toLocaleString()} hens` : undefined}
          statusText={hdepStatusText}
          statusClass={hdepStatus}
        />
      ) : (
        <PendingCard label="Hen-Day %" note="Loading production data…" />
      )}

      {production ? (
        <MetricCard
          label="Eggs today"
          value={production.eggs.total.toLocaleString()}
          sub={`L ${production.eggs.large} · M ${production.eggs.medium} · XL ${production.eggs.xl} · S ${production.eggs.small}`}
        />
      ) : (
        <PendingCard label="Eggs today" note="Loading production data…" />
      )}

      <div className="sa-section-label" style={{ marginTop: 3 }}>Financial</div>

      {production ? (
        <MetricCard
          label="Revenue today"
          value={`R ${production.revenue.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          sub={dataDate ? `Based on ${dataDate} production` : undefined}
        />
      ) : (
        <PendingCard label="Revenue today" note="Loading production data…" />
      )}

      <div className="sa-section-label" style={{ marginTop: 3 }}>Welfare</div>

      {production ? (
        <MetricCard
          label="Mortality rate"
          value={mortalityRate !== null ? `${mortalityRate.toFixed(2)}%` : "—"}
          sub={`${production.mortality.cumulative} total · ${production.mortality.today} today`}
          statusText={
            mortalityRate !== null
              ? mortalityRate < 3 ? "Within normal range" : mortalityRate < 6 ? "Elevated — monitor" : "High — investigate"
              : undefined
          }
          statusClass={mortalityStatus}
        />
      ) : (
        <PendingCard label="Mortality rate" note="Loading production data…" />
      )}

      {waterDisplay !== null ? (
        <MetricCard
          label="Water consumed"
          value={waterDisplay}
          sub="Last 30-min interval · pulse meter"
        />
      ) : (
        <PendingCard label="Water consumed" note="No meter data — check device connection" />
      )}
    </div>
  );
}
