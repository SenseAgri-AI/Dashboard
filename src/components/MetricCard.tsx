"use client";

interface MetricCardProps {
  label: string;
  value: number | null | undefined;
  unit: string;
  icon?: string;
  highlight?: boolean;
  warning?: boolean;
}

function fmt(v: number | null | undefined, decimals = 1): string {
  if (v == null || isNaN(Number(v))) return "—";
  return Number(v).toFixed(decimals);
}

export default function MetricCard({ label, value, unit, icon, highlight, warning }: MetricCardProps) {
  const borderColor = warning ? "border-[#D4AF37]" : highlight ? "border-[#2A8E9A]" : "border-[#d1dada]";
  const valueColor = warning ? "text-[#D4AF37]" : highlight ? "text-[#2A8E9A]" : "text-[#191C1D]";

  return (
    <div className={`metric-card group transition-all bg-white border ${borderColor}`}>
      <div className="flex items-start justify-between mb-3">
        <span className="text-xs font-semibold text-[#5a6b6d] uppercase tracking-widest">{label}</span>
        {icon && <span className="text-lg opacity-60">{icon}</span>}
      </div>
      <div className={`font-display font-bold text-2xl tabular-nums ${valueColor}`}>
        {fmt(value)}
        <span className="text-sm font-normal text-[#5a6b6d] ml-1">{unit}</span>
      </div>
    </div>
  );
}
