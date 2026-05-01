"use client";

import { useState, useEffect, useCallback } from "react";

const TEAL = "#2A8E9A";
const GOLD = "#D4AF37";
const T3 = "#6B7C80";
const LINE = "rgba(0,0,0,0.06)";

const SLIDES = [
  {
    title: "Egg count",
    sub: "7-day · production",
    note: "Today in teal · prior 6 days in slate",
  },
  {
    title: "Revenue",
    sub: "7-day · financial",
    note: "7-day revenue trend — today highlighted",
  },
  {
    title: "Hen-Day %",
    sub: "14-day · welfare derived",
    note: "Shaded band = normal zone for flock age",
  },
  {
    title: "Water:Feed ratio",
    sub: "14-day · welfare signal",
    note: "Shaded band = normal range 1.7–2.1×",
  },
  {
    title: "Feed conversion",
    sub: "7-day · pulses/egg",
    note: "Uncalibrated pulses — lower is better",
  },
];

function EggBarChart() {
  const vals = [7900, 8200, 7650, 8350, 8100, 7950, 8420];
  const days = ["M", "T", "W", "T", "F", "S", "S"];
  const W = 290, H = 170, pL = 26, pB = 20, pT = 8, bW = 28, gap = 10;
  const mn = 7400, mx = 8600, rng = mx - mn, pH = H - pB - pT;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: `${H}px`, display: "block" }}>
      {[7500, 8000, 8500].map((v) => {
        const y = pT + pH - ((v - mn) / rng) * pH;
        return (
          <g key={v}>
            <line x1={pL} y1={y} x2={W} y2={y} stroke={LINE} strokeWidth="1" />
            <text x={pL - 3} y={y + 3} fontSize="7" fill={T3} textAnchor="end" fontFamily="Inter,sans-serif">
              {(v / 1000).toFixed(1)}k
            </text>
          </g>
        );
      })}
      {vals.map((v, i) => {
        const bH = ((v - mn) / rng) * pH;
        const x = pL + i * (bW + gap);
        const y = pT + pH - bH;
        const isToday = i === 6;
        return (
          <g key={i}>
            <rect x={x} y={y} width={bW} height={bH} fill={isToday ? TEAL : "rgba(0,46,53,0.08)"} />
            <text x={x + bW / 2} y={H} fontSize="8.5" fill={isToday ? TEAL : T3} textAnchor="middle" fontFamily="Inter,sans-serif">
              {days[i]}
            </text>
            {isToday && (
              <text x={x + bW / 2} y={y - 5} fontSize="8" fill={TEAL} textAnchor="middle" fontFamily="Inter,sans-serif">
                {(v / 1000).toFixed(1)}k
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

interface LineSvgOptions {
  mn: number;
  mx: number;
  col: string;
  unit: string;
  labelLast?: boolean;
  dashed?: boolean;
}

function LineSvgChart({ vals, lbls, opts }: { vals: number[]; lbls: string[]; opts: LineSvgOptions }) {
  const { mn, mx, col, unit, labelLast, dashed } = opts;
  const W = 290, H = 170, pL = 32, pB = 20, pT = 10, rng = mx - mn;
  const pW = W - pL, pH = H - pB - pT;
  const step = pW / (vals.length - 1);

  const pts = vals.map((v, i) => `${pL + i * step},${pT + pH - ((v - mn) / rng) * pH}`).join(" ");
  const lx = pL + (vals.length - 1) * step;
  const ly = pT + pH - ((vals[vals.length - 1] - mn) / rng) * pH;

  const gridVals = [0, 1, 2, 3, 4].map((i) => mn + (mx - mn) * i / 4);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: `${H}px`, display: "block" }}>
      {gridVals.map((v, i) => {
        const y = pT + pH - (i / 4) * pH;
        return (
          <g key={i}>
            <line x1={pL} y1={y} x2={W} y2={y} stroke={LINE} strokeWidth="1" />
            <text x={pL - 4} y={y + 3} fontSize="7" fill={T3} textAnchor="end" fontFamily="Inter,sans-serif">
              {Number.isInteger(v) ? v : v.toFixed(1)}{unit}
            </text>
          </g>
        );
      })}
      <polyline
        points={pts}
        fill="none"
        stroke={col}
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
        {...(dashed ? { strokeDasharray: "5,3", opacity: "0.6" } : {})}
      />
      <circle cx={lx} cy={ly} r="3" fill={col} {...(dashed ? { opacity: "0.6" } : {})} />
      {lbls.map((l, i) => {
        const isLast = i === lbls.length - 1;
        return (
          <text key={i} x={pL + i * step} y={H} fontSize="8.5" fill={isLast && labelLast ? col : T3} textAnchor="middle" fontFamily="Inter,sans-serif">
            {l}
          </text>
        );
      })}
      {labelLast && (
        <text x={lx} y={ly - 7} fontSize="8" fill={col} textAnchor="middle" fontFamily="Inter,sans-serif">
          {vals[vals.length - 1]}{unit}
        </text>
      )}
      {dashed && (
        <text x={W - 2} y={pT + 12} fontSize="7.5" fill={T3} textAnchor="end" fontFamily="Inter,sans-serif">
          uncalibrated
        </text>
      )}
    </svg>
  );
}

interface BandSvgOptions {
  mn: number;
  mx: number;
  lo: number;
  hi: number;
  col: string;
  unit: string;
}

function BandSvgChart({ vals, lbls, opts }: { vals: number[]; lbls: string[]; opts: BandSvgOptions }) {
  const { mn, mx, lo, hi, col, unit } = opts;
  const W = 290, H = 170, pL = 34, pB = 20, pT = 10, rng = mx - mn;
  const pW = W - pL, pH = H - pB - pT;
  const step = pW / (vals.length - 1);

  const loY = pT + pH - ((lo - mn) / rng) * pH;
  const hiY = pT + pH - ((hi - mn) / rng) * pH;
  const pts = vals.map((v, i) => `${pL + i * step},${pT + pH - ((v - mn) / rng) * pH}`).join(" ");
  const lx = pL + (vals.length - 1) * step;
  const ly = pT + pH - ((vals[vals.length - 1] - mn) / rng) * pH;

  const skip = lbls.length > 8 ? 2 : 1;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: `${H}px`, display: "block" }}>
      {[0, 1, 2, 3].map((i) => (
        <line key={i} x1={pL} y1={pT + pH - (i / 3) * pH} x2={W} y2={pT + pH - (i / 3) * pH} stroke={LINE} strokeWidth="1" />
      ))}
      <rect x={pL} y={hiY} width={pW} height={loY - hiY} fill={col} opacity="0.07" />
      <line x1={pL} y1={hiY} x2={W} y2={hiY} stroke={col} strokeWidth="0.5" strokeDasharray="4,4" opacity="0.4" />
      <line x1={pL} y1={loY} x2={W} y2={loY} stroke={col} strokeWidth="0.5" strokeDasharray="4,4" opacity="0.4" />
      <text x={pL - 3} y={hiY + 4} fontSize="7" fill={col} textAnchor="end" opacity="0.6" fontFamily="Inter,sans-serif">
        {hi}{unit}
      </text>
      <text x={pL - 3} y={loY + 4} fontSize="7" fill={col} textAnchor="end" opacity="0.6" fontFamily="Inter,sans-serif">
        {lo}{unit}
      </text>
      <polyline points={pts} fill="none" stroke={col} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx} cy={ly} r="3" fill={col} />
      {lbls.map((l, i) => {
        if (i % skip !== 0) return null;
        return (
          <text key={i} x={pL + i * step} y={H} fontSize="8.5" fill={T3} textAnchor="middle" fontFamily="Inter,sans-serif">
            {l}
          </text>
        );
      })}
    </svg>
  );
}

