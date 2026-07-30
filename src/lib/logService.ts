import { getSheetsClient } from "@/lib/sheets";

// Ported (logging only) from poultry-layer-log-. Writes to the farm's existing
// Google Sheet (per-farm spreadsheetId from farm config). Fixed tab names; no
// Drive-folder / idempotent-creation / legacy-migration logic — the sheet already
// exists with the correct headers (verified against the live sheet).

export const DAILY_LOG_TAB = "DailyLog";
export const HOUSES_TAB = "Houses";
const DAILY_LAST_COL = "Q"; // 17 columns A..Q

export type Entry = {
  date: string;
  houseId: string;
  small: number;
  medium: number;
  large: number;
  xl: number;
  j: number;
  damaged: number;
  mortality: number;
  notes: string;
  avgEggWeightG: number | null;
  waterPh: number | null;
  eggYolkColor: number | null;
  avgHenWeightKg: number | null;
  waterIntakeMl: number | null;
  feedType: string;
  waterAdditives: string;
};
export type EntryWithRow = Entry & { rowNumber: number };

export type House = {
  id: string;
  name: string;
  startDate: string;
  startAgeDays: number;
  startingHens: number;
};
export type HouseWithRow = House & { rowNumber: number };

export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

// ── Validation ──────────────────────────────────────────────
const COUNT_FIELDS = ["small", "medium", "large", "xl", "j", "damaged", "mortality"] as const;
const OPTIONAL_NUM_FIELDS = ["avgEggWeightG", "waterPh", "eggYolkColor", "avgHenWeightKg", "waterIntakeMl"] as const;

function parseOptionalNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (Number.isNaN(parsed)) throw new Error("Invalid optional numeric value");
  return parsed;
}

export function normalizeEntry(payload: Partial<Entry>): Entry {
  if (!payload.date || !isIsoDate(payload.date)) {
    throw new Error("Date is required in YYYY-MM-DD format");
  }
  const houseId = String(payload.houseId ?? "").trim();
  if (!houseId) throw new Error("House is required");

  const normalized: Entry = {
    date: payload.date,
    houseId,
    small: Number(payload.small ?? 0),
    medium: Number(payload.medium ?? 0),
    large: Number(payload.large ?? 0),
    xl: Number(payload.xl ?? 0),
    j: Number(payload.j ?? 0),
    damaged: Number(payload.damaged ?? 0),
    mortality: Number(payload.mortality ?? 0),
    notes: String(payload.notes ?? ""),
    avgEggWeightG: parseOptionalNumber(payload.avgEggWeightG),
    waterPh: parseOptionalNumber(payload.waterPh),
    eggYolkColor: parseOptionalNumber(payload.eggYolkColor),
    avgHenWeightKg: parseOptionalNumber(payload.avgHenWeightKg),
    waterIntakeMl: parseOptionalNumber(payload.waterIntakeMl),
    feedType: String(payload.feedType ?? ""),
    waterAdditives: String(payload.waterAdditives ?? ""),
  };

  for (const key of COUNT_FIELDS) {
    const value = normalized[key];
    if (!Number.isInteger(value) || value < 0) throw new Error(`Invalid value for ${key}`);
  }
  for (const key of OPTIONAL_NUM_FIELDS) {
    const value = normalized[key];
    if (value == null) continue;
    if (typeof value !== "number" || Number.isNaN(value) || value < 0) {
      throw new Error(`Invalid value for ${key}`);
    }
  }
  return normalized;
}

export function normalizeHouse(payload: Partial<House>): House {
  const id = String(payload.id ?? "").trim();
  if (!id) throw new Error("House ID is required");
  if (!payload.startDate || !isIsoDate(payload.startDate)) {
    throw new Error("Start date is required in YYYY-MM-DD format");
  }
  const startAgeDays = Number(payload.startAgeDays ?? 0);
  const startingHens = Number(payload.startingHens ?? 0);
  if (!Number.isInteger(startAgeDays) || startAgeDays < 0) throw new Error("Invalid start age (days)");
  if (!Number.isInteger(startingHens) || startingHens < 0) throw new Error("Invalid starting hens");
  return {
    id,
    name: String(payload.name ?? id).trim() || id,
    startDate: payload.startDate,
    startAgeDays,
    startingHens,
  };
}

// ── Row (de)serialization ───────────────────────────────────
function entryToRow(e: Entry): Array<string | number> {
  return [
    e.date, e.houseId, e.small, e.medium, e.large, e.xl, e.j, e.damaged, e.mortality, e.notes,
    e.avgEggWeightG ?? "", e.waterPh ?? "", e.eggYolkColor ?? "", e.avgHenWeightKg ?? "",
    e.waterIntakeMl ?? "", e.feedType ?? "", e.waterAdditives ?? "",
  ];
}

