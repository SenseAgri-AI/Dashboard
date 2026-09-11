// Shared alert presentation contract. Rule evaluation lives in the platform notifier.
export type AlertSeverity = "info" | "warning" | "danger";
export type Alert = {
  id: string;
  category: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  since: string | null;
  clipKey?: string | null;
};

export function storedAlert(row: Record<string, unknown>): Alert | null {
  if (row.state !== "firing" || typeof row.alert_id !== "string" ||
      typeof row.title !== "string" || typeof row.message !== "string" ||
      !["info", "warning", "danger"].includes(String(row.severity))) return null;
  return {
    id: row.alert_id,
    category: typeof row.category === "string" ? row.category : "reminder",
    severity: row.severity as AlertSeverity,
    title: row.title,
    message: row.message,
    since: typeof row.since === "string" ? row.since : typeof row.first_seen === "string" ? row.first_seen : null,
    clipKey: typeof row.clip_key === "string" ? row.clip_key : null,
  };
}
