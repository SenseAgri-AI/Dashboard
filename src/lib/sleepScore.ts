// Flock Night-Rest Score — the validated sleep score from the night acoustics + experienced heat.
// Full logic + rationale: docs/flock-night-rest-score.md (validation notebook: analysis/night_rest_score).
// Built on the ABSOLUTE night-noise level: a restful night stays quiet; a poor night has loud
// disruptions (the flock erupting) in the dark period. Quiet/fan nights score 100 (correct); real
// disturbances rank low. Heat (THI) is a separate factor — it suppresses sleep (esp. REM) even when
// the birds are not loud, so it captures a dimension the mic can't hear. Pure — the route supplies the
// noise + climate series.

import { thi, thiZone, heatPenalty, plausibleClimate, type ThiZone } from "./thi";

export const NIGHT_START_SAST = 20;   // dark period 20:00–05:00 SAST
export const NIGHT_END_SAST = 5;
export const DISRUPT_DB = -32;        // mean above this = a loud disruption
export const BOUT_MIN = 2;            // minutes to count as a disruption bout
const SAST_OFFSET_MS = 2 * 3_600_000;
const MIN_NIGHT_POINTS = 120;         // skip nights with too little coverage to score fairly

export type NoiseSample = { t: number; mean: number | null };              // t = ms epoch (UTC)
export type ClimateSample = { t: number; temp: number | null; rh: number | null }; // t = ms epoch (UTC)

// Points removed from 100 by each factor (before the 0-floor). Surfaced on the dashboard breakdown.
export type ScoreBreakdown = { noise: number; bouts: number; severity: number; predawn: number; heat: number };

export type NightScore = {
  date: string;        // YYYY-MM-DD — the evening the night starts
  score: number;       // 0–100 (100 = undisturbed)
  disruptMin: number;
  bouts: number;
  severity: number;    // avg dB above the disruption line
  predawn: number;     // fraction of the final 2 h disrupted (red-mite window)
  thi: number | null;  // mean experienced-heat over the dark period (null if no climate coverage)
  thiZone: ThiZone | null;
  breakdown: ScoreBreakdown;
  points: number;      // acoustic samples that scored the night
};

// A night is labelled by the evening it starts (subtract the night-start hours, take the date).
function nightKey(tMs: number): string | null {
  const h = new Date(tMs + SAST_OFFSET_MS).getUTCHours();
  if (!(h >= NIGHT_START_SAST || h < NIGHT_END_SAST)) return null;
  return new Date(tMs + SAST_OFFSET_MS - NIGHT_START_SAST * 3_600_000).toISOString().slice(0, 10);
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

  // Group climate samples by the same night key.
  const climateByNight = new Map<string, ClimateSample[]>();
  for (const c of climate) {
    if (!Number.isFinite(c.t)) continue;
    const key = nightKey(c.t);
    if (!key) continue;
    let arr = climateByNight.get(key);
    if (!arr) { arr = []; climateByNight.set(key, arr); }
    arr.push(c);
  }

  const out: NightScore[] = [];
  for (const [date, pts] of noiseByNight) {
    if (pts.length < MIN_NIGHT_POINTS) continue;
    const m = acousticMetrics(pts);
    const tMean = nightThi(climateByNight.get(date) ?? []);

    const breakdown: ScoreBreakdown = {
      noise: r1(2 * m.disruptMin),
      bouts: 5 * m.bouts,
      severity: r1(2 * m.severity),
      predawn: r1(25 * m.predawn),
      heat: r1(heatPenalty(tMean)),
    };
    const raw = 100 - breakdown.noise - breakdown.bouts - breakdown.severity - breakdown.predawn - breakdown.heat;

    out.push({
      date,
      score: r1(Math.max(0, Math.min(100, raw))),
      disruptMin: m.disruptMin,
      bouts: m.bouts,
      severity: r1(m.severity),
      predawn: Math.round(m.predawn * 100) / 100,
      thi: tMean == null ? null : r1(tMean),
      thiZone: tMean == null ? null : thiZone(tMean),
      breakdown,
      points: m.points,
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
