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
| Alert evaluations | Dashboard rules/API and platform scheduled jobs, depending on alert | Alert-specific | Both repositories | Verify the owner in each alert specification |

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

The platform registry and the hard-coded meter mapping currently disagree for some EM300 roles/enabled flags. Do not resolve that conflict by guessing. Confirm the physical installation, then update the registry and downstream documentation together.
