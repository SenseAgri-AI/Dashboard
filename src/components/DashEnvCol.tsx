"use client";

import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  ReferenceArea, ReferenceLine, ResponsiveContainer,
  ComposedChart, Bar, Line, BarChart,
} from "recharts";

export interface EnvData {
  temperature: { current: number | null; status: string; sparkline: SparklinePoint[] };
  humidity:    { current: number | null; status: string; sparkline: SparklinePoint[] };
  co2:         { current: number | null; status: string; sparkline: SparklinePoint[] };
  tvoc:        { current: number | null; sparkline: SparklinePoint[]; mean: number; std: number };
  water:       { current: number | null; sparkline: SparklinePoint[]; daily: DailyWaterPoint[]; mean: number; std: number };
}

export interface SparklinePoint {
  time: string;
  value: number;
  cumulative?: number;
}

export interface DailyWaterPoint {
  date: string;
  litres: number;
}

const TEAL = "#2A8E9A";
const GOLD  = "#D4AF37";
const T3    = "#6B7C80";
const GREEN = "#166534";
const RED   = "#B91C1C";
const GRID  = "rgba(0,0,0,0.05)";
const TICK  = { fontSize: 9, fill: T3, fontFamily: "Inter,sans-serif" } as const;
const AXIS_LINE = { stroke: "rgba(0,0,0,0.09)" };

function fmtTime(ts: string) {
  return new Date(ts).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false });
}

interface SparkCfg {
  color: string;
  gradId: string;
  chartMin: number;
  chartMax: number;
  tickCount?: number;
  tickFmt?: (v: number) => string;
  bandLo?: number;
  bandHi?: number;
  bandColor?: string;
  thresholdHi?: number;   // fills above this value (danger zone)
  thresholdColor?: string;
}