function renderSlide(idx: number) {
  switch (idx) {
    case 0:
      return <EggBarChart />;
    case 1:
      return (
        <LineSvgChart
          vals={[3860, 4100, 3720, 4250, 3990, 3880, 4210]}
          lbls={["M", "T", "W", "T", "F", "S", "S"]}
          opts={{ mn: 3500, mx: 4600, col: GOLD, unit: "R", labelLast: true }}
        />
      );
    case 2:
      return (
        <BandSvgChart
          vals={[88, 89, 90, 89, 91, 90, 91, 92, 90, 89, 91, 92, 91, 91]}
          lbls={["M", "T", "W", "T", "F", "S", "S", "M", "T", "W", "T", "F", "S", "S"]}
          opts={{ mn: 82, mx: 98, lo: 88, hi: 95, col: TEAL, unit: "%" }}
        />
      );
    case 3:
      return (
        <BandSvgChart
          vals={[1.88, 1.92, 1.95, 1.90, 1.87, 1.94, 1.96, 1.93, 1.90, 1.88, 1.94, 1.97, 1.94, 1.94]}
          lbls={["M", "T", "W", "T", "F", "S", "S", "M", "T", "W", "T", "F", "S", "S"]}
          opts={{ mn: 1.5, mx: 2.2, lo: 1.7, hi: 2.1, col: TEAL, unit: "×" }}
        />
      );
    case 4:
      return (
        <LineSvgChart
          vals={[102, 98, 105, 96, 99, 103, 98]}
          lbls={["M", "T", "W", "T", "F", "S", "S"]}
          opts={{ mn: 88, mx: 114, col: T3, unit: "", dashed: true }}
        />
      );
    default:
      return null;
  }
}

export default function DashTrendsCarousel() {
  const [cur, setCur] = useState(0);

  const next = useCallback(() => setCur((c) => (c + 1) % SLIDES.length), []);

  useEffect(() => {
    const tmr = setInterval(next, 5000);
    return () => clearInterval(tmr);
  }, [next]);

  const slide = SLIDES[cur];

  return (
    <div className="sa-trends-col">
      <div className="sa-col-header">Trends</div>
      <div className="sa-carousel-card">
        <div className="sa-carousel-body">
          <div className="sa-chart-title">{slide.title}</div>
          <div className="sa-chart-sub">{slide.sub}</div>
          <div className="sa-chart-area sa-slide-in" key={cur}>
            {renderSlide(cur)}
          </div>
          <div className="sa-chart-note">{slide.note}</div>
        </div>
        <div className="sa-carousel-footer">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              className={`sa-c-dot${i === cur ? " active" : ""}`}
              onClick={() => setCur(i)}
              aria-label={`Go to slide ${i + 1}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
