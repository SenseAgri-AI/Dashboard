# Data sources and ownership

Use this map before adding a query. Status labels mean:

- **Implemented** — present in current code.
- **Confirmed** — verified farm or device knowledge.
- **Provisional** — usable only for analysis, clearly labelled.
- **Needs verification** — conflicting or incomplete evidence.

| Data | Hot/recent source | Historical source | Producer/owner | Status |
|---|---|---|---|---|
| Climate telemetry | InfluxDB `sensors` / `AM308-1` | Athena `senseagri_silver.aligned_hourly` | Platform LNX ingestion and silver pipeline | Implemented |
| Water meters | InfluxDB `sensors` / cumulative `pulse_total` | Athena `senseagri_silver.meters_hourly` | Platform meter silver pipeline | Implemented |
| Silo radar | InfluxDB `sensors` / `EM411-RDL` | Raw S3 exists; dashboard historical contract is incomplete | Platform LNX ingestion | Implemented hot path; historical work needs verification |
| Egg production and mortality | Google DailyLog | Athena aligned silver data | Sheet ingestion/silver pipeline | Implemented |
| Push subscriptions | Application database | Same application database | Dashboard API | Implemented |
| Alert evaluations | DynamoDB `senseagri-dev-alerts` (`ALERTS_TABLE`) read by `/api/alerts` | Same table | Platform hourly notifier writes the rows. Dashboard `src/lib/alerts.ts` only maps them. Legacy fallback: `src/lib/legacyAlertReader.ts` when that farm has no notifier heartbeat and `ALERTS_REQUIRE_SHARED` is not `true` | Reader implemented. Which path is live depends on the heartbeat and the Vercel env var; this repo does not show that |

## Choosing a source

- Use InfluxDB for live/recent status and device inspection.
- Use Athena/S3 silver data for multi-month analysis and backtests.
- Treat raw S3 as the immutable evidence when diagnosing ingestion or silver transformations.
- Use the DailyLog source or its documented silver derivative for manual farm records.
- Never paste credentials into code or documentation. Existing access paths are described in `../DATA_ACCESS.md` and platform infrastructure docs.

## Canonical code references

- Dashboard silver reader: `src/lib/silverSource.ts`
- Dashboard Influx client: `src/lib/influxdb.ts`
- Current silo API: `src/app/api/silo-levels/route.ts`
- Platform meter transform: `../senseagri-platform/pipeline/meters_to_silver.py`
- Platform device registry: `../senseagri-platform/registry/devices.json`

EM300 roles were confirmed on 2026-10-29. `…1854` and `…6303` are the water meters and are in use. `…8449` and `…2271` are feed meters that are installed but unreliable and not used. The platform registry matches this (platform PR 28). The pipeline's feed columns are still produced but are unreliable. See `docs/devices/water-meters.md`.
