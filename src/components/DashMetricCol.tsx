import type { EnvData } from "./DashEnvCol";

const LockIcon = () => (
  <svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <rect x="3" y="7" width="10" height="7" rx="1" />
    <path d="M5 7V5a3 3 0 016 0v2" />
  </svg>
);

function PendingCard({ label, note }: { label: string; note: string }) {
  return (
    <div className="sa-metric-card pending">
      <div className="sa-metric-lbl">{label}</div>
      <div className="sa-pending-dash">—</div>
      <div className="sa-pending-badge">
        <LockIcon /> Awaiting calibration
      </div>
      <div className="sa-pending-note">{note}</div>
    </div>
  );
}

interface MetricCardProps {
  label: string;
  value: string;
  valueClass?: string;
  sub?: string;
  statusText?: string;
  statusClass?: "ok" | "warn";
}

function MetricCard({ label, value, valueClass, sub, statusText, statusClass }: MetricCardProps) {
  return (
    <div className="sa-metric-card">
      <div className="sa-metric-lbl">{label}</div>
      <div className={`sa-metric-val${valueClass ? ` ${valueClass}` : ""}`}>{value}</div>
      {sub && <div className="sa-metric-sub">{sub}</div>}
      {statusText && (
        <div className={`sa-metric-status${statusClass ? ` ${statusClass}` : ""}`}>{statusText}</div>
      )}
    </div>
  );
}

interface DashMetricColProps {
  env: EnvData | null;
  vapourPressure: number | null;
}

export default function DashMetricCol({ env, vapourPressure }: DashMetricColProps) {
  // Vapour pressure display
  const vpDisplay =
    vapourPressure !== null && vapourPressure !== undefined
      ? (Math.round(vapourPressure * 100) / 100).toFixed(2)
      : null;
  const vpStatus = vapourPressure !== null && vapourPressure !== undefined
    ? vapourPressure > 1.5 ? "warn" : "ok"
    : undefined;
  const vpStatusText = vapourPressure !== null && vapourPressure !== undefined
    ? vapourPressure > 1.5
      ? "Elevated · heat load increasing"
      : "Normal · within acceptable range"
    : undefined;

  return (
    <div className="sa-metric-col">
      <div className="sa-col-header">Welfare &amp; Financial</div>

      <div className="sa-section-label">Welfare Metrics</div>

      <PendingCard
        label="Hen-Day production %"
        note="Connect egg count data source to unlock this metric"
      />

      <PendingCard
        label="Water:Feed ratio"
        note="Pulse meter calibration in progress — ratio unlocks automatically"
      />

      {vpDisplay !== null ? (
        <MetricCard
          label="Vapour pressure"
          value={`${vpDisplay}`}
          sub="kPa · calculated from temp + RH"
          statusText={vpStatusText}
          statusClass={vpStatus}
        />
      ) : (
        <PendingCard
          label="Vapour pressure"
          note="Awaiting sensor data — computed from temperature and humidity"
        />
      )}

      <PendingCard
        label="Feed conversion ratio"
        note="Pulse meter calibration in progress — FCR unlocks automatically"
      />

      <div className="sa-section-label" style={{ marginTop: 3 }}>
        Financial Metrics
      </div>

      <PendingCard
        label="Revenue today"
        note="Connect egg production records to enable financial tracking"
      />

      <PendingCard
        label="Eggs today"
        note="Connect egg count data source to unlock this metric"
      />

      <PendingCard
        label="Feed cost"
        note="Unlocks with pulse meter calibration — cost from consumption rate"
      />

      <PendingCard
        label="Economic efficiency ratio"
        note="Requires feed cost — will show revenue-to-feed efficiency"
      />
    </div>
  );
}
