import { getSheetsClient } from "@/lib/sheets";

// Feed deliveries / silo fills — a dedicated tab with real columns (not a details
// blob), so weight, batch and nutrient spec are analyzable per silo over time.
// Every fill is a row, whether it's a new formula or the SAME formula/new batch —
// logging the batch is how batch-to-batch discrepancies get caught later.

export const FEED_TAB = "FeedDeliveries";
const LAST_COL = "S"; // 19 columns A..S
const HEADER = [
  "FeedId", "Date", "Time", "Silo", "Feed type", "Batch", "Supplier", "Weight",
  "Crude protein %", "Calcium %", "Phosphorus %", "Energy (ME)", "Fat %", "Fibre %", "Sodium %",
  "Cost", "Notes", "Logged by", "House",
];

export type FeedDelivery = {
  id: string; date: string; time: string; silo: string; feedType: string; batch: string;
  supplier: string; weight: string; protein: string; calcium: string; phosphorus: string;
  energy: string; fat: string; fibre: string; sodium: string; cost: string; notes: string; loggedBy: string;
  house: string; // registered house id, or "" for whole farm
};

const isIso = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

function toRow(f: FeedDelivery): string[] {
  return [
    f.id, f.date, f.time ?? "", f.silo, f.feedType ?? "", f.batch ?? "", f.supplier ?? "", f.weight ?? "",
    f.protein ?? "", f.calcium ?? "", f.phosphorus ?? "", f.energy ?? "", f.fat ?? "", f.fibre ?? "", f.sodium ?? "",
    f.cost ?? "", f.notes ?? "", f.loggedBy ?? "", f.house ?? "",
  ];
}

function parseRow(r: string[], rowNumber: number): (FeedDelivery & { rowNumber: number }) | null {
  const id = String(r[0] ?? "").trim();
  if (!id) return null;
  const s = (i: number) => String(r[i] ?? "");
  return {
    id, date: s(1), time: s(2), silo: s(3), feedType: s(4), batch: s(5), supplier: s(6), weight: s(7),
    protein: s(8), calcium: s(9), phosphorus: s(10), energy: s(11), fat: s(12), fibre: s(13), sodium: s(14),
    cost: s(15), notes: s(16), loggedBy: s(17), house: s(18), rowNumber,
  };
}

export function normalizeFeedDelivery(p: Partial<FeedDelivery>, loggedBy: string): FeedDelivery {
  const date = String(p.date ?? "").trim();
  if (!isIso(date)) throw new Error("Date must be YYYY-MM-DD");
  const silo = String(p.silo ?? "").trim();
  if (!silo) throw new Error("Silo is required");
  const time = String(p.time ?? "").trim();
  if (time && !/^\d{2}:\d{2}$/.test(time)) throw new Error("Time must be HH:MM");
  const str = (v: unknown) => String(v ?? "").trim();
  return {
    id: str(p.id) || `feed_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    date, time, silo,
    feedType: str(p.feedType), batch: str(p.batch), supplier: str(p.supplier), weight: str(p.weight),
    protein: str(p.protein), calcium: str(p.calcium), phosphorus: str(p.phosphorus), energy: str(p.energy),
    fat: str(p.fat), fibre: str(p.fibre), sodium: str(p.sodium), cost: str(p.cost), notes: str(p.notes), loggedBy,
    house: str(p.house),
  };
}

async function ensureTab(spreadsheetId: string): Promise<void> {
  const sheets = await getSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" });
  const exists = meta.data.sheets?.some((s) => s.properties?.title === FEED_TAB);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ addSheet: { properties: { title: FEED_TAB } } }] } });
    await sheets.spreadsheets.values.update({ spreadsheetId, range: `${FEED_TAB}!A1:${LAST_COL}1`, valueInputOption: "RAW", requestBody: { values: [HEADER] } });
    return;
  }
  const hdr = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${FEED_TAB}!A1:${LAST_COL}1` });
  if ((hdr.data.values?.[0] ?? []).join("|") !== HEADER.join("|")) {
    await sheets.spreadsheets.values.update({ spreadsheetId, range: `${FEED_TAB}!A1:${LAST_COL}1`, valueInputOption: "RAW", requestBody: { values: [HEADER] } });
  }
}

async function tabId(spreadsheetId: string): Promise<number> {
  const sheets = await getSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" });
  const tab = meta.data.sheets?.find((s) => s.properties?.title === FEED_TAB);
  if (tab?.properties?.sheetId == null) throw new Error("FeedDeliveries tab not found");
  return tab.properties.sheetId;
}

async function listWithRows(spreadsheetId: string) {
  await ensureTab(spreadsheetId);
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${FEED_TAB}!A2:${LAST_COL}` });
  return (res.data.values ?? [])
    .map((r, i) => parseRow(r as string[], i + 2))
    .filter((f): f is FeedDelivery & { rowNumber: number } => f != null);
}

export async function listFeedDeliveries(spreadsheetId: string): Promise<FeedDelivery[]> {
  const rows = await listWithRows(spreadsheetId);
  return rows.map(({ rowNumber: _r, ...rest }) => rest);
}

export async function addFeedDelivery(spreadsheetId: string, f: FeedDelivery): Promise<FeedDelivery> {
  await ensureTab(spreadsheetId);
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId, range: `${FEED_TAB}!A2:${LAST_COL}`, valueInputOption: "RAW", insertDataOption: "INSERT_ROWS",
    requestBody: { values: [toRow(f)] },
  });
  return f;
}

export async function deleteFeedDelivery(spreadsheetId: string, id: string): Promise<void> {
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
