import type { EnvData } from "./DashEnvCol";

export interface ProductionData {
  date: string;
  eggs: { total: number; small: number; medium: number; large: number; xl: number; jumbo: number; damaged: number };
  revenue: number;
  hdep: number | null;
  mortality: { today: number; cumulative: number; rate: number | null };
  totalHens: number;
  daily: { date: string; eggs: number; revenue: number; hdep: number | null; feedPulses: number | null; fcr: number | null }[];
}

function fmt(date: string) {
  return new Date(date).toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
}

function fmtR(val: number) {
  return `R ${val.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface KpiItemProps {
  category: "production" | "welfare" | "financial";
  label: string;
  value: string | null;
  sub?: string;
  status?: "ok" | "warn" | "danger";
  statusText?: string;
}

function KpiItem({ category, label, value, sub, status, statusText }: KpiItemProps) {
  const valColor =
    category === "production" ? "sa-pm-val--production" :
    category === "welfare"    ? "sa-pm-val--welfare" :
    "sa-pm-val--financial";

  return (
    <div className={`sa-kpi-item sa-kpi-item--${category}`}>
      <div className="sa-pm-lbl">{label}</div>
      {value !== null ? (
        <>
          <div className={`sa-pm-val ${valColor}`}>{value}</div>
          {sub && <div className="sa-pm-sub">{sub}</div>}
          {status && statusText && <div className={`sa-pm-status ${status}`}>{statusText}</div>}
        </>
      ) : (
        <div className="sa-pm-pending">—</div>
      )}
    </div>
  );
}

export function DashKpiGrid({ production, env }: { production: ProductionData | null; env: EnvData | null }) {
  const hdep = production?.hdep ?? null;
  const hdepStatus: "ok" | "warn" | "danger" | undefined =
    hdep !== null ? (hdep >= 85 ? "ok" : hdep >= 70 ? "warn" : "danger") : undefined;
  const hdepText =
    hdep !== null
      ? hdep >= 85 ? "Normal production rate"
      : hdep >= 70 ? "Below target — monitor flock"
      : "Poor — investigate immediately"
      : undefined;

  const rate = production?.mortality?.rate ?? null;
  const mortalityStatus: "ok" | "warn" | "danger" | undefined =
    rate !== null ? (rate < 3 ? "ok" : rate < 6 ? "warn" : "danger") : undefined;
  const mortalityText =
    rate !== null
      ? rate < 3 ? "Within normal range"
      : rate < 6 ? "Elevated — monitor"
      : "High — investigate"
      : undefined;

  const waterToday = env?.water?.today ?? null;
  const weeklyRevenue = production?.daily?.slice(-7).reduce((sum, d) => sum + d.revenue, 0) ?? null;
  const dataDate = production?.date ? fmt(production.date) : null;

  // Average egg mass using grade midpoints (g): S=40, M=47, L=55, XL=63, J=70
  const eggs = production?.eggs;
  const avgEggMass = eggs && eggs.total > 0
    ? (eggs.small * 40 + eggs.medium * 47 + eggs.large * 55 + eggs.xl * 63 + eggs.jumbo * 70) / eggs.total
    : null;

  // Feed per egg: yesterday's pulses (auger run after yesterday's first fill up to
  // today's first fill) divided by today's collected eggs — matches trend chart pairing
  const daily = production?.daily;
  const todayDaily = daily?.[daily.length - 1];
  const yesterdayDaily = daily?.[daily.length - 2];
  const feedPerEgg = yesterdayDaily?.feedPulses != null && todayDaily?.eggs != null && todayDaily.eggs > 0
    ? yesterdayDaily.feedPulses / todayDaily.eggs
    : null;

  return (
    <div className="sa-kpi-grid">
      <div className="sa-kpi-section sa-kpi-section--production">
        <div className="sa-kpi-col-hd sa-kpi-col-hd--production">Production</div>
        <KpiItem category="production" label="Hen-Day %"
          value={hdep !== null ? `${hdep.toFixed(1)}%` : null}
          sub={production ? `${production.totalHens.toLocaleString()} hens · ${dataDate}` : undefined}
          status={hdepStatus} statusText={hdepText} />
        <KpiItem category="production" label="Avg egg mass"
          value={avgEggMass !== null ? `${avgEggMass.toFixed(1)} g` : null}
          sub={dataDate ? `Estimated from grade midpoints · ${dataDate}` : "Estimated from grade midpoints"} />
        <KpiItem category="production" label="Eggs today"
          value={production ? production.eggs.total.toLocaleString() : null}
          sub={production ? `J ${production.eggs.jumbo} · XL ${production.eggs.xl} · L ${production.eggs.large} · M ${production.eggs.medium} · S ${production.eggs.small} · Broken ${production.eggs.damaged}${dataDate ? ` · ${dataDate}` : ""}` : undefined} />
        <KpiItem category="production" label="Feed per egg"
          value={feedPerEgg !== null ? `${feedPerEgg.toFixed(2)} pulses` : null}
          sub={dataDate ? `Calibration needed for kg/egg · ${dataDate}` : "Calibration needed for kg/egg"} />
      </div>
      <div className="sa-kpi-section sa-kpi-section--welfare">
        <div className="sa-kpi-col-hd sa-kpi-col-hd--welfare">Welfare</div>
        <KpiItem category="welfare" label="Mortality rate"
          value={rate !== null ? `${rate.toFixed(2)}%` : null}
          sub={production ? `${production.mortality.today} today · ${production.mortality.cumulative} total${dataDate ? ` · ${dataDate}` : ""}` : undefined}
          status={mortalityStatus} statusText={mortalityText} />
        <KpiItem category="welfare" label="Water consumed today"
          value={waterToday !== null ? `${Math.round(waterToday).toLocaleString()} L` : null}
          sub="Since 00:00 SAST" />
      </div>
      <div className="sa-kpi-section sa-kpi-section--financial">
        <div className="sa-kpi-col-hd sa-kpi-col-hd--financial">Financial</div>
        <KpiItem category="financial" label="Revenue today"
          value={production ? fmtR(production.revenue) : null}
          sub={dataDate ? `Based on ${dataDate} production` : undefined} />
        <KpiItem category="financial" label="Weekly revenue"
          value={weeklyRevenue !== null ? fmtR(weeklyRevenue) : null}
          sub="Last 7 days" />
      </div>
    </div>
  );
}

export default function DashMetricCol() { return null; }
