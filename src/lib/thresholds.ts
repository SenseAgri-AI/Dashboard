export type MetricStatus = "normal" | "warning" | "danger";

export function tempStatus(val: number | null): MetricStatus {
  if (val === null) return "normal";
  if (val > 30 || val < 12) return "danger";
  if (val > 26 || val < 16) return "warning";
  return "normal";
}

export function humidityStatus(val: number | null): MetricStatus {
  if (val === null) return "normal";
  if (val < 40 || val > 85) return "danger";
  if (val < 50 || val > 75) return "warning";
  return "normal";
}

export function co2Status(val: number | null): MetricStatus {
  if (val === null) return "normal";
  if (val > 1400) return "danger";
  if (val > 800) return "warning";
  return "normal";
}

export function computeHealth(
  temp: number | null,
  humidity: number | null,
  co2: number | null
): number {
  let score = 100;

  const ts = tempStatus(temp);
  if (ts === "danger") score -= 20;
  else if (ts === "warning") score -= 10;

  const hs = humidityStatus(humidity);
  if (hs === "danger") score -= 20;
  else if (hs === "warning") score -= 10;

  const cs = co2Status(co2);
  if (cs === "danger") score -= 25;
  else if (cs === "warning") score -= 10;

  return Math.max(0, Math.min(100, score));
}

export function healthLabel(score: number): "good" | "normal" | "warning" | "danger" {
  if (score >= 80) return "good";
  if (score >= 60) return "normal";
  if (score >= 35) return "warning";
  return "danger";
}

export function healthWord(score: number): string {
  if (score >= 80) return "Good";
  if (score >= 60) return "Normal";
  if (score >= 35) return "Warning";
  return "Critical";
}

// Saturation vapour pressure (kPa) via Buck equation
export function satVP(tempC: number): number {
  return 0.6108 * Math.exp((17.27 * tempC) / (tempC + 237.3));
}

// Vapour pressure deficit (kPa)
export function vpd(tempC: number, rh: number): number {
  return satVP(tempC) * (1 - rh / 100);
}
