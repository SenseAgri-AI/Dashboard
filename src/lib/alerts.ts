// Alert rules — the new alert set (see alerts-spec.md). Each rule is a pure function that turns
// already-fetched farm state into an Alert (or null). Data fetching lives in the API route; keeping
// the rules pure makes them easy to reason about and to hand over to the platform later.

export type AlertSeverity = "info" | "warning" | "danger";

export type Alert = {
  id: string;          // rule id, e.g. "power_outage"
  category: string;    // "power" | "climate" | "welfare" | ...
  severity: AlertSeverity;
  title: string;       // short label
  message: string;     // the worded action
  since: string | null; // last-seen / detected time (ISO), for display
  clipKey?: string | null; // S3 audio clip key to play (night-disturbance etc.)
};

/** Minutes without a data point before a feed counts as "down". Feeds report ~1/min, so a
 *  multi-minute gap is abnormal. Tune against real behaviour. */
export const FEED_STALE_MIN = 15;

function humanGap(ms: number): string {
  if (!Number.isFinite(ms)) return "a while";
  const m = Math.round(ms / 60_000);
  if (m < 90) return `${m} min`;
  const h = Math.round(m / 60);
  return h === 1 ? "about an hour" : `about ${h} hours`;
}
const iso = (ms: number | null) => (ms == null ? null : new Date(ms).toISOString());

// ── Power / connectivity ──────────────────────────────────────────────────────
// Two independent feeds come off the shed: climate sensors (gateway side, InfluxDB `sensors`) and
// the acoustics/mic (Jetson, InfluxDB `audio_noise`), each ~1 point/min.
//  • both silent  → whole site is dark → power outage / network down (danger)
//  • only Jetson silent (climate fine) → the Jetson is probably unplugged → plug it back in (warning)
//  • only climate silent (Jetson fine) → gateway / sensor device fault (warning)
export function powerOutageAlert(input: {
  climateLastSeenMs: number | null;  // last `sensors` point, or null if none in the lookback
  acousticLastSeenMs: number | null; // last `audio_noise` point, or null if none
  now: number;
  staleMinutes?: number;
}): Alert | null {
  const staleMs = (input.staleMinutes ?? FEED_STALE_MIN) * 60_000;
  const climateAge = input.climateLastSeenMs == null ? Infinity : input.now - input.climateLastSeenMs;
  const acousticAge = input.acousticLastSeenMs == null ? Infinity : input.now - input.acousticLastSeenMs;
  const climateDown = climateAge > staleMs;
  const acousticDown = acousticAge > staleMs;

  if (climateDown && acousticDown) {
    return {
      id: "power_outage",
      category: "power",
      severity: "danger",
      title: "Power / network down",
      message: `No data from the climate sensors or the mic for ${humanGap(Math.min(climateAge, acousticAge))} — likely a power outage or the network is down. Ventilation may be off — check the shed and power now.`,
      since: iso(input.climateLastSeenMs ?? input.acousticLastSeenMs),
    };
  }
  if (acousticDown) {
    return {
      id: "acoustics_offline",
      category: "power",
      severity: "warning",
      title: "Acoustics offline",
      message: `The acoustics device (Jetson) has sent no data for ${humanGap(acousticAge)}, but the climate sensors are fine — it's probably unplugged. Plug it back in.`,
      since: iso(input.acousticLastSeenMs),
    };
  }
  if (climateDown) {
    return {
      id: "climate_offline",
      category: "power",
      severity: "warning",
      title: "Climate sensors offline",
      message: `The climate sensors have sent no data for ${humanGap(climateAge)}, but the mic is fine — check the gateway / sensor device.`,
      since: iso(input.climateLastSeenMs),
    };
  }
  return null;
}

// ── Reminders ─────────────────────────────────────────────────────────────────
const DAY_MS = 86_400_000;
function daysSince(dateIso: string, nowMs: number): number | null {
  const t = Date.parse(`${dateIso}T00:00:00Z`);
  return Number.isFinite(t) ? Math.floor((nowMs - t) / DAY_MS) : null;
}

/** Days without a daily-log entry before we nudge the farmer. */
export const LOG_OVERDUE_DAYS = 5;

// The daily log (eggs + mortality) should be filled every day. Fires when the last entry is MORE than
// LOG_OVERDUE_DAYS days old, or when there are no entries at all.
export function logsOverdueAlert(input: { lastLogDate: string | null; now: number; overdueDays?: number }): Alert | null {
  const limit = input.overdueDays ?? LOG_OVERDUE_DAYS;
  if (!input.lastLogDate) {
    return {
      id: "logs_overdue",
      category: "reminder",
      severity: "warning",
      title: "Fill in the daily log",
      message: "No daily-log entries found — start logging eggs and mortality each day so production tracking stays accurate.",
      since: null,
    };
  }
  const days = daysSince(input.lastLogDate, input.now);
  if (days == null || days <= limit) return null; // "more than N days"
  return {
    id: "logs_overdue",
    category: "reminder",
    severity: "warning",
    title: "Fill in the daily log",
    message: `The daily log hasn't been filled in for ${days} days (last entry ${input.lastLogDate}). Log today's eggs and mortality so production and HDEP stay accurate.`,
    since: `${input.lastLogDate}T00:00:00.000Z`,
  };
}

