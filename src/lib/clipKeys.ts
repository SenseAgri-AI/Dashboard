// Clip-key scoping shared by the clip routes. Kept free of imports so it can be unit-tested.

const CLIP_FARM_ID_RE = /^[A-Za-z0-9_-]+$/;

/**
 * True when `key` sits directly under `<prefix>farm_id=<farmId>/` (the layout the edge service writes,
 * e.g. events/audio/farm_id=<farm>/house_id=<house>/…), optionally with a required file extension.
 */
export function isKeyUnderFarm(prefix: string, farmId: string, key: string, ext?: string): boolean {
  if (typeof key !== "string" || !CLIP_FARM_ID_RE.test(farmId)) return false;
  if (!key.startsWith(`${prefix}farm_id=${farmId}/`)) return false;
  if (key.split("/").some((seg) => seg === ".." || seg === ".")) return false;
  return ext ? key.endsWith(ext) : true;
}
