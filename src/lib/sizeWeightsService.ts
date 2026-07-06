import { getSheetsClient } from "@/lib/sheets";

// Egg-size KICK WEIGHTS (the gram thresholds the grader uses to sort eggs into
// small/medium/large/XL/jumbo). Effective-dated like Prices — they drift over time,
// and the analysis needs to know which thresholds were in force when. Stored in a
// "SizeWeights" tab in the farm's Google Sheet (auto-created).

export const SIZE_WEIGHTS_TAB = "SizeWeights";
const LAST_COL = "F"; // 6 columns A..F
const HEADER = ["Effective Date", "Small", "Medium", "Large", "XL", "Jumbo"];

export type SizeWeightSet = {
  effectiveDate: string; // YYYY-MM-DD
  small: number;
  medium: number;
  large: number;
  xl: number;
  jumbo: number;
};

const isIso = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function toRow(w: SizeWeightSet): (string | number)[] {
  return [w.effectiveDate, w.small, w.medium, w.large, w.xl, w.jumbo];
}

function parseRow(r: string[], rowNumber: number): (SizeWeightSet & { rowNumber: number }) | null {
  const effectiveDate = String(r[0] ?? "").trim();
  if (!isIso(effectiveDate)) return null;
  return {
    effectiveDate,
    small: num(r[1]), medium: num(r[2]), large: num(r[3]), xl: num(r[4]), jumbo: num(r[5]),
    rowNumber,
  };
}

export function normalizeSizeWeights(p: Partial<SizeWeightSet>): SizeWeightSet {
  const effectiveDate = String(p.effectiveDate ?? "").trim();
  if (!isIso(effectiveDate)) throw new Error("Effective date must be YYYY-MM-DD");
  const out: SizeWeightSet = {
    effectiveDate, small: num(p.small), medium: num(p.medium), large: num(p.large), xl: num(p.xl), jumbo: num(p.jumbo),
  };
  for (const k of ["small", "medium", "large", "xl", "jumbo"] as const) {
    if (out[k] < 0) throw new Error(`Invalid weight for ${k}`);
  }
  return out;
}

async function ensureTab(spreadsheetId: string): Promise<void> {
  const sheets = await getSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" });
  const exists = meta.data.sheets?.some((s) => s.properties?.title === SIZE_WEIGHTS_TAB);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ addSheet: { properties: { title: SIZE_WEIGHTS_TAB } } }] } });
    await sheets.spreadsheets.values.update({ spreadsheetId, range: `${SIZE_WEIGHTS_TAB}!A1:${LAST_COL}1`, valueInputOption: "RAW", requestBody: { values: [HEADER] } });
    return;
  }
  const hdr = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${SIZE_WEIGHTS_TAB}!A1:${LAST_COL}1` });
  if ((hdr.data.values?.[0] ?? []).join("|") !== HEADER.join("|")) {
    await sheets.spreadsheets.values.update({ spreadsheetId, range: `${SIZE_WEIGHTS_TAB}!A1:${LAST_COL}1`, valueInputOption: "RAW", requestBody: { values: [HEADER] } });
  }
}

async function tabId(spreadsheetId: string): Promise<number> {
  const sheets = await getSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" });
  const tab = meta.data.sheets?.find((s) => s.properties?.title === SIZE_WEIGHTS_TAB);
  if (tab?.properties?.sheetId == null) throw new Error("SizeWeights tab not found");
  return tab.properties.sheetId;
}

async function listWithRows(spreadsheetId: string) {
  await ensureTab(spreadsheetId);
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${SIZE_WEIGHTS_TAB}!A2:${LAST_COL}` });
  return (res.data.values ?? [])
    .map((r, i) => parseRow(r as string[], i + 2))
    .filter((w): w is SizeWeightSet & { rowNumber: number } => w != null);
}

export async function listSizeWeights(spreadsheetId: string): Promise<SizeWeightSet[]> {
  const rows = await listWithRows(spreadsheetId);
  return rows.map(({ rowNumber: _r, ...rest }) => rest).sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
}

/** Add a new set, or overwrite the existing one with the same effective date. */
export async function upsertSizeWeights(spreadsheetId: string, w: SizeWeightSet): Promise<SizeWeightSet> {
  const rows = await listWithRows(spreadsheetId);
  const sheets = await getSheetsClient();
  const existing = rows.find((r) => r.effectiveDate === w.effectiveDate);
  if (existing) {
    await sheets.spreadsheets.values.update({ spreadsheetId, range: `${SIZE_WEIGHTS_TAB}!A${existing.rowNumber}:${LAST_COL}${existing.rowNumber}`, valueInputOption: "RAW", requestBody: { values: [toRow(w)] } });
  } else {
    await sheets.spreadsheets.values.append({ spreadsheetId, range: `${SIZE_WEIGHTS_TAB}!A2:${LAST_COL}`, valueInputOption: "RAW", insertDataOption: "INSERT_ROWS", requestBody: { values: [toRow(w)] } });
  }
  return w;
}

export async function deleteSizeWeights(spreadsheetId: string, effectiveDate: string): Promise<void> {
  const rows = await listWithRows(spreadsheetId);
  const existing = rows.find((r) => r.effectiveDate === effectiveDate);
  if (!existing) return;
  const sheets = await getSheetsClient();
  const sheetId = await tabId(spreadsheetId);
  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: existing.rowNumber - 1, endIndex: existing.rowNumber } } }] } });
}