// ── Welfare: night disturbance ────────────────────────────────────────────────
// Validated by ear on real clips: use the MEAN (how much of the flock is vocalising), not the peak —
// a single loud bang spikes the peak but barely moves the mean. Quiet-night baseline ~−38 dBFS; a real
// disturbance jumps the mean ~9 dB (to ~−29) and HOLDS. −32 sits cleanly between. An absolute mean
// threshold also sidesteps the per-night fan-count variation (per-night baselines were too unstable).
export const NIGHT_START_SAST = 20;   // hours (SAST)
export const NIGHT_END_SAST = 5;
export const NIGHT_NOISE_DB = -32;    // noise_db_mean above this = elevated
export const NIGHT_MIN_MINUTES = 2;   // sustained for at least this long
const SAST_OFFSET_MS = 2 * 3_600_000;

export type NoisePoint = { t: number; mean: number | null }; // t = ms epoch (UTC)

function isNightSast(tMs: number): boolean {
  const h = new Date(tMs + SAST_OFFSET_MS).getUTCHours();
  return h >= NIGHT_START_SAST || h < NIGHT_END_SAST;
}

/** Detect a sustained night-time rise in the mean flock-noise level. Returns the most recent
 *  qualifying event (with `eventStartMs` for clip lookup), or null. Pure — the route supplies the
 *  recent noise series and later attaches the clip. */
export function nightDisturbanceAlert(input: {
  series: NoisePoint[]; now: number; thresholdDb?: number; minMinutes?: number;
}): (Alert & { eventStartMs: number }) | null {
  const thr = input.thresholdDb ?? NIGHT_NOISE_DB;
  const minMs = (input.minMinutes ?? NIGHT_MIN_MINUTES) * 60_000;
  const pts = input.series
    .filter((p): p is { t: number; mean: number } => p.mean != null && Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);

  // Runs of consecutive night points above threshold.
  const runs: { t: number; mean: number }[][] = [];
  let cur: { t: number; mean: number }[] = [];
  for (const p of pts) {
    if (isNightSast(p.t) && p.mean > thr) cur.push(p);
    else { if (cur.length) runs.push(cur); cur = []; }
  }
  if (cur.length) runs.push(cur);

  const qualifying = runs
    .map((r) => ({ start: r[0].t, end: r[r.length - 1].t, peak: Math.max(...r.map((x) => x.mean)) }))
    .filter((r) => r.end - r.start >= minMs);
  if (!qualifying.length) return null;

  const ev = qualifying.reduce((a, b) => (b.start > a.start ? b : a)); // most recent
  const durMin = Math.max(1, Math.round((ev.end - ev.start) / 60_000));
  const hhmm = new Date(ev.start + SAST_OFFSET_MS).toISOString().slice(11, 16);
  return {
    id: "night_disturbance",
    category: "welfare",
    severity: "warning",
    title: "Birds unsettled overnight",
    message: `Raised flock noise overnight around ${hhmm} for ~${durMin} min — the birds were unsettled (draught, light leak, predator?). Listen to the clip and check them.`,
    since: new Date(ev.start).toISOString(),
    eventStartMs: ev.start,
  };
}

// Poor-sleep trend: the Night-Rest Score (src/lib/sleepScore.ts, docs/flock-night-rest-score.md) low
// several nights running = a recurring overnight problem, not a one-off. Fires on `run` consecutive
// nights below `poorScore`.
export const SLEEP_POOR_SCORE = 70;   // a night below this = poor rest
export const SLEEP_BAD_RUN = 2;       // consecutive poor nights before we flag

type SleepNight = { date: string; score: number; thiZone?: string | null };

export function sleepDeclineAlert(input: { nights: SleepNight[]; poorScore?: number; run?: number }): Alert | null {
  const poor = input.poorScore ?? SLEEP_POOR_SCORE;
  const need = input.run ?? SLEEP_BAD_RUN;
  const recent = input.nights.slice(-need);
  if (recent.length < need || !recent.every((n) => n.score < poor)) return null;
  const list = recent.map((n) => Math.round(n.score)).join(", ");
  // Research puts heat as the #1 sleep disruptor — if the poor nights ran hot, name it as the cause
  // rather than the generic list (see docs/flock-night-rest-score.md → Research basis).
  const hot = recent.every((n) => n.thiZone === "severe" || n.thiZone === "extreme");
  const cause = hot
    ? "overnight heat is the likely cause (experienced heat high in the dark period) — improve night ventilation / cooling."
    : "look for a recurring cause: predator, light leak, red mite, or equipment.";
  return {
    id: "sleep_decline",
    category: "welfare",
    severity: "warning",
    title: "Poor flock sleep",
    message: `The flock's night-rest score has been low ${need} nights running (${list} /100). Persistent overnight disruption — ${cause}`,
    since: `${recent[recent.length - 1].date}T00:00:00.000Z`,
  };
}
