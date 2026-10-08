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

export interface ForecastDay {
  date: string;
  hped: number;
  lower: number;
  upper: number;
  standard: number;
}

export interface HpedForecast {
  generated_at: string;
  farm_id: string;
  house_id: string;
  as_of: string;
  model: { name: string; description: string; level_days: number; curve_slope_pts_per_week: number };
  next_days: ForecastDay[];
  dip_watch: {
    status: "normal" | "watch";
    message: string;
    track_record: { water_drops: number; followed_by_dip: number; base_rate_pct: number; threshold_pct: number };
  };
  outlook: ForecastDay[];
  accuracy: {
    tested_from: string;
    tested_to: string;
    forecasts_made: number;
    next_day_mae: number;
    three_day_mae: number;
    four_week_mae: number;
    benchmark: { name: string; three_day_mae: number; four_week_mae: number };
    dips: number;
    dips_bounced_back: number;
    signals_note: string;
  };
  history: { date: string; hped: number | null; standard: number; excluded: boolean }[];
  recent_dips: {
    date: string;
    hped: number;
    expected: number;
    drop_pts: number;
    days_low: number;
    bounced_back: boolean;
    next_day_hped: number | null;
    water_drop_before: boolean;
  }[];
  notes: string[];
}

const HPED_FORECAST = hpedForecastJson as unknown as HpedForecast;

/** The lay (HPED) forecast snapshot, only for the farm it was computed for. */
export function getHpedForecast(farmId: string): HpedForecast | null {
  return farmId === HPED_FORECAST.farm_id ? HPED_FORECAST : null;
}
