"use client";

interface BatteryIndicatorProps {
  level: number | null | undefined;
}

export default function BatteryIndicator({ level }: BatteryIndicatorProps) {
  if (level == null) return null;
  const pct = Math.max(0, Math.min(100, Number(level)));
  const color = pct > 50 ? "#2A8E9A" : pct > 20 ? "#D4AF37" : "#ef4444";
  const segments = Math.round((pct / 100) * 5);

  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-0.5 items-center">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="w-3 h-4 border border-current"
            style={{ color, backgroundColor: i < segments ? color : "transparent", opacity: 0.85 }}
          />
        ))}
        <div className="w-1 h-2 ml-0.5" style={{ backgroundColor: color }} />
      </div>
      <span className="text-xs font-mono tabular-nums" style={{ color }}>
        {pct.toFixed(0)}%
      </span>
    </div>
  );
}
