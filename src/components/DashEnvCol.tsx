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

interface SparklineConfig {
  chartMin: number;
  chartMax: number;
  lo?: number;
  hi?: number;
  bandUnit?: string;
  threshold?: number;
  thresholdLabel?: string;
  color: string;
  bandColor: string;
  gradId: string;
}

function SparklineSvg({
  vals,
  cfg,
}: {
  vals: SparklinePoint[];
  cfg: SparklineConfig;
}) {
  const W = 360, H = 92, pL = 34, pR = 8, pT = 8, pB = 22;
  const plotW = W - pL - pR;
  const plotH = H - pT - pB;
  const { chartMin, chartMax, lo, hi, bandUnit = "", threshold, thresholdLabel, color, bandColor, gradId } = cfg;

  const toY = (v: number) =>
    pT + plotH * (1 - (Math.max(chartMin, Math.min(chartMax, v)) - chartMin) / (chartMax - chartMin));
  const toX = (i: number, n: number) => pL + (n <= 1 ? plotW : (i / (n - 1)) * plotW);

  const valid = vals.filter((pt) => !isNaN(pt.value) && isFinite(pt.value));
  const pts =
    valid.length > 1
      ? valid.map((pt, i) => `${toX(i, valid.length).toFixed(1)},${toY(pt.value).toFixed(1)}`).join(" ")
      : "";
  const lastX = valid.length > 0 ? toX(valid.length - 1, valid.length) : pL + plotW;
  const lastY = valid.length > 0 ? toY(valid[valid.length - 1].value) : pT + plotH / 2;

  const bandHiY = hi !== undefined ? toY(hi) : undefined;
  const bandLoY = lo !== undefined ? toY(lo) : undefined;
  const threshY = threshold !== undefined ? toY(threshold) : undefined;
  const yTicks = [chartMin, chartMin + (chartMax - chartMin) / 2, chartMax];
  const xTicks =
    valid.length > 1
      ? [0, Math.floor((valid.length - 1) / 2), valid.length - 1]
      : [];
  const fmtTick = (v: number) =>
    Math.abs(v) >= 1000 ? `${Math.round(v).toLocaleString()}` : Number.isInteger(v) ? `${v}` : v.toFixed(1);
  const fmtTime = (ts: string) =>
    new Date(ts).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false });

  // gradient for band fill
  const hasBand = bandHiY !== undefined && bandLoY !== undefined;
  // gradient for danger zone (threshold mode)
  const hasDanger = threshY !== undefined && threshold !== undefined;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: "100%", height: `${H}px`, display: "block" }}
    >
      <defs>
        {hasBand && (
          <linearGradient id={`grad-${gradId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={bandColor} stopOpacity="0.12" />
            <stop offset="100%" stopColor={bandColor} stopOpacity="0.03" />
          </linearGradient>
        )}
        {hasDanger && (
          <linearGradient id={`grad-${gradId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.08" />
            <stop offset="100%" stopColor={color} stopOpacity="0.01" />
          </linearGradient>
        )}
      </defs>

      {/* Normal band */}
      {hasBand && bandHiY !== undefined && bandLoY !== undefined && (
        <>
          <rect x={pL} y={bandHiY} width={plotW} height={bandLoY - bandHiY} fill={`url(#grad-${gradId})`} />
          <line x1={pL} y1={bandHiY} x2={pL + plotW} y2={bandHiY} stroke={bandColor} strokeWidth="0.5" strokeDasharray="4,4" opacity="0.35" />
          <line x1={pL} y1={bandLoY} x2={pL + plotW} y2={bandLoY} stroke={bandColor} strokeWidth="0.5" strokeDasharray="4,4" opacity="0.35" />
          {hi !== undefined && bandHiY !== undefined && (
            <text x={pL + 3} y={Math.max(bandHiY - 2, 7)} fontSize="7" fill={bandColor} opacity="0.5" fontFamily="Inter,sans-serif">
              {hi}{bandUnit}
            </text>
          )}
          {lo !== undefined && bandLoY !== undefined && (
            <text x={pL + 3} y={Math.min(bandLoY + 8, H - pB - 1)} fontSize="7" fill={bandColor} opacity="0.5" fontFamily="Inter,sans-serif">
              {lo}{bandUnit}
            </text>
          )}
        </>
      )}

      {/* Danger zone (threshold mode — fill above threshold line) */}
      {hasDanger && threshY !== undefined && (
        <>
          <rect x={pL} y={pT} width={plotW} height={Math.max(0, threshY - pT)} fill={`url(#grad-${gradId})`} />
          <line x1={pL} y1={threshY} x2={pL + plotW} y2={threshY} stroke={color} strokeWidth="0.75" strokeDasharray="5,3" opacity="0.5" />
          {thresholdLabel && (
            <text x={pL + 3} y={threshY - 3} fontSize="7" fill={color} opacity="0.55" fontFamily="Inter,sans-serif">
              {thresholdLabel}
            </text>
          )}
        </>
      )}

      {yTicks.map((v) => {
        const y = toY(v);
        return (
          <g key={v}>
            <line x1={pL} y1={y} x2={pL + plotW} y2={y} stroke="rgba(0,0,0,0.06)" strokeWidth="1" />
            <text x={pL - 6} y={y + 3} fontSize="8" fill="#6B7C80" textAnchor="end" fontFamily="Inter,sans-serif">
              {fmtTick(v)}
            </text>
          </g>
        );
      })}
      <line x1={pL} y1={pT} x2={pL} y2={pT + plotH} stroke="rgba(0,0,0,0.16)" strokeWidth="1" />
      <line x1={pL} y1={pT + plotH} x2={pL + plotW} y2={pT + plotH} stroke="rgba(0,0,0,0.16)" strokeWidth="1" />

      {/* Data line */}
      {pts && (
        <polyline
          points={pts}
          fill="none"
          stroke={color}
          strokeWidth="1.8"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}

      {/* End dot */}
      {valid.length > 0 && (
        <circle cx={lastX} cy={lastY} r="3" fill={color} />
      )}

      {xTicks.map((idx) => {
        const x = toX(idx, valid.length);
        const anchor = idx === 0 ? "start" : idx === valid.length - 1 ? "end" : "middle";
        return (
          <g key={idx}>
            <line x1={x} y1={pT + plotH} x2={x} y2={pT + plotH + 3} stroke="rgba(0,0,0,0.16)" strokeWidth="1" />
            <text x={x} y={H - 5} fontSize="8" fill="#6B7C80" textAnchor={anchor} fontFamily="Inter,sans-serif">
              {fmtTime(valid[idx].time)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function WaterSvg({ vals }: { vals: SparklinePoint[] }) {
  const W = 360, H = 112, pL = 34, pR = 36, pT = 8, pB = 22;
  const plotW = W - pL - pR;
  const plotH = H - pT - pB;
  const valid = vals.filter((pt) => !isNaN(pt.value) && isFinite(pt.value));
  const maxBar = Math.max(1, ...valid.map((pt) => pt.value));
  const maxCum = Math.max(1, ...valid.map((pt) => pt.cumulative ?? 0));
  const barGap = 1.5;
  const barW = valid.length > 0 ? Math.max(2, plotW / valid.length - barGap) : 2;
  const toBarY = (v: number) => pT + plotH * (1 - Math.min(v, maxBar) / maxBar);
  const toCumY = (v: number) => pT + plotH * (1 - Math.min(v, maxCum) / maxCum);
  const toX = (i: number, n: number) => pL + (n <= 1 ? plotW : (i / (n - 1)) * plotW);
  const fmtTime = (ts: string) =>
    new Date(ts).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false });
  const xTicks = valid.length > 1 ? [0, Math.floor((valid.length - 1) / 2), valid.length - 1] : [];
  const cumPts =
    valid.length > 1
      ? valid.map((pt, i) => `${toX(i, valid.length).toFixed(1)},${toCumY(pt.cumulative ?? 0).toFixed(1)}`).join(" ")
      : "";

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: `${H}px`, display: "block" }}>
      {[0, maxBar / 2, maxBar].map((v) => {
        const y = toBarY(v);
        return (
          <g key={v}>
            <line x1={pL} y1={y} x2={pL + plotW} y2={y} stroke="rgba(0,0,0,0.06)" strokeWidth="1" />
            <text x={pL - 6} y={y + 3} fontSize="8" fill="#6B7C80" textAnchor="end" fontFamily="Inter,sans-serif">
              {Math.round(v)}
            </text>
          </g>
        );
      })}
      <line x1={pL} y1={pT} x2={pL} y2={pT + plotH} stroke="rgba(0,0,0,0.16)" strokeWidth="1" />
      <line x1={pL} y1={pT + plotH} x2={pL + plotW} y2={pT + plotH} stroke="rgba(0,0,0,0.16)" strokeWidth="1" />
      <text x={W - 2} y={toCumY(maxCum) + 3} fontSize="8" fill="#D4AF37" textAnchor="end" fontFamily="Inter,sans-serif">
        {Math.round(maxCum)}
      </text>
      <text x={W - 2} y={pT + plotH + 3} fontSize="8" fill="#D4AF37" textAnchor="end" fontFamily="Inter,sans-serif">
        0
      </text>

      {valid.map((pt, i) => {
        const x = pL + i * (plotW / valid.length);
        const y = toBarY(pt.value);
        return (
          <rect
            key={`${pt.time}-${i}`}
            x={x}
            y={y}
            width={barW}
            height={pT + plotH - y}
            fill="#2A8E9A"
            opacity="0.82"
          />
        );
      })}

      {cumPts && (
        <polyline
          points={cumPts}
          fill="none"
          stroke="#D4AF37"
          strokeWidth="1.8"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}

      {xTicks.map((idx) => {
        const x = toX(idx, valid.length);
        const anchor = idx === 0 ? "start" : idx === valid.length - 1 ? "end" : "middle";
        return (
          <g key={idx}>
            <line x1={x} y1={pT + plotH} x2={x} y2={pT + plotH + 3} stroke="rgba(0,0,0,0.16)" strokeWidth="1" />
            <text x={x} y={H - 5} fontSize="8" fill="#6B7C80" textAnchor={anchor} fontFamily="Inter,sans-serif">
              {fmtTime(valid[idx].time)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function DailyWaterSvg({ vals }: { vals: DailyWaterPoint[] }) {
  const W = 360, H = 82, pL = 34, pR = 8, pT = 8, pB = 18;
  const plotW = W - pL - pR;
  const plotH = H - pT - pB;
  const valid = vals.filter((pt) => !isNaN(pt.litres) && isFinite(pt.litres));
  const maxLitres = Math.max(1, ...valid.map((pt) => pt.litres));
  const barGap = 6;
  const barW = valid.length > 0 ? Math.max(10, plotW / valid.length - barGap) : 10;
  const toY = (v: number) => pT + plotH * (1 - Math.min(v, maxLitres) / maxLitres);
  const fmtDay = (ts: string) =>
    new Date(ts).toLocaleDateString("en-ZA", { weekday: "short" });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: `${H}px`, display: "block", marginTop: "6px" }}>
      {[0, maxLitres].map((v) => {
        const y = toY(v);
        return (
          <g key={v}>
            <line x1={pL} y1={y} x2={pL + plotW} y2={y} stroke="rgba(0,0,0,0.06)" strokeWidth="1" />
            <text x={pL - 6} y={y + 3} fontSize="8" fill="#6B7C80" textAnchor="end" fontFamily="Inter,sans-serif">
              {Math.round(v)}
            </text>
          </g>
        );
      })}
      <line x1={pL} y1={pT} x2={pL} y2={pT + plotH} stroke="rgba(0,0,0,0.16)" strokeWidth="1" />
      <line x1={pL} y1={pT + plotH} x2={pL + plotW} y2={pT + plotH} stroke="rgba(0,0,0,0.16)" strokeWidth="1" />
      {valid.map((pt, i) => {
        const step = plotW / valid.length;
        const x = pL + i * step + barGap / 2;
        const y = toY(pt.litres);
        return (
          <g key={`${pt.date}-${i}`}>
            <rect x={x} y={y} width={barW} height={pT + plotH - y} fill="#2A8E9A" opacity="0.82" />
            <text x={x + barW / 2} y={H - 4} fontSize="8" fill="#6B7C80" textAnchor="middle" fontFamily="Inter,sans-serif">
              {fmtDay(pt.date)}
            </text>
          </g>
        );
      })}
      <text x={pL} y={pT + 8} fontSize="8" fill="#6B7C80" fontFamily="Inter,sans-serif">
        litres/day
      </text>
    </svg>
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
  cfg: SparklineConfig;
  note: string;
  chartKind?: "line" | "water";
  daily?: DailyWaterPoint[];
}

function EnvCard({
  name,
  current,
  displayVal,
  unitLabel,
  status,
  smallReading,
  sparkline,
  cfg,
  note,
  chartKind = "line",
  daily = [],
}: EnvCardProps) {
  const readingClass =
    `sa-env-reading${status === "warning" ? " warn" : status === "danger" ? " danger" : ""}${smallReading ? " small" : ""}`;
  const shown = displayVal ?? (current !== null ? String(Math.round(current * 10) / 10) : "—");

  return (
    <div className="sa-env-card">
      <div className="sa-env-head">
        <span className="sa-env-name">{name}</span>
        <span className={readingClass}>
          {shown} <span className="sa-env-unit">{unitLabel}</span>
        </span>
      </div>
      {chartKind === "water" ? <WaterSvg vals={sparkline} /> : <SparklineSvg vals={sparkline} cfg={cfg} />}
      {chartKind === "water" && daily.length > 0 && <DailyWaterSvg vals={daily} />}
      <div className="sa-env-foot">{note}</div>
    </div>
  );
}

export default function DashEnvCol({ env }: { env: EnvData | null }) {
  const temp = env?.temperature;
  const hum  = env?.humidity;
  const co2  = env?.co2;
  const tvoc = env?.tvoc;
  const water = env?.water;

  // Temperature line color follows status
  const tempColor =
    temp?.status === "danger" ? "#B91C1C" : temp?.status === "warning" ? "#D97706" : "#2A8E9A";

  // CO2 threshold label with formatted number
  const co2ThreshLabel = "1,400ppm";

  // TVOC adaptive band — scale to actual values, not a fixed minimum of 100
  const tvocMean = tvoc?.mean ?? 0;
  const tvocStd  = tvoc?.std ?? 1;
  const tvocCurrent = tvoc?.current ?? 0;
  const tvocPeak = Math.max(tvocMean + tvocStd * 4, tvocCurrent * 1.5, 1);
  const tvocChartMax = tvocPeak < 10 ? Math.ceil(tvocPeak * 2) : Math.ceil(tvocPeak * 1.3);

  // Format water current reading
  const waterDisplay =
    water?.current !== null && water?.current !== undefined
      ? Math.round(water.current).toLocaleString()
      : "—";

  return (
    <div className="sa-env-col">
      <div className="sa-col-header">Environmental Conditions · 24h</div>

      <EnvCard
        name="Temperature"
        current={temp?.current ?? null}
        displayVal={temp?.current !== null && temp?.current !== undefined ? `${Math.round((temp.current) * 10) / 10}°C` : undefined}
        unitLabel={`norm 18–26`}
        status={temp?.status}
        sparkline={temp?.sparkline ?? []}
        cfg={{ chartMin: 10, chartMax: 32, lo: 18, hi: 26, bandUnit: "°", color: tempColor, bandColor: "#166534", gradId: "T" }}
        note="Literature default · configurable"
      />

      <EnvCard
        name="Humidity"
        current={hum?.current ?? null}
        displayVal={hum?.current !== null && hum?.current !== undefined ? `${Math.round(hum.current)}%` : undefined}
        unitLabel="RH · norm 50–70"
        status={hum?.status}
        sparkline={hum?.sparkline ?? []}
        cfg={{ chartMin: 30, chartMax: 90, lo: 50, hi: 70, bandUnit: "%", color: "#2A8E9A", bandColor: "#166534", gradId: "H" }}
        note="Literature default · configurable"
      />

      <EnvCard
        name="Ventilation"
        current={co2?.current ?? null}
        displayVal={co2?.current !== null && co2?.current !== undefined ? `${Math.round(co2.current).toLocaleString()}` : undefined}
        unitLabel="ppm · max 1,400"
        status={co2?.status}
        sparkline={co2?.sparkline ?? []}
        cfg={{ chartMin: 400, chartMax: 2200, threshold: 1400, thresholdLabel: co2ThreshLabel, color: "#B91C1C", bandColor: "#B91C1C", gradId: "V" }}
        note="CO₂ proxy · threshold configurable"
      />

      <EnvCard
        name="Air quality"
        current={tvoc?.current ?? null}
        displayVal={tvoc?.current !== null && tvoc?.current !== undefined ? `${(Math.round(tvoc.current * 100) / 100)}` : undefined}
        unitLabel="TVOC idx"
        sparkline={tvoc?.sparkline ?? []}
        cfg={{
          chartMin: 0,
          chartMax: tvocChartMax,
          lo: Math.max(0, tvocMean - tvocStd * 2),
          hi: tvocMean + tvocStd * 2,
          color: "#2A8E9A",
          bandColor: "#2A8E9A",
          gradId: "A",
        }}
        note="±2σ rolling 7-day baseline · farm adaptive"
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
        cfg={{
          chartMin: 0,
          chartMax: 1,
          color: "#2A8E9A",
          bandColor: "#2A8E9A",
          gradId: "W",
        }}
        note="Top: litres per 30 min + 24h cumulative · bottom: litres per day"
      />
    </div>
  );
}
