// Experienced heat ("feels-like" temperature) for poultry, in °C. A bird cools evaporatively (by
// panting), so high humidity blocks that cooling and makes a given temperature feel hotter. This folds
// temperature + humidity into ONE effective temperature on the Celsius scale — so it reads like a
// thermometer for a metric (South African) farm, and is directly comparable to the research (which
// talks in °C). Marai et al. poultry index; zones from the poultry heat-stress literature.
// See docs/flock-night-rest-score.md → Research basis.

/** Effective ("feels-like") temperature in °C from dry-bulb temp (°C) and relative humidity (%). */
export function thi(tempC: number, rhPct: number): number {
  const rh = rhPct / 100;
  return tempC - (0.31 - 0.31 * rh) * (tempC - 14.4);
}

// Physically plausible reading bounds — the water/feed meters (EM300) leave the temperature field at
// 6553.5 °C (0xFFFF ÷ 10), which would otherwise blow up the index. Anything outside these is a bad
// reading and is ignored. (Climate should already be scoped to device_type = 'AM308-1' upstream; this
// is belt-and-suspenders.)
export const TEMP_MIN = -20, TEMP_MAX = 60;   // °C, shed conditions
export const RH_MIN = 0, RH_MAX = 100;        // %
export function plausibleClimate(tempC: number, rhPct: number): boolean {
  return Number.isFinite(tempC) && Number.isFinite(rhPct)
    && tempC >= TEMP_MIN && tempC <= TEMP_MAX && rhPct >= RH_MIN && rhPct <= RH_MAX;
}

// Laying-hen heat-stress zones on the °C effective-temperature scale (Marai poultry classification):
// comfort < 27.8 · moderate 27.8–28.8 · severe 28.9–29.9 · extreme ≥ 30. Hens stress earlier than
// broilers. All tunable.
export const THI_COMFORT = 27.8;   // below this = no heat stress
export const THI_SEVERE = 28.9;    // moderate 27.8–28.8; severe starts here
export const THI_EXTREME = 30;     // ≥ this = very severe / extreme

export type ThiZone = "comfort" | "moderate" | "severe" | "extreme";

export function thiZone(v: number): ThiZone {
  if (!Number.isFinite(v)) return "comfort";
  if (v >= THI_EXTREME) return "extreme";
  if (v >= THI_SEVERE) return "severe";
  if (v >= THI_COMFORT) return "moderate";
  return "comfort";
}

// Heat's contribution to the sleep-score penalty. Zero in the comfort zone; scales with how far the
// night's mean effective temperature sits above comfort; capped so heat can't dominate the acoustic
// disruption signal. Grounded in the finding that heat is the single biggest sleep disruptor.
// At comfort (27.8) → 0; severe (28.9) → ~7; extreme (30) → ~13; ~32 °C-eff and above → capped at 25.
export const HEAT_CAP = 25;   // max points heat can remove
export const HEAT_K = 6;      // points per °C above comfort

export function heatPenalty(thiValue: number | null): number {
  if (thiValue == null || !Number.isFinite(thiValue) || thiValue <= THI_COMFORT) return 0;
  return Math.min(HEAT_CAP, (thiValue - THI_COMFORT) * HEAT_K);
}
