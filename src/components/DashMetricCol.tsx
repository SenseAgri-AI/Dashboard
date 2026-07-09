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

interface KpiCardProps {
  category: "production" | "welfare" | "financial";
  label: string;
  value: string | null;
  sub?: string;
  status?: "ok" | "warn" | "danger";
  statusText?: string;
}

const CAT: Record<string, { accent: string; val: string }> = {
  production: { accent: "#002E35", val: "#002E35" },
  welfare:    { accent: "#2A8E9A", val: "#2A8E9A" },
  financial:  { accent: "#D4AF37", val: "#7A5C00" },
};
const STATUS_COLOR: Record<string, string> = { ok: "#16A34A", warn: "#B45309", danger: "#B91C1C" };

function KpiCard({ category, label, value, sub, status, statusText }: KpiCardProps) {
  const c = CAT[category];
  return (
    <div style={{ background: "var(--card)", border: "1px solid rgba(0,0,0,0.09)", borderLeft: `3px solid ${c.accent}`, boxShadow: "0 1px 4px rgba(0,0,0,0.08)", padding: "11px 14px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 3, minWidth: 0 }}>
      <div style={{ fontSize: 9.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--t2)" }}>{label}</div>
      {value !== null ? (
        <>
          <div style={{ fontFamily: "var(--font-d)", fontSize: 24, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.05, color: c.val }}>{value}</div>
          {sub && <div style={{ fontSize: 10.5, color: "var(--t3)", lineHeight: 1.3 }}>{sub}</div>}
          {status && statusText && <div style={{ fontSize: 10, fontWeight: 700, color: STATUS_COLOR[status] }}>{statusText}</div>}
        </>
      ) : (
        <div style={{ fontSize: 22, color: "var(--t4)" }}>—</div>
      )}
    </div>
  );
}

export function DashKpiGrid({ production }: { production: ProductionData | null }) {
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

  const weeklyRevenue = production?.daily?.slice(-7).reduce((sum, d) => sum + d.revenue, 0) ?? null;
  const dataDate = production?.date ? fmt(production.date) : null;

  // Average egg mass using grade midpoints (g): S=40, M=47, L=55, XL=63, J=70
  const eggs = production?.eggs;
  const avgEggMass = eggs && eggs.total > 0
    ? (eggs.small * 40 + eggs.medium * 47 + eggs.large * 55 + eggs.xl * 63 + eggs.jumbo * 70) / eggs.total
    : null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, alignContent: "stretch" }}>
      <KpiCard category="production" label="Hen-Day %"
        value={hdep !== null ? `${hdep.toFixed(1)}%` : null}
        sub={production ? `${production.totalHens.toLocaleString()} hens · ${dataDate}` : undefined}
        status={hdepStatus} statusText={hdepText} />
      <KpiCard category="production" label="Eggs today"
        value={production ? production.eggs.total.toLocaleString() : null}
        sub={production ? `J ${production.eggs.jumbo} · XL ${production.eggs.xl} · L ${production.eggs.large} · M ${production.eggs.medium} · S ${production.eggs.small} · Broken ${production.eggs.damaged}` : undefined} />
      <KpiCard category="production" label="Avg egg mass"
        value={avgEggMass !== null ? `${avgEggMass.toFixed(1)} g` : null}
        sub="Estimated from grade midpoints" />
      <KpiCard category="welfare" label="Mortality rate"
        value={rate !== null ? `${rate.toFixed(2)}%` : null}
        sub={production ? `${production.mortality.today} today · ${production.mortality.cumulative} total` : undefined}
        status={mortalityStatus} statusText={mortalityText} />
      <KpiCard category="financial" label="Revenue today"
        value={production ? fmtR(production.revenue) : null}
        sub={dataDate ? `Based on ${dataDate}` : undefined} />
      <KpiCard category="financial" label="Weekly revenue"
        value={weeklyRevenue !== null ? fmtR(weeklyRevenue) : null}
        sub="Last 7 days" />
    </div>
  );
}

export default function DashMetricCol() { return null; }
