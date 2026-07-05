import { getSheetsClient } from "@/lib/sheets";

// Effective-dated operations schedule. Stored in a "Schedule" tab in the farm's
// Google Sheet (auto-created). Each row is one DATED VERSION of an action: to
// change a schedule you add a new version with an effective date (past OR future),
// keeping full history. The "current" schedule as of any date = the latest version
// with effectiveDate <= that date, per action.

export const SCHEDULE_TAB = "Schedule";
const LAST_COL = "O"; // 15 columns A..O
const HEADER = [
  "ActionKey", "EffectiveDate", "Name", "Category", "Type", "Days", "Start", "End",
  "Recurrence", "Interval", "DayOfMonth", "Notes", "ChangedBy", "ChangedAt", "House",
];

export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Day = (typeof DAYS)[number];
export type ActionType = "onoff" | "do";
export type Recurrence = "daily" | "weekly" | "everyNDays" | "biweekly" | "monthly";

export type ScheduleVersion = {
  actionKey: string;
  effectiveDate: string; // YYYY-MM-DD (past or future)
  name: string;
  category: string;
  type: ActionType;
  days: Day[];
  start: string;
  end: string;
  recurrence: Recurrence;
  interval: number;
  dayOfMonth: number;
  notes: string;
  changedBy: string;
  changedAt: string; // ISO
  house: string; // registered house id, or "" for whole farm
};

const isIso = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const isHm = (s: string) => /^\d{2}:\d{2}$/.test(s);

function toRow(v: ScheduleVersion): (string | number)[] {
  return [
    v.actionKey, v.effectiveDate, v.name, v.category, v.type, v.days.join(","), v.start, v.end ?? "",
    v.recurrence, v.interval || "", v.dayOfMonth || "", v.notes ?? "", v.changedBy ?? "", v.changedAt ?? "", v.house ?? "",
  ];
}

function parseRow(row: string[], rowNumber: number): (ScheduleVersion & { rowNumber: number }) | null {
  const actionKey = String(row[0] ?? "").trim();
  if (!actionKey) return null;
  const rec = String(row[8] ?? "weekly");
  return {
    actionKey,
    effectiveDate: String(row[1] ?? ""),
    name: String(row[2] ?? ""),
    category: String(row[3] ?? "other"),
    type: (String(row[4] ?? "do") === "onoff" ? "onoff" : "do") as ActionType,
    days: String(row[5] ?? "").split(",").map((d) => d.trim()).filter(Boolean) as Day[],
    start: String(row[6] ?? ""),
    end: String(row[7] ?? ""),
    recurrence: (["daily", "weekly", "everyNDays", "biweekly", "monthly"].includes(rec) ? rec : "weekly") as Recurrence,
    interval: Number(row[9] ?? 0) || 0,
    dayOfMonth: Number(row[10] ?? 0) || 0,
    notes: String(row[11] ?? ""),
    changedBy: String(row[12] ?? ""),
    changedAt: String(row[13] ?? ""),
    house: String(row[14] ?? ""),
    rowNumber,
  };
}

