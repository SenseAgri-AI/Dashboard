import { getSheetsClient } from "@/lib/sheets";

// Operations schedule, stored in a "Schedule" tab in the farm's Google Sheet.
//
// Model: a SCHEDULE (e.g. "Feeder run") is identified by a stable `scheduleId` and
// evolves through dated VERSIONS. Each version is the full set of TIMES the schedule
// runs at that point — e.g. v1 = 07:00 & 15:00; later v2 = 07:00, 13:00, 17:00.
//   • The current schedule = the version with the latest effectiveDate.
//   • Older versions are the change HISTORY, so a farmer sees how he changed things.
// One ROW = one version (its whole set of times lives in the `Times` column), so
// "multiple times a day" (a set) and "history" (different dates) never get confused.

export const SCHEDULE_TAB = "Schedule";
const LAST_COL = "O"; // 15 columns A..O
const HEADER = [
  "ScheduleId", "EffectiveDate", "Name", "House", "Type",
  "Recurrence", "Interval", "DayOfMonth", "Days", "Times", "Notes", "ChangedBy", "ChangedAt",
  "RunMinutes", "EveryMinutes",
];

export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Day = (typeof DAYS)[number];
// "do" = runs at set times (feeder); "onoff" = a continuous on→off block (lights);
// "cycle" = within a window, runs for RunMinutes every EveryMinutes (fans).
export type ActionType = "onoff" | "do" | "cycle";
export type Recurrence = "daily" | "hourly" | "weekly" | "everyNDays" | "biweekly" | "monthly";
const RECURRENCES = ["daily", "hourly", "weekly", "everyNDays", "biweekly", "monthly"];

// One run-time in a version. `end` is set only for on/off blocks; "do" times have start only.
export type TimeSlot = { start: string; end: string };

export type ScheduleVersion = {
  scheduleId: string;
  effectiveDate: string; // YYYY-MM-DD — when this version took effect
  name: string;
  house: string; // registered house id, or "" for whole farm
  type: ActionType;
  recurrence: Recurrence;
  interval: number;
  dayOfMonth: number;
  days: Day[];
  times: TimeSlot[]; // "do": set of times; "onoff"/"cycle": on→off windows
  runMinutes: number; // "cycle" only — how long it runs each pulse
  everyMinutes: number; // "cycle" only — the pulse period
  notes: string;
  changedBy: string;
  changedAt: string; // ISO
};

const isIso = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const isHm = (s: string) => /^\d{2}:\d{2}$/.test(s);

// Times serialize into one cell as a comma-list: "07:00,13:00" (do) or "06:00-18:00,20:00-22:00" (on/off).
function serializeTimes(times: TimeSlot[]): string {
  return times.map((t) => (t.end ? `${t.start}-${t.end}` : t.start)).join(",");
}
function parseTimes(s: string): TimeSlot[] {
  return String(s ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const [start, end] = p.split("-");
      return { start: (start ?? "").trim(), end: (end ?? "").trim() };
    });
}

function toRow(v: ScheduleVersion): (string | number)[] {
  return [
    v.scheduleId, v.effectiveDate, v.name, v.house ?? "", v.type,
    v.recurrence, v.interval || "", v.dayOfMonth || "", v.days.join(","),
    serializeTimes(v.times), v.notes ?? "", v.changedBy ?? "", v.changedAt ?? "",
    v.runMinutes || "", v.everyMinutes || "",
  ];
}

function parseRow(row: string[], rowNumber: number): (ScheduleVersion & { rowNumber: number }) | null {
  const scheduleId = String(row[0] ?? "").trim();
  if (!scheduleId) return null;
  const rec = String(row[5] ?? "daily");
  const t = String(row[4] ?? "do");
  return {
    scheduleId,
    effectiveDate: String(row[1] ?? ""),
    name: String(row[2] ?? ""),
    house: String(row[3] ?? ""),
    type: (t === "onoff" || t === "cycle" ? t : "do") as ActionType,
    recurrence: (RECURRENCES.includes(rec) ? rec : "daily") as Recurrence,
    interval: Number(row[6] ?? 0) || 0,
    dayOfMonth: Number(row[7] ?? 0) || 0,
    days: String(row[8] ?? "").split(",").map((d) => d.trim()).filter(Boolean) as Day[],
    times: parseTimes(String(row[9] ?? "")),
    notes: String(row[10] ?? ""),
    changedBy: String(row[11] ?? ""),
    changedAt: String(row[12] ?? ""),
    runMinutes: Number(row[13] ?? 0) || 0,
    everyMinutes: Number(row[14] ?? 0) || 0,
    rowNumber,
  };
}

