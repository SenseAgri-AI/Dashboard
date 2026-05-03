"use client";

import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip,
} from "recharts";

export interface EnvData {
  temperature: { current: number | null; status: string; sparkline: SparklinePoint[] };
  humidity:    { current: number | null; status: string; sparkline: SparklinePoint[] };
  co2:         { current: number | null; status: string; sparkline: SparklinePoint[] };
  tvoc:        { current: number | null; sparkline: SparklinePoint[]; mean: number; std: number };
  water:       { current: number | null; today: number | null; sparkline: SparklinePoint[]; mean: number; std: number };
}

export interface SparklinePoint {
  time: string;
  value: number;
  cumulative?: number;
}

const TEAL    = "#2A8E9A";
const PRIMARY = "#002E35";
const GOLD    = "#D4AF37";
const T3      = "#6B7C80";
const GREEN   = "#166534";
const RED     = "#B91C1C";
const GRID    = "#C8CCCC";
const TICK  = { fontSize: 9, fill: T3, fontFamily: "Inter,sans-serif" } as const;
const AXIS_LINE = { stroke: "#BEC8CA", strokeWidth: 1 };

function fmtTime(ts: string) {
  return new Date(ts).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function evenTicks(min: number, max: number, count = 5): number[] {
  return Array.from({ length: count }, (_, i) => min + (max - min) * i / (count - 1));
}

function niceTicks(max: number, targetCount = 4): number[] {
  if (max <= 0) return [0];
  const rough = max / targetCount;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const n = rough / mag;
  const step = n < 1.5 ? mag : n < 3 ? 2 * mag : n < 7 ? 5 * mag : 10 * mag;
  const domainMax = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let t = 0; t <= domainMax; t += step) ticks.push(t);
  return ticks;
}

interface SparkCfg {
  color: string;
  gradId: string;
  chartMin: number;
  chartMax: number;
  ticks?: number[];
  tickFmt?: (v: number) => string;
  tooltipUnit?: string;
  tooltipFmt?: (v: number) => string;
  bandLo?: number;
  bandHi?: number;
  bandColor?: string;
  thresholdHi?: number;
  thresholdColor?: string;
}


function SparkTooltip({ active, payload, label, unit, fmt }: {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
  unit?: string;
  fmt?: (v: number) => string;
}) {
  if (!active || !payload?.length) return null;
  const val = payload[0].value;
  const display = fmt ? fmt(val) : `${Math.round(val * 10) / 10}${unit ? ` ${unit}` : ""}`;
  return (
    <div style={{
      background: "#002E35", color: "#fff", fontSize: 10,
      padding: "3px 8px", fontFamily: "Inter,sans-serif",
      boxShadow: "0 2px 8px rgba(0,0,0,0.18)",
    }}>
      <span style={{ opacity: 0.55, marginRight: 5 }}>{label}</span>
      <strong>{display}</strong>
    </div>
  );
}

