"use client";

import { useEffect, useState } from "react";

// Flock Night-Rest Score tile — last night's score, the change vs the night before, a short reason,
// a sparkline of recent nights, and the factor breakdown (why the score is what it is). Reads
// /api/sleep-score. See docs/flock-night-rest-score.md.
type ThiZone = "comfort" | "alert" | "danger" | "emergency";
type Breakdown = { noise: number; bouts: number; severity: number; predawn: number; heat: number };
type NightScore = {
  date: string; score: number; disruptMin: number; bouts: number; severity: number; predawn: number;
  thi: number | null; thiZone: ThiZone | null; breakdown: Breakdown;
};

const PRIMARY = "#002E35", TEAL = "#2A8E9A", GREEN = "#166534", AMBER = "#D97706", RED = "#B91C1C", INK = "#4A5A5E";
const band = (s: number) => (s >= 85 ? { c: GREEN, label: "Restful" } : s >= 60 ? { c: AMBER, label: "Some disruption" } : { c: RED, label: "Disturbed" });
const zoneColor = (z: ThiZone | null) => (z === "emergency" || z === "danger" ? RED : z === "alert" ? AMBER : GREEN);
const fmtDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" });

// Interactive sparkline of the last 12 nights. Click (mouse) or tap (touch) a night to inspect it —
// deliberately NOT hover, which caused a layout-shift feedback loop as the score's digit-count resized
// the tile under the cursor. `activeIdx` is a GLOBAL index into `nights`.
function Spark({ nights, activeIdx, onPick }: {
  nights: NightScore[]; activeIdx: number; onPick: (i: number) => void;
}) {
  const pts = nights.slice(-12);
  const base = nights.length - pts.length; // local i → global base+i
  if (pts.length < 2) return null;
  const W = 150, H = 40, P = 4;
  const x = (i: number) => P + (i / (pts.length - 1)) * (W - 2 * P);
  const y = (v: number) => P + (1 - v / 100) * (H - 2 * P);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.score).toFixed(1)}`).join(" ");
  const localActive = activeIdx - base;
  const bw = (W - 2 * P) / (pts.length - 1);
  return (
    <svg width={W} height={H} style={{ display: "block", touchAction: "manipulation", cursor: "pointer" }}>
      <line x1={P} y1={y(85)} x2={W - P} y2={y(85)} stroke={GREEN} strokeWidth={0.5} strokeDasharray="2 2" opacity={0.4} />
      <path d={d} fill="none" stroke={PRIMARY} strokeWidth={1.6} />
      {localActive >= 0 && localActive < pts.length && (
        <line x1={x(localActive)} y1={0} x2={x(localActive)} y2={H} stroke={PRIMARY} strokeWidth={0.75} opacity={0.25} />
      )}
      {pts.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.score)} r={i === localActive ? 3.5 : 1.8}
          fill={i === localActive ? band(p.score).c : PRIMARY} opacity={i === localActive ? 1 : 0.45} />
      ))}
      {/* transparent hit-bands: click / tap only (no hover) */}
      {pts.map((p, i) => (
        <rect key={`h${i}`} x={x(i) - bw / 2} y={0} width={bw} height={H} fill="transparent" onPointerDown={() => onPick(base + i)} />
      ))}
    </svg>
  );
}

// One factor row: label, a proportional deduction bar, and the −points value. A factor that took
// nothing off shows a green "clear" tick, so a flawless night reads as all-clear, not empty.
function Factor({ label, deduction, color, note }: { label: string; deduction: number; color: string; note?: string }) {
  const REF = 30; // bar full-scale, in points
  const w = Math.min(100, (deduction / REF) * 100);
  const off = deduction < 0.05;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
      <span style={{ width: 92, color: INK, flexShrink: 0 }}>{label}{note && <span style={{ color: "var(--t4)" }}> · {note}</span>}</span>
      <span style={{ flex: 1, height: 6, background: "rgba(0,0,0,0.05)", borderRadius: 3, overflow: "hidden" }}>
        <span style={{ display: "block", height: "100%", width: off ? "0%" : `${w}%`, background: color, borderRadius: 3 }} />
      </span>
      <span style={{ width: 36, textAlign: "right", color: off ? GREEN : PRIMARY, fontWeight: off ? 400 : 700, flexShrink: 0 }}>
        {off ? "✓ ok" : `−${Math.round(deduction)}`}
      </span>
    </div>
  );
}

// Prev/next night stepper button (≥28px tap target).
function Step({ dir, disabled, onClick }: { dir: "prev" | "next"; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button" aria-label={dir === "prev" ? "Previous night" : "Next night"} disabled={disabled} onClick={onClick}
      style={{
        width: 28, height: 24, display: "inline-flex", alignItems: "center", justifyContent: "center",
        border: "1px solid var(--divider)", borderRadius: 6, background: "#fff", padding: 0,
        color: disabled ? "var(--t4)" : PRIMARY, cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.4 : 1, fontSize: 13, lineHeight: 1,
      }}
    >
      {dir === "prev" ? "‹" : "›"}
    </button>
  );
}

export default function DashSleepScore() {
  const [nights, setNights] = useState<NightScore[] | null>(null);
  const [err, setErr] = useState(false);
  const [sel, setSel] = useState<number | null>(null); // selected night index; null = latest
  const [open, setOpen] = useState(false);             // breakdown dropdown expanded?
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/sleep-score");
        if (r.ok) setNights((await r.json()).nights ?? []);
        else setErr(true);
      } catch { setErr(true); }
    })();
  }, []);

  const n = nights ?? [];
  const lastIdx = n.length - 1;
  const idx = sel == null ? lastIdx : Math.min(sel, lastIdx);
  const cur = n.length ? n[idx] : null;             // the night on show
  const curPrev = idx >= 1 ? n[idx - 1] : null;
  const viewingPast = sel != null && idx !== lastIdx;
  const b = cur ? band(cur.score) : null;
  const change = cur && curPrev ? Math.round(cur.score - curPrev.score) : null;
  const reason = !cur ? "" : cur.disruptMin === 0 && cur.breakdown.heat < 0.05
    ? "No disruptions — the flock slept quietly."
    : `${cur.disruptMin} min of raised noise${cur.bouts > 1 ? `, ${cur.bouts} bouts` : ""}${cur.predawn > 0 ? " (some pre-dawn unrest)" : ""}${cur.breakdown.heat >= 0.05 ? `; experienced heat elevated (THI ${cur.thi})` : ""}.`;

  return (
    <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,0.07)", borderRadius: 12, boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 15px", borderBottom: "1px solid var(--divider)" }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={TEAL} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" /></svg>
        <span style={{ fontFamily: "var(--font-d)", fontWeight: 800, fontSize: 14, color: "var(--primary)" }}>Flock sleep</span>
        {cur && (
          <span style={{ fontSize: 10, color: "var(--t3)", marginLeft: "auto" }}>
            {viewingPast ? "past night · " : ""}night of {fmtDate(cur.date)}
          </span>
        )}
      </div>
      <div style={{ padding: "14px 16px" }}>
        {err || (nights && nights.length === 0) ? (
          <div style={{ color: "var(--t3)", fontSize: 12.5 }}>No night acoustic data yet — the score will appear once the mic feed is flowing.</div>
        ) : !nights ? (
          <div style={{ color: "var(--t3)", fontSize: 12.5 }}>Loading…</div>
        ) : cur && b ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
              <div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontFamily: "var(--font-d)", fontWeight: 800, fontSize: 38, lineHeight: 1, color: b.c, display: "inline-block", minWidth: 58, fontVariantNumeric: "tabular-nums" }}>{Math.round(cur.score)}</span>
                  <span style={{ fontSize: 13, color: "var(--t3)" }}>/100</span>
                  {change !== null && change !== 0 && (
                    <span style={{ fontSize: 12, fontWeight: 700, color: change > 0 ? GREEN : RED }}>{change > 0 ? "▲" : "▼"} {Math.abs(change)}</span>
                  )}
                </div>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: b.c, marginTop: 2 }}>{b.label}</div>
              </div>
              <div style={{ flex: 1, minWidth: 150 }}>
                <div style={{ fontSize: 11.5, color: "var(--t2)", lineHeight: 1.4, marginBottom: 6 }}>{reason}</div>
                <Spark nights={n} activeIdx={idx} onPick={setSel} />
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
                  <Step dir="prev" disabled={idx <= 0} onClick={() => setSel(Math.max(0, idx - 1))} />
                  <Step dir="next" disabled={idx >= lastIdx} onClick={() => setSel(idx + 1 >= lastIdx ? null : idx + 1)} />
                  <span style={{ fontSize: 9.5, color: "var(--t4)" }}>
                    tap a night
                    {viewingPast && <> · <span role="button" tabIndex={0} onClick={() => setSel(null)} style={{ color: TEAL, fontWeight: 700, cursor: "pointer" }}>latest</span></>}
                  </span>
                </div>
              </div>
            </div>

            {/* Factor breakdown — collapsible; points removed from 100 by each cause, for the night on show */}
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--divider)" }}>
              <button
                type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ fontSize: 9, color: "var(--t3)", transform: open ? "rotate(90deg)" : "none", transition: "transform .12s", display: "inline-block" }}>▶</span>
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: "var(--t3)" }}>Why this score</span>
                </span>
                {(() => {
                  const total = cur.breakdown.noise + cur.breakdown.bouts + cur.breakdown.severity + cur.breakdown.predawn + cur.breakdown.heat;
                  return <span style={{ fontSize: 10.5, fontWeight: 700, color: total < 0.5 ? GREEN : INK }}>{total < 0.5 ? "✓ nothing deducted" : `−${Math.round(total)} pts`}</span>;
                })()}
              </button>
              {open && (
                <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 10 }}>
                  <Factor label="Noise" deduction={cur.breakdown.noise} color={TEAL} />
                  <Factor label="Bouts" deduction={cur.breakdown.bouts} color={TEAL} />
                  <Factor label="Loudness" deduction={cur.breakdown.severity} color={TEAL} />
                  <Factor label="Pre-dawn" deduction={cur.breakdown.predawn} color={PRIMARY} />
                  <Factor label="Heat" note={cur.thi != null ? `THI ${cur.thi}` : "no data"} deduction={cur.breakdown.heat} color={zoneColor(cur.thiZone)} />
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
