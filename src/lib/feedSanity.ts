// Plausibility checks for feed numbers. The only reliable feed quantity on this farm is the logged
// delivery weight (the auger pulse meters are offline and the silo radar is uncalibrated), so these
// helpers turn delivery weights into "how long did it last" and flag numbers that cannot be right.

/** Typical layer intake, grams per hen per day (commercial layer guides: ~100–125 g). PROVISIONAL:
 *  confirm against the breed guide once the breed is recorded. */
export const LAYER_INTAKE_G = { min: 100, max: 125 } as const;
/** Outside this band an intake figure is treated as a data problem (a missed or mistyped delivery),
 *  not as the birds' appetite. PROVISIONAL. */
export const PLAUSIBLE_INTAKE_G = { min: 70, max: 160 } as const;

export type ParsedWeight = { kg: number | null; issue: null | "empty" | "bags" | "unreadable" | "no-unit" };

/** Read a free-text delivery weight ("25 000 kg", "25t", "16,000", "300 bags") as kilograms.
 *  Bags are not converted unless the bag size is known, because 25 kg and 50 kg bags both exist. */
export function parseFeedWeightKg(text: string, bagKg?: number | null): ParsedWeight {
  const raw = String(text ?? "").trim().toLowerCase();
  if (!raw) return { kg: null, issue: "empty" };
  const m = raw.replace(/(\d)[\s,](?=\d{3}(?!\d))/g, "$1").match(/^(\d+(?:\.\d+)?)\s*([a-z]*)\.?$/);
  if (!m) return { kg: null, issue: "unreadable" };
  const n = Number(m[1]);
  const unit = m[2];
  if (!Number.isFinite(n) || n <= 0) return { kg: null, issue: "unreadable" };
  if (["kg", "kgs", "kilo", "kilos", "kilogram", "kilograms"].includes(unit)) return { kg: n, issue: null };
  if (["t", "ton", "tons", "tonne", "tonnes"].includes(unit)) return { kg: n * 1000, issue: null };
  if (["bag", "bags"].includes(unit)) return bagKg && bagKg > 0 ? { kg: n * bagKg, issue: null } : { kg: null, issue: "bags" };
  if (unit === "") return { kg: n, issue: "no-unit" }; // assumed kg, but the farmer should add the unit
  return { kg: null, issue: "unreadable" };
}

/** Grams per hen per day implied by `kg` lasting `days` for `hens` birds; null when it can't be computed. */
export function intakeGPerHenDay(kg: number | null, days: number, hens: number): number | null {
  if (kg == null || !(kg > 0) || !(days > 0) || !(hens > 0)) return null;
  return (kg * 1000) / hens / days;
}

export type IntakeVerdict = "normal" | "low" | "high" | "looks-wrong";

export function intakeVerdict(g: number): IntakeVerdict {
  if (g < PLAUSIBLE_INTAKE_G.min || g > PLAUSIBLE_INTAKE_G.max) return "looks-wrong";
  if (g < LAYER_INTAKE_G.min) return "low";
  if (g > LAYER_INTAKE_G.max) return "high";
  return "normal";
}

/** How many days a delivery should last at typical intake (mid-band), for the save-time check. */
export function expectedDays(kg: number, hens: number): number | null {
  if (!(kg > 0) || !(hens > 0)) return null;
  return (kg * 1000) / hens / ((LAYER_INTAKE_G.min + LAYER_INTAKE_G.max) / 2);
}

/** Save-time warning for a delivery weight, or null when it looks fine. A typo like 2 500 for 25 000,
 *  or a number of bags, shows up as a delivery that would last a few hours or half a year. */
export function deliveryWarning(text: string, hens: number, bagKg?: number | null): string | null {
  const p = parseFeedWeightKg(text, bagKg);
  if (p.issue === "empty") return null;
  if (p.issue === "bags") return "Enter the weight in kg (bag size isn't set), e.g. 300 bags × 50 kg = 15 000 kg";
  if (p.issue === "unreadable" || p.kg == null) return "Weight not understood: use kg or tonnes, e.g. 25 000 kg";
  const days = expectedDays(p.kg, hens);
  if (days != null && (days < 2 || days > 150)) {
    return `${Math.round(p.kg).toLocaleString("en-ZA")} kg would last about ${days < 1 ? "less than a day" : `${Math.round(days)} days`} for ${hens.toLocaleString("en-ZA")} hens: check the units (kg vs bags vs tonnes)`;
  }
  if (p.issue === "no-unit") return "Assumed kg: add the unit, e.g. 25 000 kg";
  return null;
}

export type DeliveryIntake = { date: string; nextDate: string; days: number; gPerHenDay: number; verdict: IntakeVerdict };

/** Intake between consecutive logged deliveries (whole farm): delivery N's kg over the days until delivery N+1.
 *  Deliveries on the same day are added together. Rows with an unreadable weight break the chain. */
export function intakeBetweenDeliveries(deliveries: { date: string; weight: string }[], hens: number, bagKg?: number | null): DeliveryIntake[] {
  const byDay = new Map<string, number | null>();
  for (const d of deliveries) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) continue;
    const kg = parseFeedWeightKg(d.weight, bagKg).kg;
    const prev = byDay.get(d.date);
    byDay.set(d.date, prev === undefined ? kg : prev == null || kg == null ? null : prev + kg);
  }
  const days = [...byDay.keys()].sort();
  const out: DeliveryIntake[] = [];
  for (let i = 0; i + 1 < days.length; i++) {
    const span = (Date.parse(`${days[i + 1]}T00:00:00Z`) - Date.parse(`${days[i]}T00:00:00Z`)) / 86_400_000;
    const g = intakeGPerHenDay(byDay.get(days[i]) ?? null, span, hens);
    if (g == null) continue;
    out.push({ date: days[i], nextDate: days[i + 1], days: span, gPerHenDay: Math.round(g), verdict: intakeVerdict(g) });
  }
  return out;
}
