// Home "attention" alerts — a small, extensible rule set that turns fetched farm state into
// color-coded alerts. Pass a caller-supplied `now` (ms) so callers never call Date.now() during a
// React render (react-hooks/purity). Add more rules over time.

export type AttentionSeverity = "info" | "warning" | "danger";
export type AttentionAlert = { id: string; severity: AttentionSeverity; title: string; detail: string };

const DAY_MS = 86_400_000;

function daysSince(dateIso: string, nowMs: number): number | null {
  const t = new Date(`${dateIso}T00:00:00Z`).getTime();
  return isNaN(t) ? null : Math.floor((nowMs - t) / DAY_MS);
}

function ago(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  return months <= 1 ? "about a month ago" : `about ${months} months ago`;
}

/** Build the Home attention list from current farm state. */
export function buildAttention(input: { lastLogDate?: string | null; now: number }): AttentionAlert[] {
  const alerts: AttentionAlert[] = [];

  // Daily-log staleness — the flock's daily production log should be filled in each day.
  // Fires once the log is >2 days behind (warning), escalating past a week (danger).
  const d = input.lastLogDate ? daysSince(input.lastLogDate, input.now) : null;
  if (!input.lastLogDate || d == null) {
    alerts.push({
      id: "daily-log",
      severity: "warning",
      title: "No daily log found",
      detail: "No egg / daily-log entries yet — start logging daily production so tracking stays accurate.",
    });
  } else if (d > 2) {
    alerts.push({
      id: "daily-log",
      severity: d > 7 ? "danger" : "warning",
      title: "Daily log not up to date",
      detail: `Last daily log was ${ago(d)} (${input.lastLogDate}). Fill in the daily log so production and HDEP stay accurate.`,
    });
  }

  // Schedules — standing reminder for now; becomes a real trigger later (e.g. no change in N days).
  alerts.push({
    id: "schedules",
    severity: "info",
    title: "Check schedules are up to date",
    detail: "Confirm lighting, feed and fan schedules match the current flock age and season.",
  });

  return alerts;
}