function SparklineChart({ data, cfg }: { data: SparklinePoint[]; cfg: SparkCfg }) {
  const pts = data
    .filter(pt => isFinite(pt.value))
    .map(pt => ({ v: pt.value, t: fmtTime(pt.time) }));

  const gid = `sa-g-${cfg.gradId}`;

  return (
    <ResponsiveContainer width="100%" height={138}>
      <AreaChart data={pts} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={cfg.color} stopOpacity={0.22} />
            <stop offset="95%" stopColor={cfg.color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} vertical={false} />

        {/* Normal band */}
        {cfg.bandLo !== undefined && cfg.bandHi !== undefined && (
          <ReferenceArea y1={cfg.bandLo} y2={cfg.bandHi} fill={cfg.bandColor ?? cfg.color} fillOpacity={0.09} stroke="none" />
        )}
        {cfg.bandLo !== undefined && (
          <ReferenceLine y={cfg.bandLo} stroke={cfg.bandColor ?? cfg.color} strokeDasharray="4 3" strokeOpacity={0.38} />
        )}
        {cfg.bandHi !== undefined && (
          <ReferenceLine y={cfg.bandHi} stroke={cfg.bandColor ?? cfg.color} strokeDasharray="4 3" strokeOpacity={0.38} />
        )}

        {/* Danger zone above threshold */}
        {cfg.thresholdHi !== undefined && cfg.thresholdColor && (
          <>
            <ReferenceArea y1={cfg.thresholdHi} y2={cfg.chartMax} fill={cfg.thresholdColor} fillOpacity={0.08} stroke="none" />
            <ReferenceLine y={cfg.thresholdHi} stroke={cfg.thresholdColor} strokeDasharray="5 3" strokeOpacity={0.5}
              label={{ value: cfg.thresholdHi.toLocaleString(), position: "insideTopRight", fontSize: 8, fill: cfg.thresholdColor, opacity: 0.55 }}
            />
          </>
        )}

        <XAxis dataKey="t" tick={TICK} tickLine={false} axisLine={AXIS_LINE} interval="preserveStartEnd" minTickGap={52} />
        <YAxis
          domain={[cfg.chartMin, cfg.chartMax]}
          tick={TICK} tickLine={false} axisLine={false}
          width={38} tickCount={cfg.tickCount ?? 4}
          tickFormatter={cfg.tickFmt}
        />
        <Area type="monotone" dataKey="v" stroke={cfg.color} strokeWidth={1.8}
          fill={`url(#${gid})`} dot={false} activeDot={false} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function WaterChart({ data }: { data: SparklinePoint[] }) {
  const pts = data
    .filter(pt => isFinite(pt.value))
    .map(pt => ({ v: pt.value, cum: pt.cumulative ?? 0, t: fmtTime(pt.time) }));

  return (
    <ResponsiveContainer width="100%" height={138}>
      <ComposedChart data={pts} margin={{ top: 6, right: 44, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="t" tick={TICK} tickLine={false} axisLine={AXIS_LINE} interval="preserveStartEnd" minTickGap={52} />
        <YAxis yAxisId="bar" tick={TICK} tickLine={false} axisLine={false} width={38} tickCount={4}
          tickFormatter={v => v === 0 ? "0" : `${Math.round(v)}`} />
        <YAxis yAxisId="cum" orientation="right" tick={TICK} tickLine={false} axisLine={false} width={40} tickCount={3}
          tickFormatter={v => v === 0 ? "0" : `${Math.round(v)}L`} />
        <Bar yAxisId="bar" dataKey="v" fill={TEAL} fillOpacity={0.72} radius={0} isAnimationActive={false} />
        <Line yAxisId="cum" type="monotone" dataKey="cum" stroke={GOLD} strokeWidth={1.8}
          dot={false} activeDot={false} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function DailyWaterChart({ data }: { data: DailyWaterPoint[] }) {
  const pts = data
    .filter(pt => isFinite(pt.litres))
    .map(pt => ({
      v: pt.litres,
      day: new Date(pt.date + "T12:00:00Z").toLocaleDateString("en-ZA", { weekday: "short" }),
    }));

  return (
    <ResponsiveContainer width="100%" height={88}>
      <BarChart data={pts} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="day" tick={TICK} tickLine={false} axisLine={AXIS_LINE} />
        <YAxis tick={TICK} tickLine={false} axisLine={false} width={38} tickCount={3}
          tickFormatter={v => v === 0 ? "0" : `${Math.round(v)}L`} />
        <Bar dataKey="v" fill={TEAL} fillOpacity={0.72} radius={0} isAnimationActive={false} />
      </BarChart>
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
  chartKind?: "line" | "water";
  daily?: DailyWaterPoint[];
}

function EnvCard({ name, current, displayVal, unitLabel, status, smallReading, sparkline, cfg, note, chartKind = "line", daily = [] }: EnvCardProps) {
  const readingClass = `sa-env-reading${status === "warning" ? " warn" : status === "danger" ? " danger" : ""}${smallReading ? " small" : ""}`;
  const shown = displayVal ?? (current !== null ? String(Math.round(current * 10) / 10) : "—");

  return (
    <div className="sa-env-card">
      <div className="sa-env-head">
        <span className="sa-env-name">{name}</span>
        <span className={readingClass}>{shown} <span className="sa-env-unit">{unitLabel}</span></span>
      </div>
      {chartKind === "water"
        ? <WaterChart data={sparkline} />
        : <SparklineChart data={sparkline} cfg={cfg} />
      }
      {chartKind === "water" && daily.length > 0 && <DailyWaterChart data={daily} />}
      <div className="sa-env-foot">{note}</div>
    </div>
  );
}

export default function DashEnvCol({ env }: { env: EnvData | null }) {
  const temp  = env?.temperature;
  const hum   = env?.humidity;
  const co2   = env?.co2;
  const tvoc  = env?.tvoc;
  const water = env?.water;

  const tempColor = temp?.status === "danger" ? RED : temp?.status === "warning" ? "#D97706" : TEAL;

  const tvocMean = tvoc?.mean ?? 0;
  const tvocStd  = tvoc?.std ?? 1;
  const tvocCurrent = tvoc?.current ?? 0;
  const tvocPeak = Math.max(tvocMean + tvocStd * 4, tvocCurrent * 1.5, 1);
  const tvocChartMax = tvocPeak < 10 ? Math.ceil(tvocPeak * 2) : Math.ceil(tvocPeak * 1.3);

  const waterDisplay = water?.current !== null && water?.current !== undefined
    ? Math.round(water.current).toLocaleString() : "—";

  return (
    <div className="sa-env-col">
      <div className="sa-col-header">Environmental Conditions · 24h</div>

      <EnvCard
        name="Temperature"
        current={temp?.current ?? null}
        displayVal={temp?.current != null ? `${Math.round(temp.current * 10) / 10}°C` : undefined}
        unitLabel="norm 18–26"
        status={temp?.status}
        sparkline={temp?.sparkline ?? []}
        cfg={{ color: tempColor, gradId: "T", chartMin: 10, chartMax: 32, bandLo: 18, bandHi: 26, bandColor: GREEN }}
        note="Literature default · configurable"
      />

      <EnvCard
        name="Humidity"
        current={hum?.current ?? null}
        displayVal={hum?.current != null ? `${Math.round(hum.current)}%` : undefined}
        unitLabel="RH · norm 50–70"
        status={hum?.status}
        sparkline={hum?.sparkline ?? []}
        cfg={{ color: TEAL, gradId: "H", chartMin: 30, chartMax: 90, bandLo: 50, bandHi: 70, bandColor: GREEN }}
        note="Literature default · configurable"
      />

      <EnvCard
        name="Ventilation"
        current={co2?.current ?? null}
        displayVal={co2?.current != null ? `${Math.round(co2.current).toLocaleString()}` : undefined}
        unitLabel="ppm · max 1,400"
        status={co2?.status}
        sparkline={co2?.sparkline ?? []}
        cfg={{ color: RED, gradId: "V", chartMin: 400, chartMax: 2200, thresholdHi: 1400, thresholdColor: RED,
          tickFmt: (v) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v}` }}
        note="CO₂ proxy · threshold configurable"
      />

      <EnvCard
        name="Air quality"
        current={tvoc?.current ?? null}
        displayVal={tvoc?.current != null ? `${Math.round(tvoc.current * 100) / 100}` : undefined}
        unitLabel="TVOC idx"
        sparkline={tvoc?.sparkline ?? []}
        cfg={{
          color: TEAL, gradId: "A", chartMin: 0, chartMax: tvocChartMax,
          bandLo: Math.max(0, tvocMean - tvocStd * 2), bandHi: tvocMean + tvocStd * 2, bandColor: TEAL,
        }}
        note="±2σ rolling 24h baseline · farm adaptive"
      />

      <EnvCard
        name="Water consumption"
        current={water?.current ?? null}
        displayVal={waterDisplay}
        unitLabel="L / 30 min"
        smallReading
        sparkline={water?.sparkline ?? []}
        daily={water?.daily ?? []}
        chartKind="water"
        cfg={{ color: TEAL, gradId: "W", chartMin: 0, chartMax: 1 }}
        note="Bars = litres per 30 min · gold line = 24h cumulative · bottom = litres per day"
      />
    </div>
  );
}