export function normalizeVersion(payload: Partial<ScheduleVersion>, changedBy: string): ScheduleVersion {
  const name = String(payload.name ?? "").trim();
  if (!name) throw new Error("Schedule name is required");
  const effectiveDate = String(payload.effectiveDate ?? "").trim() || new Date().toISOString().slice(0, 10);
  if (!isIso(effectiveDate)) throw new Error("Date must be YYYY-MM-DD");
  const type: ActionType = payload.type === "onoff" ? "onoff" : payload.type === "cycle" ? "cycle" : "do";
  const hasWindow = type === "onoff" || type === "cycle"; // needs an on→off window
  const recurrence = (RECURRENCES.includes(payload.recurrence as string)
    ? payload.recurrence : "daily") as Recurrence;
  const days = (Array.isArray(payload.days) ? payload.days : []).filter((d) => (DAYS as readonly string[]).includes(d)) as Day[];
  if ((recurrence === "weekly" || recurrence === "biweekly") && days.length === 0) {
    throw new Error("Select at least one day for weekly/biweekly");
  }
  const times: TimeSlot[] = (Array.isArray(payload.times) ? payload.times : [])
    .map((t) => ({ start: String(t?.start ?? "").trim(), end: String(t?.end ?? "").trim() }))
    .filter((t) => t.start);
  if (times.length === 0) throw new Error("Add at least one time");
  for (const t of times) {
    if (!isHm(t.start)) throw new Error("Times must be HH:MM");
    if (hasWindow && !isHm(t.end)) throw new Error("Add an end time (HH:MM) for every window");
    if (!hasWindow) t.end = "";
  }
  let runMinutes = Math.max(0, Math.floor(Number(payload.runMinutes ?? 0)) || 0);
  let everyMinutes = Math.max(0, Math.floor(Number(payload.everyMinutes ?? 0)) || 0);
  if (type === "cycle") {
    if (runMinutes < 1) throw new Error("A cycle needs a 'runs for' of 1 minute or more");
    if (everyMinutes < 1) throw new Error("A cycle needs an 'every' of 1 minute or more");
    if (runMinutes > everyMinutes) throw new Error("'Runs for' can't be longer than 'every'");
  } else {
    runMinutes = 0;
    everyMinutes = 0;
  }
  const interval = Math.max(0, Math.floor(Number(payload.interval ?? 0)) || 0);
  if (recurrence === "everyNDays" && interval < 1) throw new Error("Every-N-days needs an interval of 1 or more");
  if (recurrence === "hourly" && interval < 1) throw new Error("Every-N-hours needs an interval of 1 or more");
  const dayOfMonth = Math.min(31, Math.max(0, Math.floor(Number(payload.dayOfMonth ?? 0)) || 0));
  if (recurrence === "monthly" && (dayOfMonth < 1 || dayOfMonth > 31)) throw new Error("Monthly needs a day of month (1–31)");
  return {
    scheduleId: String(payload.scheduleId ?? "").trim() || `sch_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    effectiveDate,
    name,
    house: String(payload.house ?? ""),
    type,
    recurrence,
    interval,
    dayOfMonth,
    days: recurrence === "daily" || recurrence === "hourly" ? [...DAYS] : days,
    times,
    runMinutes,
    everyMinutes,
    notes: String(payload.notes ?? ""),
    changedBy,
    changedAt: new Date().toISOString(),
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
  const hdr = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${SCHEDULE_TAB}!A1:O1` });
  const cur = hdr.data.values?.[0] ?? [];
  if (cur.join("|") !== HEADER.join("|")) {
    // One-time migration off the old per-time/effective-dated layout (header began with
    // "ActionKey"): its rows can't be reinterpreted under the new set-of-times model, so
    // clear them before writing the new header. Only fires for that specific legacy header.
    if (String(cur[0] ?? "") === "ActionKey") {
      await sheets.spreadsheets.values.clear({ spreadsheetId, range: `${SCHEDULE_TAB}!A2:O` });
    }
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

/** Save a version: one row per (scheduleId, effectiveDate). A new date appends a new
 *  version (history preserved); the same date overwrites that version in place. */
export async function saveVersion(spreadsheetId: string, v: ScheduleVersion): Promise<ScheduleVersion> {
  const rows = await listWithRows(spreadsheetId);
  const sheets = await getSheetsClient();
  // Same name + house = the same schedule in the user's mind. If this is a brand-new id
  // but that name+house already exists, adopt its id so the save lands as a new VERSION of
  // that schedule (history stays unified) rather than spawning a duplicate schedule.
  if (!rows.some((r) => r.scheduleId === v.scheduleId)) {
    const sameName = rows.find((r) => r.name.trim().toLowerCase() === v.name.trim().toLowerCase() && (r.house ?? "") === (v.house ?? ""));
    if (sameName) v = { ...v, scheduleId: sameName.scheduleId };
  }
  const existing = rows.find((r) => r.scheduleId === v.scheduleId && r.effectiveDate === v.effectiveDate);
  if (existing) {
    await sheets.spreadsheets.values.update({
      spreadsheetId, range: `${SCHEDULE_TAB}!A${existing.rowNumber}:${LAST_COL}${existing.rowNumber}`,
      valueInputOption: "RAW", requestBody: { values: [toRow(v)] },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId, range: `${SCHEDULE_TAB}!A2:${LAST_COL}`, valueInputOption: "RAW", insertDataOption: "INSERT_ROWS",
      requestBody: { values: [toRow(v)] },
    });
  }
  return v;
}

/** Delete one version (scheduleId + effectiveDate), or the whole schedule (effectiveDate omitted). */
export async function deleteVersion(spreadsheetId: string, scheduleId: string, effectiveDate?: string): Promise<void> {
  const rows = await listWithRows(spreadsheetId);
  const targets = rows
    .filter((r) => r.scheduleId === scheduleId && (!effectiveDate || r.effectiveDate === effectiveDate))
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