export function normalizeVersion(payload: Partial<ScheduleVersion>, changedBy: string): ScheduleVersion {
  const name = String(payload.name ?? "").trim();
  if (!name) throw new Error("Action name is required");
  const effectiveDate = String(payload.effectiveDate ?? "").trim() || new Date().toISOString().slice(0, 10);
  if (!isIso(effectiveDate)) throw new Error("Effective date must be YYYY-MM-DD");
  const type: ActionType = payload.type === "onoff" ? "onoff" : "do";
  const recurrence = (["daily", "weekly", "everyNDays", "biweekly", "monthly"].includes(payload.recurrence as string)
    ? payload.recurrence : "weekly") as Recurrence;
  const days = (Array.isArray(payload.days) ? payload.days : []).filter((d) => (DAYS as readonly string[]).includes(d)) as Day[];
  if ((recurrence === "weekly" || recurrence === "biweekly") && days.length === 0) {
    throw new Error("Select at least one day for weekly/biweekly");
  }
  const start = String(payload.start ?? "").trim();
  if (!isHm(start)) throw new Error("Start time must be HH:MM");
  const end = String(payload.end ?? "").trim();
  if (type === "onoff" && !isHm(end)) throw new Error("On/Off actions need an end time (HH:MM)");
  const interval = Math.max(0, Math.floor(Number(payload.interval ?? 0)) || 0);
  if (recurrence === "everyNDays" && interval < 1) throw new Error("Every-N-days needs an interval of 1 or more");
  const dayOfMonth = Math.min(31, Math.max(0, Math.floor(Number(payload.dayOfMonth ?? 0)) || 0));
  if (recurrence === "monthly" && (dayOfMonth < 1 || dayOfMonth > 31)) throw new Error("Monthly needs a day of month (1–31)");
  return {
    actionKey: String(payload.actionKey ?? "").trim() || `act_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    effectiveDate,
    name,
    category: String(payload.category ?? "other").trim() || "other",
    type,
    days: recurrence === "daily" ? [...DAYS] : days,
    start,
    end: type === "onoff" ? end : "",
    recurrence,
    interval,
    dayOfMonth,
    notes: String(payload.notes ?? ""),
    changedBy,
    changedAt: new Date().toISOString(),
    house: String(payload.house ?? ""),
  };
}

async function ensureTab(spreadsheetId: string): Promise<void> {
  const sheets = await getSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" });
  const exists = meta.data.sheets?.some((s) => s.properties?.title === SCHEDULE_TAB);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ addSheet: { properties: { title: SCHEDULE_TAB } } }] } });
    await sheets.spreadsheets.values.update({ spreadsheetId, range: `${SCHEDULE_TAB}!A1:${LAST_COL}1`, valueInputOption: "RAW", requestBody: { values: [HEADER] } });
    return;
  }
  const hdr = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${SCHEDULE_TAB}!A1:${LAST_COL}1` });
  const cur = hdr.data.values?.[0] ?? [];
  if (cur.join("|") !== HEADER.join("|")) {
    await sheets.spreadsheets.values.update({ spreadsheetId, range: `${SCHEDULE_TAB}!A1:${LAST_COL}1`, valueInputOption: "RAW", requestBody: { values: [HEADER] } });
  }
}

async function tabId(spreadsheetId: string): Promise<number> {
  const sheets = await getSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" });
  const tab = meta.data.sheets?.find((s) => s.properties?.title === SCHEDULE_TAB);
  if (tab?.properties?.sheetId == null) throw new Error("Schedule tab not found");
  return tab.properties.sheetId;
}

async function listWithRows(spreadsheetId: string) {
  await ensureTab(spreadsheetId);
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${SCHEDULE_TAB}!A2:${LAST_COL}` });
  return (res.data.values ?? [])
    .map((r, i) => parseRow(r as string[], i + 2))
    .filter((v): v is ScheduleVersion & { rowNumber: number } => v != null);
}

export async function listVersions(spreadsheetId: string): Promise<ScheduleVersion[]> {
  const rows = await listWithRows(spreadsheetId);
  return rows.map(({ rowNumber: _r, ...rest }) => rest);
}

export async function addVersion(spreadsheetId: string, v: ScheduleVersion): Promise<ScheduleVersion> {
  await ensureTab(spreadsheetId);
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId, range: `${SCHEDULE_TAB}!A2:${LAST_COL}`, valueInputOption: "RAW", insertDataOption: "INSERT_ROWS",
    requestBody: { values: [toRow(v)] },
  });
  return v;
}

/** Delete one dated version, or (if effectiveDate omitted) every version of the action. */
export async function deleteVersion(spreadsheetId: string, actionKey: string, effectiveDate?: string): Promise<void> {
  const rows = await listWithRows(spreadsheetId);
  const targets = rows
    .filter((r) => r.actionKey === actionKey && (!effectiveDate || r.effectiveDate === effectiveDate))
    .map((r) => r.rowNumber)
    .sort((a, b) => b - a); // delete bottom-up so indices stay valid
  if (targets.length === 0) return;
  const sheets = await getSheetsClient();
  const sheetId = await tabId(spreadsheetId);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: targets.map((rowNumber) => ({
        deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: rowNumber - 1, endIndex: rowNumber } },
      })),
    },
  });
}
