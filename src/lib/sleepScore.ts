// Flock Night-Rest Score — the validated sleep score from the night acoustics + experienced heat.
// Full logic + rationale: docs/flock-night-rest-score.md (validation notebook: analysis/night_rest_score).
// Built on the ABSOLUTE night-noise level: a restful night stays quiet; a poor night has loud
// disruptions (the flock erupting) in the dark period. Quiet/fan nights score 100 (correct); real
// disturbances rank low. Heat (THI) and darkness are separate factors from the climate feed — heat
// suppresses sleep even when the birds are quiet; darkness checks they got ENOUGH dark time to rest
// (one-sided — too little is penalised, too much is fine). Pure — the route supplies noise + climate.

import { thi, thiZone, heatPenalty, plausibleClimate, type ThiZone } from "./thi";

export const NIGHT_START_SAST = 20;   // dark period 20:00–05:00 SAST
export const NIGHT_END_SAST = 5;
export const DISRUPT_DB = -32;        // mean above this = a loud disruption
export const BOUT_MIN = 2;            // minutes to count as a disruption bout
export const DARK_MAX_LEVEL = 0;      // AM308 light_level 0 (≤5 lux) = dark; ≥1 = lit
export const DARK_TARGET_H = 8;       // ≥ this many hours of darkness = optimal (no penalty)
export const DARK_PENALTY_PER_H = 3;  // points docked per hour short of the target (ONE-SIDED: too
export const DARK_CAP = 20;           //   much darkness is fine, only too little is penalised)
const DARK_START_SAST = 18;           // scan the whole natural night (dusk→dawn), wide enough to catch
const DARK_END_SAST = 7;              //   the summer edges where darkness gets squeezed (13 h window)
const DARK_MIN_SAMPLES = 60;          // need ~1 h of light readings to judge a night's darkness
const SAST_OFFSET_MS = 2 * 3_600_000;
const MIN_NIGHT_POINTS = 120;         // skip nights with too little coverage to score fairly

export type NoiseSample = { t: number; mean: number | null };              // t = ms epoch (UTC)
// t = ms epoch (UTC); light = AM308 light_level 0–5 index (see docs/sensors.md)
export type ClimateSample = { t: number; temp: number | null; rh: number | null; light: number | null };

// Points removed from 100 by each factor (before the 0-floor). Surfaced on the dashboard breakdown.
export type ScoreBreakdown = { noise: number; bouts: number; severity: number; predawn: number; heat: number; darkness: number };

export type NightScore = {
  date: string;        // YYYY-MM-DD — the evening the night starts
  score: number;       // 0–100 (100 = undisturbed)
  disruptMin: number;
  bouts: number;
  severity: number;    // avg dB above the disruption line
  predawn: number;     // fraction of the final 2 h disrupted (red-mite window)
  thi: number | null;  // mean experienced-heat over the dark period (null if no climate coverage)
  thiZone: ThiZone | null;
  darknessHours: number | null; // hours of darkness over the dusk→dawn scan (null if no light coverage)
  breakdown: ScoreBreakdown;
  points: number;      // acoustic samples that scored the night
};

// A night is labelled by the evening it starts (subtract the night-start hours, take the date).
function nightKey(tMs: number): string | null {
  const h = new Date(tMs + SAST_OFFSET_MS).getUTCHours();
  if (!(h >= NIGHT_START_SAST || h < NIGHT_END_SAST)) return null;
  return new Date(tMs + SAST_OFFSET_MS - NIGHT_START_SAST * 3_600_000).toISOString().slice(0, 10);
}

// Same idea for the WIDER dusk→dawn darkness scan (18:00–07:00), labelled by the same evening date.
function darkKey(tMs: number): string | null {
  const h = new Date(tMs + SAST_OFFSET_MS).getUTCHours();
  if (!(h >= DARK_START_SAST || h < DARK_END_SAST)) return null;
  return new Date(tMs + SAST_OFFSET_MS - DARK_START_SAST * 3_600_000).toISOString().slice(0, 10);
}

// The acoustic metrics for one night (no scoring yet — heat is folded in by the caller).
function acousticMetrics(pts: { t: number; mean: number; hour: number }[]) {
  pts.sort((a, b) => a.t - b.t);
  let bouts = 0, disruptMin = 0, run = 0;
  let overSum = 0, predawnTotal = 0, predawnDisrupt = 0;
  for (const s of pts) {
    const disrupt = s.mean > DISRUPT_DB;
    if (disrupt) { run++; disruptMin++; overSum += s.mean - DISRUPT_DB; }
    else { if (run >= BOUT_MIN) bouts++; run = 0; }
    if (s.hour >= 3 && s.hour < 5) { predawnTotal++; if (disrupt) predawnDisrupt++; }
  }
  if (run >= BOUT_MIN) bouts++;
  const severity = disruptMin ? overSum / disruptMin : 0;
  const predawn = predawnTotal ? predawnDisrupt / predawnTotal : 0;
  return { disruptMin, bouts, severity, predawn, points: pts.length };
}

