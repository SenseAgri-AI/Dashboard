import { google, sheets_v4 } from "googleapis";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";

let cachedAuth: InstanceType<typeof google.auth.GoogleAuth> | null = null;
let authFetchedAt = 0;
const AUTH_TTL_MS = 60 * 60 * 1000;

async function getServiceAccountKey(): Promise<object> {
  const ssm = new SSMClient({ region: process.env.AWS_REGION ?? "af-south-1" });
  const cmd = new GetParameterCommand({
    Name: "/senseagri/dev/google/service-account",
    WithDecryption: true,
  });
  const res = await ssm.send(cmd);
  const raw = res.Parameter?.Value;
  if (!raw) throw new Error("Google service account not found in SSM");
  return JSON.parse(raw);
}

async function getAuth(): Promise<InstanceType<typeof google.auth.GoogleAuth>> {
  if (cachedAuth && Date.now() - authFetchedAt < AUTH_TTL_MS) return cachedAuth;
  const credentials = await getServiceAccountKey();
  const auth = new google.auth.GoogleAuth({
    credentials,
    // Read-write: the dashboard reads production data, the Farm Logs section writes entries.
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  cachedAuth = auth;
  authFetchedAt = Date.now();
  return auth;
}

/** Authorized Sheets v4 client (read-write). */
export async function getSheetsClient(): Promise<sheets_v4.Sheets> {
  const auth = await getAuth();
  return google.sheets({ version: "v4", auth });
}

export async function getSheetValues(spreadsheetId: string, range: string): Promise<string[][]> {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  return (res.data.values as string[][]) ?? [];
}
