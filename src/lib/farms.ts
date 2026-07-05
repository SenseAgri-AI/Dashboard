import {
  SSMClient,
  GetParameterCommand,
  PutParameterCommand,
  GetParametersByPathCommand,
} from "@aws-sdk/client-ssm";
import { auth } from "@clerk/nextjs/server";

// Per-farm configuration. One JSON blob per client lives in AWS SSM Parameter Store
// at `/senseagri/farms/<orgSlug>/config`, mirroring how influxdb.ts / sheets.ts pull
// their secrets. New client = new SSM parameter + a Clerk org — no code change.
export interface PriceTier {
  from: string; // YYYY-MM-DD, inclusive
  small: number;
  medium: number;
  large: number;
  xl: number;
  jumbo: number;
}

export interface FarmConfig {
  /** InfluxDB `farm_id` tag value, e.g. "farm_anike_001". */
  farmId: string;
  /** Google Sheet ID backing this farm's DailyLog / Houses / Prices tabs. */
  spreadsheetId: string;
  /** Sheet range for the production daily log, e.g. "DailyLog!A:R". */
  sheetRange: string;
  waterDeviceId: string;
  feedDeviceId: string;
  /** Hens per house, e.g. { house1: 4479 }. */
  houseHens: Record<string, number>;
  priceTiers: PriceTier[];
  waterLitresPerPulse: number;
  /** Farm timezone offset from UTC in hours (SAST = 2). */
  timezoneOffset: number;
}

const TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { cfg: FarmConfig; at: number }>();

async function loadFarmConfig(slug: string): Promise<FarmConfig> {
  const cached = cache.get(slug);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.cfg;

  const ssm = new SSMClient({ region: process.env.AWS_REGION ?? "af-south-1" });
  const res = await ssm.send(
    new GetParameterCommand({
      Name: `/senseagri/farms/${slug}/config`,
      WithDecryption: true,
    })
  );
  const raw = res.Parameter?.Value;
  if (!raw) throw new FarmAccessError(`No farm config found for organization '${slug}'`);

  const cfg = JSON.parse(raw) as FarmConfig;
  cache.set(slug, { cfg, at: Date.now() });
  return cfg;
}

/** Thrown when the caller has no farm they may access. Routes map this to 403. */
export class FarmAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FarmAccessError";
  }
}

/**
 * Resolve the farm config for the currently-authenticated request, scoped to the
 * user's active Clerk organization. Throws FarmAccessError if the user is not
 * signed in or has no active org/farm.
 */
export async function getFarmForRequest(): Promise<FarmConfig> {
  const { userId, orgSlug } = await auth();
  if (!userId) throw new FarmAccessError("Not authenticated");
  if (!orgSlug) throw new FarmAccessError("No active organization for this user");
  return loadFarmConfig(orgSlug);
}

const region = () => process.env.AWS_REGION ?? "af-south-1";
const FARMS_PREFIX = "/senseagri/farms/";

/** Write (create/overwrite) a farm's config to SSM. Used by admin onboarding. */
export async function putFarmConfig(slug: string, cfg: FarmConfig): Promise<void> {
  const ssm = new SSMClient({ region: region() });
  await ssm.send(
    new PutParameterCommand({
      Name: `${FARMS_PREFIX}${slug}/config`,
      Value: JSON.stringify(cfg),
      Type: "String",
      Overwrite: true,
    })
  );
  cache.delete(slug);
}

/** List the org slugs that already have a farm config in SSM. */
export async function listConfiguredFarmSlugs(): Promise<string[]> {
  const ssm = new SSMClient({ region: region() });
  const slugs: string[] = [];
  let nextToken: string | undefined;
  do {
    const res = await ssm.send(
      new GetParametersByPathCommand({ Path: FARMS_PREFIX, Recursive: true, NextToken: nextToken })
    );
    for (const p of res.Parameters ?? []) {
      const m = p.Name?.match(/^\/senseagri\/farms\/([^/]+)\/config$/);
      if (m) slugs.push(m[1]);
    }
    nextToken = res.NextToken;
  } while (nextToken);
  return slugs;
}
