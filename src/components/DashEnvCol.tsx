export interface EnvData {
  temperature: { current: number | null; status: string; sparkline: number[] };
  humidity:    { current: number | null; status: string; sparkline: number[] };
  co2:         { current: number | null; status: string; sparkline: number[] };
  tvoc:        { current: number | null; sparkline: number[]; mean: number; std: number };
  water:       { current: number | null; sparkline: number[]; mean: number; std: number };
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
  vals: number[];
  cfg: SparklineConfig;
}) {
  const W = 340, H = 52;
  const { chartMin, chartMax, lo, hi, bandUnit = "", threshold, thresholdLabel, color, bandColor, gradId } = cfg;

  const toY = (v: number) =>
    H * (1 - (Math.max(chartMin, Math.min(chartMax, v)) - chartMin) / (chartMax - chartMin));
  const toX = (i: number, n: number) => (n <= 1 ? W : (i / (n - 1)) * W);

  const valid = vals.filter((v) => !isNaN(v) && isFinite(v));
  const pts =
    valid.length > 1
      ? valid.map((v, i) => `${toX(i, valid.length).toFixed(1)},${toY(v).toFixed(1)}`).join(" ")
      : "";
  const lastX = valid.length > 0 ? toX(valid.length - 1, valid.length) : W;
  const lastY = valid.length > 0 ? toY(valid[valid.length - 1]) : H / 2;

  const bandHiY = hi !== undefined ? toY(hi) : undefined;
  const bandLoY = lo !== undefined ? toY(lo) : undefined;
  const threshY = threshold !== undefined ? toY(threshold) : undefined;

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
          <rect x={0} y={bandHiY} width={W} height={bandLoY - bandHiY} fill={`url(#grad-${gradId})`} />
          <line x1={0} y1={bandHiY} x2={W} y2={bandHiY} stroke={bandColor} strokeWidth="0.5" strokeDasharray="4,4" opacity="0.35" />
          <line x1={0} y1={bandLoY} x2={W} y2={bandLoY} stroke={bandColor} strokeWidth="0.5" strokeDasharray="4,4" opacity="0.35" />
          {hi !== undefined && bandHiY !== undefined && (
            <text x={2} y={Math.max(bandHiY - 2, 7)} fontSize="7" fill={bandColor} opacity="0.5" fontFamily="Inter,sans-serif">
              {hi}{bandUnit}
            </text>
          )}
          {lo !== undefined && bandLoY !== undefined && (
            <text x={2} y={Math.min(bandLoY + 8, H - 1)} fontSize="7" fill={bandColor} opacity="0.5" fontFamily="Inter,sans-serif">
              {lo}{bandUnit}
            </text>
          )}
        </>
      )}

      {/* Danger zone (threshold mode — fill above threshold line) */}
      {hasDanger && threshY !== undefined && (
        <>
          <rect x={0} y={0} width={W} height={threshY} fill={`url(#grad-${gradId})`} />
          <line x1={0} y1={threshY} x2={W} y2={threshY} stroke={color} strokeWidth="0.75" strokeDasharray="5,3" opacity="0.5" />
          {thresholdLabel && (
            <text x={2} y={threshY - 3} fontSize="7" fill={color} opacity="0.55" fontFamily="Inter,sans-serif">
              {thresholdLabel}
            </text>
          )}
        </>
      )}

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
  sparkline: number[];
  cfg: SparklineConfig;
  note: string;
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
      <SparklineSvg vals={sparkline} cfg={cfg} />
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

  // Water adaptive band — only show band when there's actual data
  const waterSpark = water?.sparkline ?? [];
  const waterHasData = waterSpark.length > 3;
  const waterMean    = water?.mean ?? 0;
  const waterStd     = water?.std ?? 0;
  const waterPeak    = Math.max(waterMean + waterStd * 4, water?.current ?? 0, 10);
  const waterChartMax = waterHasData ? Math.ceil(waterPeak * 1.3) : 100;
  const waterLoVal   = waterHasData ? Math.max(0, waterMean - waterStd * 2) : undefined;
  const waterHiVal   = waterHasData ? waterMean + waterStd * 2 : undefined;

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
        unitLabel="pulses"
        smallReading
        sparkline={water?.sparkline ?? []}
        cfg={{
          chartMin: 0,
          chartMax: waterChartMax,
          lo: waterLoVal,
          hi: waterHiVal,
          color: "#2A8E9A",
          bandColor: "#2A8E9A",
          gradId: "W",
        }}
        note="±2σ rolling baseline · pulses until sensor calibration complete"
      />
    </div>
  );
}