// Mean THI over a night's climate samples (needs both temp and RH). Sensor-fault readings (e.g. the
// AM308's 6553.5 °C) are rejected, so a bad probe can't fabricate a heat penalty. Null if no valid
// coverage.
function nightThi(pts: ClimateSample[]): number | null {
  let sum = 0, n = 0;
  for (const c of pts) {
    if (c.temp == null || c.rh == null || !plausibleClimate(c.temp, c.rh)) continue;
    sum += thi(c.temp, c.rh); n++;
  }
  return n ? sum / n : null;
}

// Hours of darkness over the dusk→dawn scan: fraction of readings at Level 0 (dark) × the span the
// readings actually cover (capped at the 13 h window). Null if there isn't enough light coverage to
// judge. Layers need enough dark to rest — this measures whether they got it.
function nightDarkness(pts: ClimateSample[]): number | null {
  const lit = pts.filter((c) => c.light != null && Number.isFinite(c.light));
  if (lit.length < DARK_MIN_SAMPLES) return null;
  const ts = lit.map((c) => c.t).sort((a, b) => a - b);
  const spanH = (ts[ts.length - 1] - ts[0]) / 3_600_000;
  const windowH = DARK_END_SAST + (24 - DARK_START_SAST); // 18:00→07:00 = 13 h
  const darkFrac = lit.filter((c) => (c.light as number) <= DARK_MAX_LEVEL).length / lit.length;
  return darkFrac * Math.min(spanH, windowH);
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** Score each night in the series, oldest → newest. Nights with too few acoustic points are skipped.
 *  `climate` is optional — without it the heat factor is simply zero. */
export function nightScores(samples: NoiseSample[], climate: ClimateSample[] = []): NightScore[] {
  // Group acoustic samples by night.
  const noiseByNight = new Map<string, { t: number; mean: number; hour: number }[]>();
  for (const s of samples) {
    if (s.mean == null || !Number.isFinite(s.t)) continue;
    const key = nightKey(s.t);
    if (!key) continue;
    let arr = noiseByNight.get(key);
    if (!arr) { arr = []; noiseByNight.set(key, arr); }
    arr.push({ t: s.t, mean: s.mean, hour: new Date(s.t + SAST_OFFSET_MS).getUTCHours() });
  }

  // Group climate samples by night — the 20:00–05:00 window for heat, plus the wider 18:00–07:00
  // dusk→dawn window for the darkness measure.
  const climateByNight = new Map<string, ClimateSample[]>();
  const darkByNight = new Map<string, ClimateSample[]>();
  for (const c of climate) {
    if (!Number.isFinite(c.t)) continue;
    const nk = nightKey(c.t);
    if (nk) { (climateByNight.get(nk) ?? climateByNight.set(nk, []).get(nk)!).push(c); }
    const dk = darkKey(c.t);
    if (dk) { (darkByNight.get(dk) ?? darkByNight.set(dk, []).get(dk)!).push(c); }
  }

  const out: NightScore[] = [];
  for (const [date, pts] of noiseByNight) {
    if (pts.length < MIN_NIGHT_POINTS) continue;
    const m = acousticMetrics(pts);
    const tMean = nightThi(climateByNight.get(date) ?? []);
    const darknessHours = nightDarkness(darkByNight.get(date) ?? []);
    // One-sided: only a SHORTFALL below the target is penalised; extra darkness is free.
    const darkPenalty = darknessHours == null ? 0
      : Math.min(DARK_CAP, Math.max(0, DARK_TARGET_H - darknessHours) * DARK_PENALTY_PER_H);

    const breakdown: ScoreBreakdown = {
      noise: r1(2 * m.disruptMin),
      bouts: 5 * m.bouts,
      severity: r1(2 * m.severity),
      predawn: r1(25 * m.predawn),
      heat: r1(heatPenalty(tMean)),
      darkness: r1(darkPenalty),
    };
    const raw = 100 - breakdown.noise - breakdown.bouts - breakdown.severity - breakdown.predawn - breakdown.heat - breakdown.darkness;

    out.push({
      date,
      score: r1(Math.max(0, Math.min(100, raw))),
      disruptMin: m.disruptMin,
      bouts: m.bouts,
      severity: r1(m.severity),
      predawn: Math.round(m.predawn * 100) / 100,
      thi: tMean == null ? null : r1(tMean),
      thiZone: tMean == null ? null : thiZone(tMean),
      darknessHours: darknessHours == null ? null : r1(darknessHours),
      breakdown,
      points: m.points,
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