function SparklineChart({ data, cfg }: { data: SparklinePoint[]; cfg: SparkCfg }) {
  const pts = data
    .filter(pt => isFinite(pt.value))
    .map(pt => ({ v: pt.value, t: fmtTime(pt.time) }));

  const gid = `sa-g-${cfg.gradId}`;

  return (
    <ResponsiveContainer width="100%" height={210}>
      <AreaChart data={pts} margin={{ top: 6, right: 10, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={cfg.color} stopOpacity={0.22} />
            <stop offset="95%" stopColor={cfg.color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        {cfg.bandLo !== undefined && cfg.bandHi !== undefined && (
          <ReferenceArea y1={cfg.bandLo} y2={cfg.bandHi} fill={cfg.bandColor ?? cfg.color} fillOpacity={0.09} stroke="none" />
        )}
        {cfg.thresholdHi !== undefined && cfg.thresholdColor && (
          <ReferenceArea y1={cfg.thresholdHi} y2={cfg.chartMax} fill={cfg.thresholdColor} fillOpacity={0.08} stroke="none" />
        )}

        <CartesianGrid stroke={GRID} vertical={false} strokeDasharray="3 3" />

        {cfg.bandLo !== undefined && (
          <ReferenceLine y={cfg.bandLo} stroke={cfg.bandColor ?? cfg.color} strokeWidth={1} strokeOpacity={0.5}
            label={{ value: `${Math.round(cfg.bandLo * 10) / 10}`, position: "insideBottomRight", fontSize: 7, fill: cfg.bandColor ?? cfg.color }} />
        )}
        {cfg.bandHi !== undefined && (
          <ReferenceLine y={cfg.bandHi} stroke={cfg.bandColor ?? cfg.color} strokeWidth={1} strokeOpacity={0.5}
            label={{ value: `${Math.round(cfg.bandHi * 10) / 10}`, position: "insideTopRight", fontSize: 7, fill: cfg.bandColor ?? cfg.color }} />
        )}
        {cfg.thresholdHi !== undefined && cfg.thresholdColor && (
          <ReferenceLine y={cfg.thresholdHi} stroke={cfg.thresholdColor} strokeWidth={1} strokeOpacity={0.6}
            label={{ value: `${cfg.thresholdHi.toLocaleString()}`, position: "insideTopRight", fontSize: 7, fill: cfg.thresholdColor }} />
        )}

        <XAxis dataKey="t" tick={TICK} tickLine={false} axisLine={AXIS_LINE}
          interval={Math.max(1, Math.floor(pts.length / 5))} />
        <YAxis
          domain={[cfg.chartMin, cfg.chartMax]}
          ticks={cfg.ticks ?? evenTicks(cfg.chartMin, cfg.chartMax, 5)}
          tick={TICK} tickLine={false} axisLine={AXIS_LINE}
          width={38}
          tickFormatter={cfg.tickFmt ?? ((v: number) => `${Math.round(v)}`)}
        />
        <Tooltip
          content={<SparkTooltip unit={cfg.tooltipUnit} fmt={cfg.tooltipFmt ?? cfg.tickFmt} />}
          cursor={{ stroke: cfg.color, strokeWidth: 1, strokeOpacity: 0.5 }}
        />
        <Area type="monotone" dataKey="v" stroke={cfg.color} strokeWidth={1.8}
          fill={`url(#${gid})`} dot={false}
          activeDot={{ r: 3.5, fill: cfg.color, strokeWidth: 0 }}
          isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

interface EnvCardProps {
  name: string;
  current: number | null;
  displayVal?: string;
  unitLabel: string;
  status?: string;
  smallReading?: boolean;
  sparkline: SparklinePoint[];
  cfg: SparkCfg;
  note: string;
}

function hexGlow(hex: string, a1 = 0.35, a2 = 0.15) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `0 0 14px rgba(${r},${g},${b},${a1}), 0 0 4px rgba(${r},${g},${b},${a2})`;
}

function EnvCard({ name, current, displayVal, unitLabel, status, smallReading, sparkline, cfg, note }: EnvCardProps) {
  const readingColor =
    status === "danger" ? RED :
    status === "warning" ? "#D97706" :
    cfg.color;
  const readingStyle = { color: readingColor, textShadow: hexGlow(readingColor) };
  const readingClass = `sa-env-reading${smallReading ? " small" : ""}`;
  const shown = displayVal ?? (current !== null ? String(Math.round(current * 10) / 10) : "—");

  return (
    <div className="sa-env-card">
      <div className="sa-env-head">
        <span className="sa-env-name">{name}</span>
        <span className={readingClass} style={readingStyle}>{shown} <span className="sa-env-unit">{unitLabel}</span></span>
      </div>
      <SparklineChart data={sparkline} cfg={cfg} />
      <div className="sa-env-foot">{note}</div>
    </div>
  );
}

export default function DashEnvCol({ env }: { env: EnvData | null }) {
  const temp  = env?.temperature;
  const hum   = env?.humidity;
  const co2   = env?.co2;
  const tvoc  = env?.tvoc;

  const tempColor = TEAL;

  const tvocCurrent = tvoc?.current ?? 0;
  const tvocMean    = tvoc?.mean ?? 0;
  const tvocStd     = tvoc?.std ?? 1;
  const tvocBandHi  = tvocMean + tvocStd * 2;
  const tvocRawMax  = Math.max(tvocCurrent * 1.3, tvocBandHi * 1.2, 4);
  const tvocTicks   = niceTicks(tvocRawMax, 4);
  const tvocLastTick = tvocTicks[tvocTicks.length - 1];
  const tvocStep    = tvocTicks.length > 1 ? tvocTicks[1] - tvocTicks[0] : 1;
  const tvocChartMax = tvocLastTick + tvocStep;

  return (
    <div className="sa-env-row">
      <EnvCard
        name="Temperature"
        current={temp?.current ?? null}
        displayVal={temp?.current != null ? `${Math.round(temp.current * 10) / 10}°C` : undefined}
        unitLabel="norm 18–26°C"
        status={temp?.status}
        sparkline={temp?.sparkline ?? []}
        cfg={{ color: tempColor, gradId: "T", chartMin: 8, chartMax: 35, ticks: [10,15,20,25,30], bandLo: 18, bandHi: 26, bandColor: GREEN, tooltipUnit: "°C" }}
        note="Normal range 18–26°C · configurable"
      />

      <EnvCard
        name="Humidity"
        current={hum?.current ?? null}
        displayVal={hum?.current != null ? `${Math.round(hum.current)}%` : undefined}
        unitLabel="RH · norm 50–70%"
        status={hum?.status}
        sparkline={hum?.sparkline ?? []}
        cfg={{ color: TEAL, gradId: "H", chartMin: 25, chartMax: 110, ticks: [30,50,70,90], bandLo: 50, bandHi: 70, bandColor: GREEN, tooltipUnit: "%" }}
        note="Normal range 50–70% RH · configurable"
      />

      <EnvCard
        name="Ventilation"
        current={co2?.current ?? null}
        displayVal={co2?.current != null ? `${Math.round(co2.current).toLocaleString()}` : undefined}
        unitLabel="ppm CO₂ · max 1,400"
        status={co2?.status}
        sparkline={co2?.sparkline ?? []}
        cfg={{ color: TEAL, gradId: "V", chartMin: 300, chartMax: 2500,
          ticks: [500,1000,1500,2000],
          thresholdHi: 1400, thresholdColor: RED,
          tickFmt: (v) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v}`,
          tooltipFmt: (v) => `${Math.round(v).toLocaleString()} ppm` }}
        note="CO₂ proxy · threshold 1,400 ppm configurable"
      />

      <EnvCard
        name="Air quality"
        current={tvoc?.current ?? null}
        displayVal={tvoc?.current != null ? `${Math.round(tvoc.current * 100) / 100}` : undefined}
        unitLabel="TVOC index"
        sparkline={tvoc?.sparkline ?? []}
        cfg={{
          color: TEAL, gradId: "A", chartMin: 0, chartMax: tvocChartMax,
          ticks: tvocTicks,
          bandLo: Math.max(0, tvocMean - tvocStd * 2),
          bandHi: tvocBandHi,
          bandColor: TEAL,
          tooltipUnit: "idx",
        }}
        note="±2σ adaptive baseline · farm normal"
      />
    </div>
  );
}
