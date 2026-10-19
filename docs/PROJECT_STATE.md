# Project state

Last reviewed: 2026-10-19.

This is a durable orientation page, not a substitute for `git status`, the current branch, or deployed-service checks.

## Current architecture

- The Dashboard is a Next.js farm portal.
- Recent telemetry is read from InfluxDB.
- Deep historical analytics is read from Athena silver tables in S3.
- Manual production data comes from the farm's DailyLog Google Sheet and its silver-layer derivatives.
- Authentication and farm scoping use Clerk organization membership.
- The separate `senseagri-platform` repository owns ingestion, AWS infrastructure, device registration, and silver-layer production.

## Known working areas

- Home, dashboard, farm logs, schedules, analytics, flock-vet, and egg-counting views exist.
- Analytics supports deep history and chart zooming. Visible y-axis scaling should follow the visible x-range.
- Push subscriptions exist. Notification subscriptions must remain tied to an authenticated user and farm. WhatsApp is not a live channel (see the alert bullet below).
- The dashboard reads individual water meters from `meters_hourly` and derives the displayed total from the available per-meter columns. `water_litres` and `feed_kg` on `aligned_hourly` are null by design; feed in `meters_hourly` is pulses, not kilograms (`src/lib/silverSource.ts`).
- Silo cards and a radar-distance history chart exist. Their current calibration remains application behavior until a separately approved change replaces it.
- Egg counting reads InfluxDB `egg_count` per camera (`src/lib/eggCountSource.ts`). Both cameras point at the egg belts, one per A-frame, and `/api/egg-count` adds the counts (`totals.combined`). No camera faces the manure belt. Confirmed by the owner on 2026-10-19.
- Alert rules run in the senseagri-platform hourly notifier, which writes DynamoDB `senseagri-dev-alerts` (override: `ALERTS_TABLE`). The dashboard reads that table. `src/lib/alerts.ts` only maps a stored row (`storedAlert`). If the farm has no notifier heartbeat and `ALERTS_REQUIRE_SHARED` is not `true`, `/api/alerts` falls back to `src/lib/legacyAlertReader.ts`. Push delivery is `src/lib/push.ts`. WhatsApp is planned and is not a live channel.
- The AM308 climate fields the dashboard reads do not include ammonia. There is no ammonia sensor in the ingested schema (`docs/sensors.md`).

## Approved research awaiting product implementation

- Water-meter deviation alerts are documented in `calculations/water-deviation-alerts.md`. The dashboard fallback does not evaluate them (`src/lib/legacyAlertReader.ts`). Their presence in this document does not mean they are deployed.
- Weekly silo-based feed conversion is documented in `calculations/feed-conversion-ratio.md`. Required inputs and calibration are not yet validated, so it must not be shown as a measured FCR.
- When silo feed enters the funnel region, the desired future UI is to show **Running low** without a percentage. This was discussed but is not implemented in the current clean code.

## Documentation map

`docs/` plus the code paths above are the source of truth for current behavior. Root handovers (`DATA_ACCESS.md`, `SCIENCE_TEAM_HANDOVER.md`, `SILVER_LAYER_SPEC.md`, `alerts-spec.md`) point here when they used to disagree. July 2026 row counts, plateau levels, and Prophet scores stay labelled as the 2026-07-10 snapshot.

## Updating this file

Update this page after a feature is merged or a major data assumption is verified. Do not record temporary branches, local ports, secrets, or unmerged experiments as current behavior.
