"use client";

import {
  ComposedChart,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

export interface DeviceSeries {
  deviceId: string;
  color: string;
  data: { time: string; value: number | null; cumulative?: number | null }[];
}

interface TelemetryChartProps {
  series: DeviceSeries[];
  unit: string;
  label: string;
  barMode?: boolean; // use bars instead of lines (consumption metrics)
}

// Merge series by time bucket so Recharts can render multiple lines/bars on one chart
function mergeSeries(series: DeviceSeries[]): Record<string, unknown>[] {
  const byTime = new Map<string, Record<string, unknown>>();
  for (const s of series) {
    for (const pt of s.data) {
      if (!byTime.has(pt.time)) byTime.set(pt.time, { time: pt.time });
      byTime.get(pt.time)![s.deviceId] = pt.value;
      if (pt.cumulative != null) {
        byTime.get(pt.time)![`${s.deviceId}_cum`] = pt.cumulative;
      }
    }
  }
  return Array.from(byTime.values()).sort(
    (a, b) => new Date(a.time as string).getTime() - new Date(b.time as string).getTime()
  );
}

function formatTime(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatDate(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleDateString("en-ZA", { month: "short", day: "numeric" });
}

function shortId(id: string) {
  return id.slice(-8);
}

const CustomTooltip = ({
  active, payload, label, unit, barMode,
}: {
  active?: boolean;
  payload?: { dataKey: string; value: number; color: string }[];
  label?: string;
  unit?: string;
  barMode?: boolean;
}) => {
  if (!active || !payload?.length) return null;
  // In bar mode, split payload into consumption bars and cumulative lines
  const consumptionItems = barMode
    ? payload.filter((p) => !String(p.dataKey).endsWith("_cum"))
    : payload;
  const cumulativeItems = barMode
    ? payload.filter((p) => String(p.dataKey).endsWith("_cum"))
    : [];

  return (
    <div className="bg-[#002E35] border border-[#2A8E9A] px-3 py-2 text-xs min-w-36">
      <div className="text-[#2A8E9A] font-mono mb-1.5">
        {label ? new Date(label).toLocaleString("en-ZA") : ""}
      </div>
      {consumptionItems.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2 leading-5">
          <span className="w-2 h-2 inline-block" style={{ backgroundColor: p.color }} />
          <span className="text-[#aac8cc] font-mono">{shortId(String(p.dataKey))}</span>
          <span className="text-white font-bold tabular-nums ml-auto pl-3">
            {p.value != null ? Number(p.value).toFixed(0) : "—"} {unit}
          </span>
        </div>
      ))}
      {cumulativeItems.map((p) => {
        const baseId = String(p.dataKey).replace("_cum", "");
        return (
          <div key={p.dataKey} className="flex items-center gap-2 leading-5 mt-1 pt-1 border-t border-[#2A8E9A] border-opacity-30">
            <span className="text-[#D4AF37] font-mono text-[10px]">↑ {shortId(baseId)}</span>
            <span className="text-[#D4AF37] font-bold tabular-nums ml-auto pl-3">
              {p.value != null ? Number(p.value).toLocaleString() : "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
};

const CustomLegend = ({ payload }: { payload?: { value: string; color: string }[] }) => {
  if (!payload?.length) return null;
  return (
    <div className="flex flex-wrap gap-3 justify-end px-2 pt-1">
      {payload.map((p) => (
        <div key={p.value} className="flex items-center gap-1.5 text-sm font-semibold text-[#3a4d4f]">
          <span className="w-4 h-px inline-block" style={{ backgroundColor: p.color, display: "inline-block", verticalAlign: "middle" }} />
          <span className="font-mono">{shortId(p.value)}</span>
        </div>
      ))}
    </div>
  );
};

export default function TelemetryChart({ series, unit, label, barMode }: TelemetryChartProps) {
  if (!series.length || series.every((s) => s.data.length === 0)) {
    return (
      <div className="flex items-center justify-center h-48 text-[#3a4d4f] text-sm font-semibold">
        No data for selected range
      </div>
    );
  }

  const merged = mergeSeries(series);
  const isMultiDay =
    merged.length > 1 &&
    new Date(merged[merged.length - 1].time as string).getDate() !== new Date(merged[0].time as string).getDate();

  const sharedAxisProps = {
    xAxis: (
      <XAxis
        dataKey="time"
        tickFormatter={isMultiDay ? formatDate : formatTime}
        tick={{ fontSize: 11, fontWeight: 600, fill: "#3a4d4f", fontFamily: "Inter" }}
        axisLine={{ stroke: "#d1dada" }}
        tickLine={false}
        minTickGap={40}
      />
    ),
    yAxis: (
      <YAxis
        tick={{ fontSize: 11, fontWeight: 600, fill: "#3a4d4f", fontFamily: "Inter" }}
        axisLine={false}
        tickLine={false}
        width={48}
      />
    ),
  };

  return (
    <div>
      <div className="text-sm font-bold text-[#3a4d4f] uppercase tracking-widest mb-3">{label}</div>
      <ResponsiveContainer width="100%" height={220}>
        {barMode ? (
          <ComposedChart data={merged} margin={{ top: 4, right: 48, left: -16, bottom: 0 }} barCategoryGap="20%">
            <CartesianGrid strokeDasharray="2 4" stroke="rgba(42,142,154,0.12)" vertical={false} />
            {sharedAxisProps.xAxis}
            {/* Left axis — consumption per bucket */}
            <YAxis
              yAxisId="consumption"
              tick={{ fontSize: 11, fontWeight: 600, fill: "#3a4d4f", fontFamily: "Inter" }}
              axisLine={false}
              tickLine={false}
              width={48}
            />
            {/* Right axis — cumulative total */}
            <YAxis
              yAxisId="cumulative"
              orientation="right"
              tick={{ fontSize: 10, fill: "#D4AF37", fontFamily: "Inter" }}
              axisLine={false}
              tickLine={false}
              width={48}
              tickFormatter={(v) => Number(v).toLocaleString()}
            />
            <Tooltip content={<CustomTooltip unit={unit} barMode />} />
            {series.length > 1 && <Legend content={<CustomLegend />} />}
            {series.map((s) => (
              <Bar key={s.deviceId} yAxisId="consumption" dataKey={s.deviceId} fill={s.color} opacity={0.85} radius={0} />
            ))}
            {series.map((s) => (
              <Line
                key={`${s.deviceId}_cum`}
                yAxisId="cumulative"
                type="monotone"
                dataKey={`${s.deviceId}_cum`}
                stroke="#D4AF37"
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 3, fill: "#D4AF37" }}
                connectNulls
              />
            ))}
          </ComposedChart>
        ) : (
          <LineChart data={merged} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="2 4" stroke="rgba(42,142,154,0.12)" />
            {sharedAxisProps.xAxis}
            {sharedAxisProps.yAxis}
            <Tooltip content={<CustomTooltip unit={unit} barMode={false} />} />
            {series.length > 1 && <Legend content={<CustomLegend />} />}
            {series.map((s) => (
              <Line
                key={s.deviceId}
                type="monotone"
                dataKey={s.deviceId}
                stroke={s.color}
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 3, fill: s.color }}
                connectNulls={false}
              />
            ))}
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
