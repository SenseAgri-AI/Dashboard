# Project state

Last reviewed: 2026-09-27.

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
- Push subscriptions and farm alert delivery exist. Notification subscriptions must remain tied to an authenticated user and farm.
- The dashboard reads individual water meters from `meters_hourly` and derives the displayed total from the available per-meter columns.
- Silo cards and a radar-distance history chart exist. Their current calibration remains application behavior until a separately approved change replaces it.

## Approved research awaiting product implementation

- Water-meter deviation alerts are documented in `calculations/water-deviation-alerts.md`. Their presence in this document does not mean they are deployed.
- Weekly silo-based feed conversion is documented in `calculations/feed-conversion-ratio.md`. Required inputs and calibration are not yet validated, so it must not be shown as a measured FCR.
- When silo feed enters the funnel region, the desired future UI is to show **Running low** without a percentage. This was discussed but is not implemented in the current clean code.

## Known documentation conflict

`DATA_ACCESS.md` contains an older statement that the app reads only Water Meter 1. Current `src/lib/silverSource.ts` reads both per-meter columns and derives their total. Use the current code and `docs/devices/water-meters.md` for new work; retain the older file as historical analysis until it is fully reconciled.

## Updating this file

Update this page after a feature is merged or a major data assumption is verified. Do not record temporary branches, local ports, secrets, or unmerged experiments as current behavior.
