import { InfluxDBClient } from "@influxdata/influxdb3-client";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";

let cachedToken: string | null = null;
let tokenFetchedAt = 0;
const TOKEN_TTL_MS = 60 * 60 * 1000; // re-fetch token every hour

async function getInfluxToken(): Promise<string> {
  if (cachedToken && Date.now() - tokenFetchedAt < TOKEN_TTL_MS) {
    return cachedToken;
  }
  const ssm = new SSMClient({ region: process.env.AWS_REGION ?? "af-south-1" });
  const cmd = new GetParameterCommand({
    Name: "/senseagri/dev/influxdb/token",
    WithDecryption: true,
  });
  const res = await ssm.send(cmd);
  const token = res.Parameter?.Value;
  if (!token) throw new Error("InfluxDB token not found in SSM");
  cachedToken = token;
  tokenFetchedAt = Date.now();
  return token;
}

export async function getInfluxClient(): Promise<InfluxDBClient> {
  const token = await getInfluxToken();
  return new InfluxDBClient({
    host: process.env.INFLUXDB_URL ?? "https://us-east-1-1.aws.cloud2.influxdata.com",
    token,
  });
}

export const BUCKET = process.env.INFLUXDB_BUCKET ?? "senseagri-telemetry";
export const FARM_ID = "farm_anike_001";

export async function queryInflux<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const client = await getInfluxClient();
  const rows: T[] = [];
  try {
    for await (const row of client.query(sql, BUCKET)) {
      rows.push(row as T);
    }
  } finally {
    await client.close();
  }
  return rows;
}
