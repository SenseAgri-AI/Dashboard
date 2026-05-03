import type { AlertItem } from "./DashAlertRow";

interface DashStatusBarProps {
  health: number;
  word: string;
  label: "good" | "normal" | "warning" | "danger";
  alerts?: AlertItem[];
}

const ARC_SEGMENTS = [
  { from: 0,  to: 20,  color: "#FCA5A5" },
  { from: 20, to: 35,  color: "#FB923C" },
  { from: 35, to: 60,  color: "#FCD34D" },
  { from: 60, to: 80,  color: "#86EFAC" },
  { from: 80, to: 100, color: "#4ADE80" },
];

const MINOR_TICKS = [10, 20, 30, 40, 60, 70, 80, 90];
const MAJOR_TICKS = [0, 25, 50, 75, 100];

function polarToCartesian(cx: number, cy: number, r: number, pct: number) {
  const angle = Math.PI - (Math.PI * pct) / 100;
  return { x: cx + r * Math.cos(angle), y: cy - r * Math.sin(angle) };
}

function arcPath(from: number, to: number) {
  const s = polarToCartesian(110, 108, 80, from);
  const e = polarToCartesian(110, 108, 80, to);
  return `M ${s.x} ${s.y} A 80 80 0 0 1 ${e.x} ${e.y}`;
}

function tickPath(pct: number, r1: number, r2: number) {
  const p1 = polarToCartesian(110, 108, r1, pct);
  const p2 = polarToCartesian(110, 108, r2, pct);
  return `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`;
}

export default function DashStatusBar({ health, word, label }: DashStatusBarProps) {
  const pct = Math.max(0, Math.min(100, health));
  const needle = polarToCartesian(110, 108, 64, pct);
  const tail   = polarToCartesian(110, 108, -14, pct);

  return (
    <div className="sa-gauge-card">
      <svg className="sa-gauge" viewBox="0 22 220 98" role="img" aria-label={`Farm health ${health} out of 100`}>
        <title>Farm health score</title>

        {/* Background track */}
        <path d={arcPath(0, 100)} stroke="rgba(0,0,0,0.08)" strokeWidth="13" strokeLinecap="butt" fill="none" />

        {/* Colour zones */}
        {ARC_SEGMENTS.map(seg => (
          <path key={`${seg.from}-${seg.to}`}
            d={arcPath(seg.from, seg.to)}
            stroke={seg.color} strokeWidth="13" strokeLinecap="butt" fill="none" />
        ))}

        {/* Minor ticks — inward from inner edge */}
        {MINOR_TICKS.map(p => (
          <path key={`mt-${p}`} d={tickPath(p, 73, 68)}
            stroke="rgba(0,0,0,0.22)" strokeWidth="1" fill="none" />
        ))}

        {/* Major ticks — longer inward */}
        {MAJOR_TICKS.map(p => (
          <path key={`mj-${p}`} d={tickPath(p, 73, 61)}
            stroke="rgba(0,0,0,0.38)" strokeWidth="1.5" fill="none" />
        ))}

        {/* Major tick labels */}
        {MAJOR_TICKS.map(p => {
          const pos = polarToCartesian(110, 108, 53, p);
          return (
            <text key={`lbl-${p}`}
              x={pos.x} y={pos.y + 3}
              textAnchor="middle" fontSize="7.5"
              fill="rgba(107,124,128,0.8)" fontFamily="Inter,sans-serif">
              {p}
            </text>
          );
        })}

        {/* Needle */}
        <line x1={tail.x} y1={tail.y} x2={needle.x} y2={needle.y}
          stroke="var(--primary)" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="110" cy="108" r="5" fill="var(--primary)" />
        <circle cx="110" cy="108" r="2.5" fill="rgba(255,255,255,0.5)" />

        {/* Score */}
        <text x="110" y="83" textAnchor="middle" className="sa-gauge-value">{health}</text>
        <text x="110" y="97" textAnchor="middle" className="sa-gauge-label">health score</text>
      </svg>

      <div className="sa-gauge-footer">
        <span className={`sa-range-dot ${label}`} />
        <span className={`sa-gauge-word ${label}`}>{word}</span>
      </div>
    </div>
  );
}
