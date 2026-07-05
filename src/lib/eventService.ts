import { getSheetsClient } from "@/lib/sheets";

// One-off interventions / events with type-specific details. Stored in an "Events"
// tab in the farm's Google Sheet (auto-created). Deliberately does NOT duplicate
// what the Daily Log owns (mortality, egg data, daily feed type / water additive) —
// this is for discrete interventions: vaccinations, medications, feed formulation
// changes, silo deliveries, health observations, equipment, etc.

export const EVENTS_TAB = "Events";
const LAST_COL = "I"; // 9 columns A..I
const HEADER = ["EventId", "Date", "Time", "Type", "Title", "Details", "Notes", "LoggedBy", "House"];

export type FarmEvent = {
  id: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM or ""
  type: string; // vaccination | medication | water_treatment | health_obs | equipment | environmental | other
  title: string;
  details: string; // readable "Label: value; Label: value"
  notes: string;
  loggedBy: string;
  house: string; // registered house id, or "" for whole farm
};

const isIso = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

function toRow(e: FarmEvent): string[] {
  return [e.id, e.date, e.time ?? "", e.type, e.title, e.details ?? "", e.notes ?? "", e.loggedBy ?? "", e.house ?? ""];
}

function parseRow(row: string[], rowNumber: number): (FarmEvent & { rowNumber: number }) | null {
  const id = String(row[0] ?? "").trim();
  if (!id) return null;
  return {
    id,
    date: String(row[1] ?? ""),
    time: String(row[2] ?? ""),
    type: String(row[3] ?? "other"),
    title: String(row[4] ?? ""),
    details: String(row[5] ?? ""),
    notes: String(row[6] ?? ""),
    loggedBy: String(row[7] ?? ""),
    house: String(row[8] ?? ""),
    rowNumber,
  };
}

export function normalizeEvent(payload: Partial<FarmEvent>, loggedBy: string): FarmEvent {
  const date = String(payload.date ?? "").trim();
  if (!isIso(date)) throw new Error("Date must be YYYY-MM-DD");
  const type = String(payload.type ?? "other").trim() || "other";
  const title = String(payload.title ?? "").trim();
  if (!title) throw new Error("Title is required");
  const time = String(payload.time ?? "").trim();
  if (time && !/^\d{2}:\d{2}$/.test(time)) throw new Error("Time must be HH:MM");
  return {
    id: String(payload.id ?? "").trim() || `evt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    date,
    time,
    type,
    title,
    details: String(payload.details ?? ""),
    notes: String(payload.notes ?? ""),
    loggedBy,
    house: String(payload.house ?? ""),
  };
}

async function ensureTab(spreadsheetId: string): Promise<void> {
  const sheets = await getSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" });
  const exists = meta.data.sheets?.some((s) => s.properties?.title === EVENTS_TAB);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ addSheet: { properties: { title: EVENTS_TAB } } }] } });
    await sheets.spreadsheets.values.update({ spreadsheetId, range: `${EVENTS_TAB}!A1:${LAST_COL}1`, valueInputOption: "RAW", requestBody: { values: [HEADER] } });
    return;
  }
  const hdr = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${EVENTS_TAB}!A1:${LAST_COL}1` });
  if ((hdr.data.values?.[0] ?? []).join("|") !== HEADER.join("|")) {
    await sheets.spreadsheets.values.update({ spreadsheetId, range: `${EVENTS_TAB}!A1:${LAST_COL}1`, valueInputOption: "RAW", requestBody: { values: [HEADER] } });
  }
}

async function tabId(spreadsheetId: string): Promise<number> {
  const sheets = await getSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" });
  const tab = meta.data.sheets?.find((s) => s.properties?.title === EVENTS_TAB);
  if (tab?.properties?.sheetId == null) throw new Error("Events tab not found");
  return tab.properties.sheetId;
}

async function listWithRows(spreadsheetId: string) {
  await ensureTab(spreadsheetId);
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${EVENTS_TAB}!A2:${LAST_COL}` });
  return (res.data.values ?? [])
    .map((r, i) => parseRow(r as string[], i + 2))
    .filter((e): e is FarmEvent & { rowNumber: number } => e != null);
}

export async function listEvents(spreadsheetId: string): Promise<FarmEvent[]> {
  const rows = await listWithRows(spreadsheetId);
  return rows.map(({ rowNumber: _r, ...rest }) => rest);
}

export async function addEvent(spreadsheetId: string, e: FarmEvent): Promise<FarmEvent> {
  await ensureTab(spreadsheetId);
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId, range: `${EVENTS_TAB}!A2:${LAST_COL}`, valueInputOption: "RAW", insertDataOption: "INSERT_ROWS",
    requestBody: { values: [toRow(e)] },
  });
  return e;
}

export async function deleteEvent(spreadsheetId: string, id: string): Promise<void> {
  const rows = await listWithRows(spreadsheetId);
  const existing = rows.find((r) => r.id === id);
  if (!existing) return;
  const sheets = await getSheetsClient();
  const sheetId = await tabId(spreadsheetId);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: existing.rowNumber - 1, endIndex: existing.rowNumber } } }] },
  });
}