function parseEntryRow(row: Array<string | number>, rowNumber: number): EntryWithRow | null {
  const date = String(row[0] ?? "").trim();
  if (!date) return null;
  const num = (v: unknown) => (v === "" || v == null ? null : Number(v));
  return {
    date,
    houseId: String(row[1] ?? "").trim() || "house1",
    small: Number(row[2] ?? 0),
    medium: Number(row[3] ?? 0),
    large: Number(row[4] ?? 0),
    xl: Number(row[5] ?? 0),
    j: Number(row[6] ?? 0),
    damaged: Number(row[7] ?? 0),
    mortality: Number(row[8] ?? 0),
    notes: String(row[9] ?? ""),
    avgEggWeightG: num(row[10]),
    waterPh: num(row[11]),
    eggYolkColor: num(row[12]),
    avgHenWeightKg: num(row[13]),
    waterIntakeMl: num(row[14]),
    feedType: String(row[15] ?? ""),
    waterAdditives: String(row[16] ?? ""),
    rowNumber,
  };
}

function houseToRow(h: House): Array<string | number> {
  return [h.id, h.name, h.startDate, h.startAgeDays, h.startingHens];
}

function parseHouseRow(row: Array<string | number>, rowNumber: number): HouseWithRow | null {
  const id = String(row[0] ?? "").trim();
  if (!id) return null;
  return {
    id,
    name: String(row[1] ?? id).trim(),
    startDate: String(row[2] ?? ""),
    startAgeDays: Number(row[3] ?? 0),
    startingHens: Number(row[4] ?? 0),
    rowNumber,
  };
}

async function getTabId(spreadsheetId: string, title: string): Promise<number> {
  const sheets = await getSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" });
  const tab = meta.data.sheets?.find((s) => s.properties?.title === title);
  if (tab?.properties?.sheetId == null) throw new Error(`Sheet tab '${title}' not found`);
  return tab.properties.sheetId;
}

// ── Entries ─────────────────────────────────────────────────
async function listEntriesWithRows(spreadsheetId: string): Promise<EntryWithRow[]> {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${DAILY_LOG_TAB}!A2:${DAILY_LAST_COL}`,
  });
  return (res.data.values ?? [])
    .map((row, i) => parseEntryRow(row as (string | number)[], i + 2))
    .filter((r): r is EntryWithRow => r != null);
}

export async function listEntries(spreadsheetId: string): Promise<EntryWithRow[]> {
  return listEntriesWithRows(spreadsheetId);
}

export async function upsertEntry(spreadsheetId: string, entry: Entry): Promise<Entry> {
  const sheets = await getSheetsClient();
  const entries = await listEntriesWithRows(spreadsheetId);
  const existing = entries.find((r) => r.date === entry.date && r.houseId === entry.houseId);

  if (existing) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${DAILY_LOG_TAB}!A${existing.rowNumber}:${DAILY_LAST_COL}${existing.rowNumber}`,
      valueInputOption: "RAW",
      requestBody: { values: [entryToRow(entry)] },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${DAILY_LOG_TAB}!A2:${DAILY_LAST_COL}`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [entryToRow(entry)] },
    });
  }
  return entry;
}

export async function deleteEntry(spreadsheetId: string, date: string, houseId: string): Promise<void> {
  const sheets = await getSheetsClient();
  const entries = await listEntriesWithRows(spreadsheetId);
  const existing = entries.find((r) => r.date === date && r.houseId === houseId);
  if (!existing) return;
  const tabId = await getTabId(spreadsheetId, DAILY_LOG_TAB);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: { sheetId: tabId, dimension: "ROWS", startIndex: existing.rowNumber - 1, endIndex: existing.rowNumber },
          },
        },
      ],
    },
  });
}

// ── Houses ──────────────────────────────────────────────────
async function listHousesWithRows(spreadsheetId: string): Promise<HouseWithRow[]> {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${HOUSES_TAB}!A2:E` });
  return (res.data.values ?? [])
    .map((row, i) => parseHouseRow(row as (string | number)[], i + 2))
    .filter((r): r is HouseWithRow => r != null);
}

export async function listHouses(spreadsheetId: string): Promise<House[]> {
  const houses = await listHousesWithRows(spreadsheetId);
  return houses.map(({ rowNumber: _rowNumber, ...rest }) => rest);
}

export async function upsertHouse(spreadsheetId: string, house: House): Promise<House> {
  const sheets = await getSheetsClient();
  const houses = await listHousesWithRows(spreadsheetId);
  const existing = houses.find((r) => r.id === house.id);
  if (existing) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${HOUSES_TAB}!A${existing.rowNumber}:E${existing.rowNumber}`,
      valueInputOption: "RAW",
      requestBody: { values: [houseToRow(house)] },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${HOUSES_TAB}!A2:E`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [houseToRow(house)] },
    });
  }
  return house;
}
