// Temperature-Humidity Index (THI) — "experienced heat" for poultry. A bird cools evaporatively (by
// panting), so high humidity blocks that cooling and makes a given temperature feel hotter. THI folds
// both into one number. Standard Thom/NRC form (T in °C, RH in %), widely used in poultry heat-stress
// work; laying-hen stress zones from the layer literature (hens stress EARLIER than broilers).
// See docs/flock-night-rest-score.md → Research basis.

export function thi(tempC: number, rhPct: number): number {
  return (1.8 * tempC + 32) - (0.55 - 0.0055 * rhPct) * (1.8 * tempC - 26);
}

// Physically plausible reading bounds — the AM308 reports a fault as 6553.5 °C (0xFFFF ÷ 10), which
// would otherwise blow up the THI. Anything outside these is treated as a sensor error and ignored.
export const TEMP_MIN = -20, TEMP_MAX = 60;   // °C, shed conditions
export const RH_MIN = 0, RH_MAX = 100;        // %
export function plausibleClimate(tempC: number, rhPct: number): boolean {
  return Number.isFinite(tempC) && Number.isFinite(rhPct)
    && tempC >= TEMP_MIN && tempC <= TEMP_MAX && rhPct >= RH_MIN && rhPct <= RH_MAX;
}

// Laying-hen zones: comfort < 70 · alert 70–75 · danger 76–81 · emergency > 81. Onset of stress ~72.
export const THI_COMFORT = 70;
export const THI_DANGER = 76;
export const THI_EMERGENCY = 82; // i.e. > 81

export type ThiZone = "comfort" | "alert" | "danger" | "emergency";

export function thiZone(v: number): ThiZone {
  if (!Number.isFinite(v)) return "comfort";
  if (v >= THI_EMERGENCY) return "emergency";
  if (v >= THI_DANGER) return "danger";
  if (v >= THI_COMFORT) return "alert";
  return "comfort";
}

// Heat's contribution to the sleep-score penalty. Zero in the comfort zone; scales with how far the
// night's mean THI sits above comfort; capped so heat can't dominate the acoustic disruption signal.
// Grounded in the finding that heat is the single biggest sleep disruptor (nearly eliminates REM).
export const HEAT_CAP = 25;   // max points heat can remove
export const HEAT_K = 2.5;    // points per THI unit above comfort

export function heatPenalty(thiValue: number | null): number {
  if (thiValue == null || !Number.isFinite(thiValue) || thiValue <= THI_COMFORT) return 0;
  return Math.min(HEAT_CAP, (thiValue - THI_COMFORT) * HEAT_K);
}
