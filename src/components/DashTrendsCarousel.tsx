"use client";

import { useState, useEffect, useCallback } from "react";
import type { ProductionData } from "./DashMetricCol";

const TEAL = "#2A8E9A";
const GOLD = "#D4AF37";
const T3 = "#6B7C80";
const LINE = "rgba(0,0,0,0.06)";

const SLIDES = [
  { title: "Egg count", sub: "7-day · production", note: "Today highlighted in teal" },
  { title: "Revenue", sub: "7-day · financial", note: "7-day revenue trend — today highlighted" },
  { title: "Hen-Day %", sub: "7-day · welfare derived", note: "Shaded band = normal zone 85–98%" },
  { title: "Feed conversion", sub: "7-day · pulses/egg", note: "Uncalibrated — lower is better. Will convert to kg/egg once auger is calibrated" },
];

function dayLabel(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][d.getDay()];
}

// ── Bar chart ────────────────────────────────────────────────────────────────

interface BarChartProps {
  vals: number[];
  lbls: string[];
  color: string;
  highlightLast?: boolean;
}

function BarChart({ vals, lbls, color, highlightLast }: BarChartProps) {
  const W = 290, H = 170, pL = 32, pB = 20, pT = 8;
  const mn = Math.min(...vals) * 0.97;
  const mx = Math.max(...vals) * 1.02;
  const rng = mx - mn || 1;
  const pH = H - pB - pT;
  const bW = Math.floor((W - pL - (vals.length - 1) * 6) / vals.length);
  const gap = 6;

  const gridVals = [
    Math.round(mn + rng * 0.33),
    Math.round(mn + rng * 0.67),
    Math.round(mx),
  ];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: `${H}px`, display: "block" }}>
      {gridVals.map((v) => {
        const y = pT + pH - ((v - mn) / rng) * pH;
        return (
          <g key={v}>
            <line x1={pL} y1={y} x2={W} y2={y} stroke={LINE} strokeWidth="1" />
            <text x={pL - 3} y={y + 3} fontSize="7" fill={T3} textAnchor="end" fontFamily="Inter,sans-serif">
              {v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}
            </text>
          </g>
        );
      })}
      {vals.map((v, i) => {
        const bH = ((v - mn) / rng) * pH;
        const x = pL + i * (bW + gap);
        const y = pT + pH - bH;
        const isToday = highlightLast && i === vals.length - 1;
        return (
          <g key={i}>
            <rect x={x} y={y} width={bW} height={bH} fill={isToday ? color : "rgba(0,46,53,0.08)"} />
            <text x={x + bW / 2} y={H} fontSize="8.5" fill={isToday ? color : T3} textAnchor="middle" fontFamily="Inter,sans-serif">
              {lbls[i]}
            </text>
            {isToday && (
              <text x={x + bW / 2} y={y - 5} fontSize="8" fill={color} textAnchor="middle" fontFamily="Inter,sans-serif">
                {v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ── Line chart ───────────────────────────────────────────────────────────────

interface LineChartProps {
  vals: number[];
  lbls: string[];
  color: string;
  unit?: string;
  dashed?: boolean;
  labelLast?: boolean;
  formatVal?: (v: number) => string;
}

function LineChart({ vals, lbls, color, unit = "", dashed, labelLast, formatVal }: LineChartProps) {
  const W = 290, H = 170, pL = 36, pB = 20, pT = 10;
  const mn = Math.min(...vals) * 0.97;
  const mx = Math.max(...vals) * 1.02;
  const rng = mx - mn || 1;
  const pW = W - pL, pH = H - pB - pT;
  const step = pW / Math.max(vals.length - 1, 1);

  const pts = vals.map((v, i) => `${pL + i * step},${pT + pH - ((v - mn) / rng) * pH}`).join(" ");
  const lx = pL + (vals.length - 1) * step;
  const ly = pT + pH - ((vals[vals.length - 1] - mn) / rng) * pH;
  const fmt = formatVal ?? ((v: number) => `${v}${unit}`);

  const gridVals = [0, 1, 2, 3].map((i) => mn + rng * i / 3);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: `${H}px`, display: "block" }}>
      {gridVals.map((v, i) => {
        const y = pT + pH - (i / 3) * pH;
        return (
          <g key={i}>
            <line x1={pL} y1={y} x2={W} y2={y} stroke={LINE} strokeWidth="1" />
            <text x={pL - 4} y={y + 3} fontSize="7" fill={T3} textAnchor="end" fontFamily="Inter,sans-serif">
              {fmt(v)}
            </text>
          </g>
        );
      })}
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
        {...(dashed ? { strokeDasharray: "5,3", opacity: "0.6" } : {})}
      />
      <circle cx={lx} cy={ly} r="3" fill={color} {...(dashed ? { opacity: "0.6" } : {})} />
      {lbls.map((l, i) => (
        <text key={i} x={pL + i * step} y={H} fontSize="8.5" fill={i === lbls.length - 1 && labelLast ? color : T3} textAnchor="middle" fontFamily="Inter,sans-serif">
          {l}
        </text>
      ))}
      {labelLast && (
        <text x={lx} y={ly - 7} fontSize="8" fill={color} textAnchor="middle" fontFamily="Inter,sans-serif">
          {fmt(vals[vals.length - 1])}
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

// ── Band chart ───────────────────────────────────────────────────────────────

interface BandChartProps {
  vals: number[];
  lbls: string[];
  lo: number;
  hi: number;
  color: string;
  unit?: string;
}

function BandChart({ vals, lbls, lo, hi, color, unit = "" }: BandChartProps) {
  const W = 290, H = 170, pL = 34, pB = 20, pT = 10;
  const mn = Math.min(Math.min(...vals), lo) * 0.97;
  const mx = Math.max(Math.max(...vals), hi) * 1.02;
  const rng = mx - mn || 1;
  const pW = W - pL, pH = H - pB - pT;
  const step = pW / Math.max(vals.length - 1, 1);

  const toY = (v: number) => pT + pH - ((v - mn) / rng) * pH;
  const loY = toY(lo), hiY = toY(hi);
  const pts = vals.map((v, i) => `${pL + i * step},${toY(v)}`).join(" ");
  const lx = pL + (vals.length - 1) * step;
  const ly = toY(vals[vals.length - 1]);
  const skip = lbls.length > 8 ? 2 : 1;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: `${H}px`, display: "block" }}>
      {[0, 1, 2, 3].map((i) => (
        <line key={i} x1={pL} y1={pT + pH - (i / 3) * pH} x2={W} y2={pT + pH - (i / 3) * pH} stroke={LINE} strokeWidth="1" />
      ))}
      <rect x={pL} y={hiY} width={pW} height={loY - hiY} fill={color} opacity="0.07" />
      <line x1={pL} y1={hiY} x2={W} y2={hiY} stroke={color} strokeWidth="0.5" strokeDasharray="4,4" opacity="0.4" />
      <line x1={pL} y1={loY} x2={W} y2={loY} stroke={color} strokeWidth="0.5" strokeDasharray="4,4" opacity="0.4" />
      <text x={pL - 3} y={hiY + 4} fontSize="7" fill={color} textAnchor="end" opacity="0.6" fontFamily="Inter,sans-serif">{hi}{unit}</text>
      <text x={pL - 3} y={loY + 4} fontSize="7" fill={color} textAnchor="end" opacity="0.6" fontFamily="Inter,sans-serif">{lo}{unit}</text>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx} cy={ly} r="3" fill={color} />
      {lbls.map((l, i) => {
        if (i % skip !== 0) return null;
        return (
          <text key={i} x={pL + i * step} y={H} fontSize="8.5" fill={T3} textAnchor="middle" fontFamily="Inter,sans-serif">{l}</text>
        );
      })}
    </svg>
  );
}

// ── Pending slide ─────────────────────────────────────────────────────────────

function PendingChart({ message }: { message: string }) {
  return (
    <div style={{ height: 170, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <span style={{ fontSize: 12, color: T3, fontFamily: "Inter,sans-serif" }}>{message}</span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface DashTrendsCarouselProps {
  production: ProductionData | null;
}

export default function DashTrendsCarousel({ production }: DashTrendsCarouselProps) {
  const [cur, setCur] = useState(0);
  const next = useCallback(() => setCur((c) => (c + 1) % SLIDES.length), []);

  useEffect(() => {
    const tmr = setInterval(next, 5000);
    return () => clearInterval(tmr);
  }, [next]);

  const daily = production?.daily ?? [];
  const eggVals = daily.map((d) => d.eggs);
  const revVals = daily.map((d) => d.revenue);
  const hdepVals = daily.map((d) => d.hdep ?? 0);
  const lbls = daily.map((d) => dayLabel(d.date));

  // FCR proxy: only days where both eggs and feed pulses are available
  const fcrDays = daily.filter((d) => d.fcr !== null);
  const fcrVals = fcrDays.map((d) => d.fcr!);
  const fcrLbls = fcrDays.map((d) => dayLabel(d.date));

  function renderSlide(idx: number) {
    switch (idx) {
      case 0:
        return eggVals.length > 0
          ? <BarChart vals={eggVals} lbls={lbls} color={TEAL} highlightLast />
          : <PendingChart message="Loading egg count data…" />;
      case 1:
        return revVals.length > 0
          ? <LineChart
              vals={revVals}
              lbls={lbls}
              color={GOLD}
              labelLast
              formatVal={(v) => `R${Math.round(v / 100) / 10}k`}
            />
          : <PendingChart message="Loading revenue data…" />;
      case 2:
        return hdepVals.length > 0
          ? <BandChart vals={hdepVals} lbls={lbls} lo={85} hi={98} color={TEAL} unit="%" />
          : <PendingChart message="Loading HDEP data…" />;
      case 3:
        return fcrVals.length > 1
          ? <LineChart
              vals={fcrVals}
              lbls={fcrLbls}
              color={T3}
              dashed
              labelLast
              formatVal={(v) => v.toFixed(2)}
            />
          : <PendingChart message="Loading feed conversion data…" />;
      default:
        return null;
    }
  }

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
