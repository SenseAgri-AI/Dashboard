import warningSignsJson from "@/data/ai-demo/warning_signs.json";
import hpedForecastJson from "@/data/ai-demo/hped_forecast.json";

// ─────────────────────────────────────────────────────────────────────────────
// AI showcase snapshots for the Flock Vet panel (demo branch).
//
// The warning signs and the lay forecast are computed offline by the scripts in
// analysis/ai_demo/ and committed as dated JSON snapshots. They describe one farm
// (farm_anike_001, house1), so every reader checks the server-resolved farm id and
// returns null for any other farm. The client never chooses which snapshot it gets.
// ─────────────────────────────────────────────────────────────────────────────

export type SignStatus = "normal" | "watch" | "alert" | "unknown";
export type SignGroup = "flock" | "supply" | "environment";

export interface DaySign {
  key: string;
  status: SignStatus;
  value: number | null;
  normal_low: number | null;
  normal_high: number | null;
  message: string;
}

export interface SignInfo {
  label: string;
  unit: string;
  group: SignGroup;
  research: string;
}

export interface WarningDay {
  date: string;
  alerts: number;
  watches: number;
  meter_fault: boolean;
  house_litres: number;
  wm1_litres: number;
  wm2_litres: number;
  lights_on: string | null;
  lights_off: string | null;
  signs: DaySign[];
}

export interface FlaggedDay {
  date: string;
  status: "watch" | "alert";
  headline: string;
  reasons: { key: string; label: string; status: "watch" | "alert"; group: SignGroup; message: string }[];
}

export interface HourDetail {
  hour: number;
  wm1_l: number | null;
  wm2_l: number | null;
  temp_c: number | null;
  thi: number | null;
  light_share: number | null;
  noise_db: number | null;
}

export interface WarningSnapshot {
  generated_at: string;
  farm_id: string;
  house_id: string;
  as_of: string;
  baseline: string;
  birds_note: string;
  sign_info: Record<string, SignInfo>;
  history: WarningDay[];
  flagged_days: FlaggedDay[];
  hourly_detail: Record<string, HourDetail[]>;
  notes: string[];
}

const WARNING_SIGNS = warningSignsJson as unknown as WarningSnapshot;

/** The warning-signs snapshot, only for the farm it was computed for. */
export function getWarningSigns(farmId: string): WarningSnapshot | null {
  return farmId === WARNING_SIGNS.farm_id ? WARNING_SIGNS : null;
}

export interface ForecastDriver {
  key?: string;
  label: string;
  contribution_pts: number;
}

export interface HpedForecast {
  generated_at: string;
  farm_id: string;
  house_id: string;
  as_of: string;
  model: { name: string; description: string; target: string; regressors: { key: string; label: string; lag_days: number }[] };
  backtest: { cutoff: string; horizon_days: number; mae_pts: number; mape_pct: number; baselines: { name: string; mae_pts: number }[] };
  history: { date: string; hped: number | null; standard: number | null; fitted: number | null; week: number | null; excluded: boolean }[];
  forecast: { date: string; hped: number; lower: number; upper: number; standard: number | null; week: number | null }[];
  drivers: ForecastDriver[];
  recent_drops: { date: string; hped: number; expected: number; drop_pts: number; drivers: ForecastDriver[] }[];
  notes: string[];
}

const HPED_FORECAST = hpedForecastJson as unknown as HpedForecast;

/** The lay (HPED) forecast snapshot, only for the farm it was computed for. */
export function getHpedForecast(farmId: string): HpedForecast | null {
  return farmId === HPED_FORECAST.farm_id ? HPED_FORECAST : null;
}
