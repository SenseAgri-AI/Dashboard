// Noise badge rule for loud spikes (Live dashboard acoustic card). Docs: docs/stale-data.md (Noise).
// Story: amber should mean something unusual. By day single spikes are routine (people, feeding,
// machinery), so it takes a cluster; at night the house should be quiet, so one spike counts.
// Early warning, not a diagnosis (a door or tractor sounds the same).

const HOUR_MS = 3_600_000;
/** PROVISIONAL (2 Nov): spikes in the last hour for amber by day; at night (from–to, farm-local) one is enough. */
export const SPIKE_RULES = { daySpikes: 2, nightFromH: 20, nightToH: 5 } as const;

export function spikeBadge(spikeTimes: number[], now: number, offsetHours = 2): string | null {
  const last = spikeTimes.filter((t) => t <= now && now - t < HOUR_MS);
  if (last.length >= SPIKE_RULES.daySpikes) return "Loud spikes: listen to the clips";
  const night = last.some((t) => { const h = new Date(t + offsetHours * HOUR_MS).getUTCHours(); return h >= SPIKE_RULES.nightFromH || h < SPIKE_RULES.nightToH; });
  return night ? "Loud sound at night: listen to the clip" : null;
}
