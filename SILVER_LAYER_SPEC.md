# Analytics Data Layer — Spec (handover to data-engineering)

Verified against the live AWS account **336814727818**, region **af-south-1**, on 2026-07-05/06.

> **What we're building now: the SILVER layer** — all raw device telemetry aligned onto a
> common **hourly** grid per house and **joined with the farm's Google-Sheet logs** (eggs, egg
> sizes, deaths, average egg weight, interventions, events, feed, schedule state). This is the
> single, easily-queryable dataset the app renders. **Gold (derived metrics — HDEP, FCR,
> trend/variance bands) is deferred** — see the last section.
>
> **Scope of sources:** raw **device sensor telemetry** (AM308 environment + EM300 pulse meters)
> + the Google-Sheet tabs. Camera/vision (`raw/events` `egg_count`) is kept for reference but
> **out of scope for the first build**.

---

## Medallion layout (buckets)

| Layer | Bucket | State today | Contents |
|---|---|---|---|
| **Raw** | `senseagri-dev-raw` | populated ✅ | Untouched ChirpStack uplink JSON + camera event JSON |
| **Bronze** | `senseagri-dev-bronze` | ~empty (11 stray raw-format test files — ignore/clear) | **Decoded, typed, deduped**: one row per valid measurement uplink, plus typed copies of each Sheet tab |
| **Silver** | `senseagri-dev-silver` | **to create** | **`aligned_hourly`** — one wide row per `farm_id, house_id, hour`, sensors resampled + sheets joined. **The app reads this.** |
| **Gold** | `senseagri-dev-gold` | later | Derived business metrics (HDEP, FCR, trend + variance) — see final section |

```
raw JSON (S3)  +  Google-Sheet tabs
        │  decode · type · dedup            (BRONZE)
        ▼
  device_readings + sheet_* tables
        │  map devEui→house · resample→hourly · join            (SILVER)
        ▼
  aligned_hourly / farm / house            ◄── Athena/Glue ──►  the app
        │  (later) HDEP, FCR, trend, variance                   (GOLD)
        ▼
  derived metric series
```

Conventions to follow: bucket names `senseagri-dev-<layer>`, **Parquet + Snappy**, **UTC**
timestamps, partition `farm_id → house_id → year → month`. Infra is **Terraform-managed**
(there's a `senseagri-dev-tfstate-…` bucket) — provision new buckets/Glue/Athena in Terraform,
not by hand, so nothing drifts from state.

---

## Raw sources (as they actually are in `senseagri-dev-raw`)

### 1. Sensor telemetry — `raw/sensor/device_type=<AM308-1|EM300-1>/date=<YYYY-MM-DD>/<uuid>.json`
ChirpStack LoRaWAN uplinks:
```jsonc
{ "ingested_at": "...", "request_id": "...",
  "payload": {
    "time": "2026-07-05T07:54:11.305+00:00",             // UTC
    "deviceInfo": { "devEui": "24e124707e424191", "deviceName": "BUILDING REAR - ...", "deviceProfileName": "AM308-868M" },
    "object": { /* decoded metrics — only present on measurement uplinks */ }
} }
```
- **AM308-1** (ambience) `object`: `temperature, humidity, co2, tvoc, pm2_5, pm10, pressure, light_level, battery, pir`.
- **EM300-1** (pulse meter) `object`: `pulse_total` (cumulative counter), `pulse_conv`, `pulse_unit_conv`, `temperature`, `humidity`, `battery`.
- **Join key = `payload.deviceInfo.devEui`.** ⚠️ **Filter out non-measurements**: many uplinks are
  network events (e.g. `"level":"WARNING"`, `UPLINK_F_CNT_RETRANSMISSION`) with **no `object`** — drop them.

### 2. Camera egg counts — `raw/events/date=<YYYY-MM-DD>/<uuid>.json` *(reference only, out of scope now)*
`payload.metrics.egg_count_delta` per frame; sum per hour later for an automated egg series.

### 3. `raw/media/…` — clip references. Not needed.

### The farm's Google-Sheet tabs (per farm; the app owns these — see DATA_ACCESS)
- **`DailyLog`** — per day, per house: eggs total, **egg sizes** (small/medium/large/XL/jumbo), **deaths/mortality**, **average egg weight**, checks. The core manual series.
- **`Houses`** — flock cycle (start date, start age, starting hens) → flock age + live-hen count.
- **`Events`** — interventions / notes, dated, with `house`.
- **`FeedDeliveries`** — silo fills + nutrients, dated, with `house`.
- **`Schedule`** — effective-dated recurring actions. Each schedule has dated **versions**; a
  version holds a **set of times** (`Times` col) + `Type` (`do`/`onoff`/`cycle`), `Recurrence`,
  and for cycles `RunMinutes`/`EveryMinutes`. Reconstruct "what was running at hour H" from the
  version in effect at H.
- **`Prices`**, **`SizeWeights`** — pricing + grader thresholds (effective-dated), for later revenue/size analysis.

### Accessing the Sheets (where + how)
- **Where** — each farm's `spreadsheetId` is in its **per-farm SSM config
  `/senseagri/farms/<slug>/config`** (same JSON blob as the `devices` map). Read it from there;
  do **not** hard-code an ID. (DATA_ACCESS.md still shows Anike's single hard-coded ID
  `1KjAr1wjfptYbE0n3qCWY_7gTVnR-XMTRy8xzRgCDpkA` — pre-multitenant, use it only as a fallback.)
- **Auth** — Google **service-account JSON in SSM `/senseagri/dev/google/service-account`**
  (region `af-south-1`). Read-only scope `https://www.googleapis.com/auth/spreadsheets.readonly`
  is enough for the pipeline. DATA_ACCESS.md §2 has a working `gspread`/Python snippet — reuse it.
- **⚠️ Sharing** — the service account only sees sheets **shared with its `client_email`**
  (the email inside the service-account JSON). If a farm's sheet 403s, it hasn't been shared —
  share it as at least Viewer. New-farm onboarding must include this step.
- **Column layouts** — DATA_ACCESS.md documents only the old `DailyLog!A:J` and is **stale**. The
  current, authoritative layouts (incl. the `house` column and the Events/Feed/Schedule/SizeWeights
  tabs) are the header constants in the app's service files: `src/lib/scheduleService.ts`,
  `eventService.ts`, `feedService.ts`, `sizeWeightsService.ts`, and the DailyLog parser in
  `src/app/api/production/route.ts`. Read tab headers dynamically rather than by fixed index.

---

## BRONZE — decode, type, dedup

Purpose: get everything out of nested JSON / Sheets into flat, typed, S3-native tables so silver
is a pure *align + join* step and the whole thing is reprocessable. Overwrite the open month each run.

- **`device_readings`** — one row per **valid measurement** uplink (drop WARNING / no-`object`).
  Columns: `dev_eui, time (UTC), device_type, temperature, humidity, co2, tvoc, pm2_5, pm10,
  pressure, light_level, battery, pir, pulse_total, pulse_conv, pulse_unit_conv`. Partition by
  `device_type / date`. **Dedup on `(dev_eui, time)`** (raw has retransmissions).
  - **`device_type` is available two ways, and they agree** — key off whichever you trust more:
    - the payload's **`deviceProfileId`** (stable UUID; `deviceProfileName` = `AM308-868M` / `EM300-DI`
      is the human label) — this is what the ingest API reads;
    - the **S3 path partition** (`…/device_type=AM308-1/…`) — the API's *normalized* label derived from
      that profile (note it re-maps, e.g. `EM300-DI` → `EM300-1`).
    - Recommended: resolve `device_type` from `deviceProfileId` via a small lookup, and **assert it
      matches the path** — a mismatch means a mis-routed raw file.
  - **Why it's essential:** metric names collide across device types — **both** AM308 and EM300 emit
    `temperature`/`humidity`, but AM308 = house air, EM300 = the meter's own body. Keep `device_type`
    (and `dev_eui`) so silver can pick the right source and never mix them (see alignment rules).
- **`sheet_daily_log`, `sheet_houses`, `sheet_events`, `sheet_feed`, `sheet_schedule`,
  `sheet_prices`, `sheet_size_weights`** — typed copies of each tab, `farm_id` stamped, refreshed each run.

> If you'd rather move fast, bronze and silver can be one job (read Sheets directly in silver).
> Keeping them split just makes reprocessing and debugging cleaner. Your call.

---

## SILVER — `aligned_hourly` (one wide row per `farm_id, house_id, hour`)
```
s3://senseagri-dev-silver/ aligned_hourly/ farm_id=<id>/ house_id=<id>/ year=<yyyy>/ month=<mm>/ part-*.parquet
```
Parquet + Snappy, **UTC**. Rewrite the open month each run; closed months immutable (app caches them).

| column group | columns | derivation |
|---|---|---|
| keys | `farm_id, house_id, bucket_start` | hour left-edge (UTC) |
| environment | `temperature, humidity, co2, tvoc, pm2_5, pm10, pressure, light_level, battery` | **mean** over the hour across the house's AM308s; `temp_min/temp_max` optional |
| meters | `water_litres, feed_kg` | per-hour **consumption** = `max(0, Δ pulse_total) × unit-per-pulse` |
| eggs (manual) | `eggs_total, eggs_small, eggs_medium, eggs_large, eggs_xl, eggs_jumbo, avg_egg_weight, mortality, deaths` | from `DailyLog` — **daily values broadcast onto that day's 24 hourly rows** |
| interventions | `event_flag, event_type, event_note, feed_delivery_flag, feed_kg_delivered` | from `Events` / `FeedDeliveries`, stamped on the hour they occurred |
| quality | `n` | sensor-reading count in the bucket |

> **Schedule-state (`lights_on`, `photoperiod_h`, `fan_state`) is intentionally NOT a silver column
> in v1** — see "Schedule-state" below. Everything above is cleanly derivable from the sheet + raw.

### Alignment rules
- **Filter by `device_type` first.** Env columns come **only from `AM308-1`** readings; meter columns
  only from `EM300-1`. This is what stops the EM300's own temperature/humidity from polluting house
  climate. Never aggregate a metric across device types.
- **Env (AM308):** resample to hour → mean; multiple AM308s in a house → mean.
- **Meters (EM300):** `pulse_total` is cumulative → consumption = `max(0, Δ)` between consecutive
  readings, summed per hour, × unit-per-pulse. Water vs feed = the device's **role** (below) — same
  `device_type`, so `role` from the devEui map is the only thing that tells them apart.
- **Daily sheet data:** broadcast the day's values onto that day's 24 hourly rows (keeps one table;
  a parallel `aligned_daily` is optional).
- **Events / feed:** stamp on the hour they occurred (these become the plot **annotations**).
- **Schedule:** **not evaluated in silver v1** — see "Schedule-state" below.
- **Gaps → `null`.** Never zero-fill or forward-fill instantaneous metrics.

### Schedule-state — expand it into a timeline, don't re-evaluate it in the ETL
A schedule is just a **calendar**: "Lights 06:00–18:00 daily", "Feeder at 07:00/13:00/17:00", "Fans
cycle 5 min every 30 min, 06:00–18:00". Like any calendar it **expands into a concrete time-series
of occurrences**, and once expanded it's plain intervals that drop onto the hour grid with a trivial
**interval → hour join**. There is no bespoke "deciphering" — the *data* is ordinary time series.

The only nuance: the `Schedule` tab stores the **compact** form (a few dated versions + `Recurrence`
+ a serialized `Times` set), because that's what's sane for a farmer to edit — not 365 rows. So
there's exactly one operation between stored and analysable: **expand the recurrence into
occurrences** — the same thing a calendar app does turning a repeat-rule into individual events. Do
that expansion **once, in the app** (which owns the model); the ETL should never re-expand it, or two
expanders drift.

**v1 (now) — skip it:**
- The pipeline skips schedule-state; silver ships with everything else (all cleanly derivable).
  **Interventions are already aligned** (`event_flag`/`event_type`/`feed_delivery_flag`) — only the
  continuous regime is deferred.
- The app renders schedule/event overlays on charts directly from the `Schedule` tab — covers the
  immediate charting need.

**v2 (science phase) — the app emits an expanded timeline, silver just joins it:**
- The app materializes a **schedule-occurrence timeline** — the expanded calendar —
  `(farm_id, house_id, schedule, type, state, start_ts, end_ts)` for the range, to an S3 export the
  pipeline reads (or a derived sheet tab / small endpoint). This is like exporting a calendar to iCal:
  concrete events, no rules.
- Silver joins those intervals onto the hour grid → `lights_on` (hour overlaps an on-interval),
  `photoperiod_h` (overlap hours/day), `fan_state` (duty within an overlapping window). A dumb
  time-join — the ETL never touches recurrence logic, and nothing can drift because only the app expands.

### ⚠️ The one required input: `devEui → (farm_id, house_id, role)`
Raw sensor JSON has **no farm/house** — only `devEui`. Supply a mapping (extend the per-farm SSM
config `/senseagri/farms/<slug>/config` with a `devices` map, so **pipeline and app share one source of truth**):
```jsonc
{ "24e124136f451854": { "farm_id": "farm_anike_001", "house_id": "house1", "role": "water_meter" },
  "24e124136f452271": { "farm_id": "farm_anike_001", "house_id": "house1", "role": "feed_meter" },
  "24e124707e424191": { "farm_id": "farm_anike_001", "house_id": "house1", "role": "env" } }
```
`role` (function) complements `device_type` (hardware, from the path): `device_type` says AM308 vs
EM300; `role` disambiguates the two same-type EM300s (water vs feed) and maps every device to its
farm + house. You need both.

---

## QUERY LAYER — Glue + Athena (this is the "easy querying" piece)

Goal: the app queries silver with plain SQL, **no crawler**, using Glue **partition projection**.

### Glue Data Catalog
- Database: **`senseagri_silver`**.
- External table **`aligned_hourly`** over `s3://senseagri-dev-silver/aligned_hourly/`, Parquet,
  with **partition projection** so partitions resolve from the S3 path without a crawler:
```sql
CREATE EXTERNAL TABLE senseagri_silver.aligned_hourly (
  bucket_start   timestamp,
  temperature double, humidity double, co2 double, tvoc double,
  pm2_5 double, pm10 double, pressure double, light_level double, battery double,
  water_litres double, feed_kg double,
  eggs_total int, eggs_small int, eggs_medium int, eggs_large int, eggs_xl int, eggs_jumbo int,
  avg_egg_weight double, mortality int, deaths int,
  event_flag boolean, event_type string, event_note string,
  feed_delivery_flag boolean, feed_kg_delivered double,
  lights_on boolean, photoperiod_h double, fan_state string,
  n int
)
PARTITIONED BY (farm_id string, house_id string, year int, month int)
STORED AS PARQUET
LOCATION 's3://senseagri-dev-silver/aligned_hourly/'
TBLPROPERTIES (
  'projection.enabled'='true',
  'projection.farm_id.type'='injected',
  'projection.house_id.type'='injected',
  'projection.year.type'='integer',  'projection.year.range'='2024,2030',
  'projection.month.type'='integer', 'projection.month.range'='1,12', 'projection.month.digits'='2',
  'storage.location.template'='s3://senseagri-dev-silver/aligned_hourly/farm_id=${farm_id}/house_id=${house_id}/year=${year}/month=${month}'
);
```
(`injected` = the query must supply `farm_id`/`house_id` in the WHERE clause — which the app always
does, since every query is farm+house scoped. Keeps projection cheap.)

### Athena
- Workgroup **`senseagri`**, query-results location `s3://senseagri-dev-athena-results/` (enforce
  in the workgroup so clients can't override), **CSV/Parquet result reuse** on for cache hits.

### Example queries
```sql
-- 90 days of temp + humidity for one house (the chart's default fetch)
SELECT bucket_start, temperature, humidity
FROM senseagri_silver.aligned_hourly
WHERE farm_id='farm_anike_001' AND house_id='house1'
  AND year=2026 AND month IN (5,6,7)
  AND bucket_start >= timestamp '2026-05-01 00:00'
ORDER BY bucket_start;

-- daily egg totals + avg weight (broadcast values → take one row per day)
SELECT date(bucket_start) d, max(eggs_total) eggs, max(avg_egg_weight) avg_wt
FROM senseagri_silver.aligned_hourly
WHERE farm_id='farm_anike_001' AND house_id='house1' AND year=2026
GROUP BY date(bucket_start) ORDER BY d;

-- water vs feed consumption per day
SELECT date(bucket_start) d, sum(water_litres) water_l, sum(feed_kg) feed_kg
FROM senseagri_silver.aligned_hourly
WHERE farm_id='farm_anike_001' AND house_id='house1' AND year=2026
GROUP BY date(bucket_start) ORDER BY d;

-- events/interventions to overlay on the plot
SELECT bucket_start, event_type, event_note
FROM senseagri_silver.aligned_hourly
WHERE farm_id='farm_anike_001' AND house_id='house1' AND event_flag AND year=2026
ORDER BY bucket_start;
```

### IAM (app / service role)
`athena:StartQueryExecution`, `athena:GetQueryExecution`, `athena:GetQueryResults`,
`glue:GetTable`/`GetPartitions` on `senseagri_silver`, `s3:GetObject` on `senseagri-dev-silver`,
`s3:GetObject`/`PutObject` on `senseagri-dev-athena-results`.

---

## Provisioning — engineer checklist (Terraform)

Infra is Terraform-managed (there's a `senseagri-dev-tfstate-…` bucket), so declare all of this in
Terraform under e.g. `terraform/silver/` and `terraform apply` — don't hand-create in the console.
Nothing here needs data to exist first: with **partition projection** the table is queryable the
moment the ETL writes its first parquet. Create in this order (later steps depend on earlier ones):

1. **S3 buckets** (`aws_s3_bucket` + versioning, SSE, block-public-access):
   - `senseagri-dev-silver` — the `aligned_hourly` parquet.
   - `senseagri-dev-athena-results` — Athena query output.
   - `senseagri-dev-gold` — create now or defer with gold; empty is fine.
   - *Lifecycle:* closed months are immutable (app caches them) — no expiry needed; optionally expire
     `senseagri-dev-athena-results/` objects after ~30 days.
2. **Glue database** (`aws_glue_catalog_database`) — `senseagri_silver`.
3. **Glue table** (`aws_glue_catalog_table`) — `aligned_hourly`, columns + partition keys + the
   **partition-projection `TBLPROPERTIES`** exactly as in the DDL above (projection means **no crawler**).
4. **Athena workgroup** (`aws_athena_workgroup`) — `senseagri`, `result_configuration` → the results
   bucket, `enforce_workgroup_configuration = true`, result reuse on.
5. **IAM policy** (`aws_iam_policy` + attach to the app/service role) — the exact statements listed
   under *IAM* above.
6. **SSM config** — extend each farm's `/senseagri/farms/<slug>/config` with the `devices` map
   (devEui → farm/house/role) so pipeline and app share one source of truth.

The ETL job (raw → bronze → silver) is separate from this — it just needs write access to the silver
bucket and reads raw + the Sheets. Provisioning above only stands up storage + the query surface.

## Reader contract (what the app calls)
Behind a data-source abstraction (`src/lib/timeseriesSource.ts`): **recent → InfluxDB**
(latest ~1 month it retains), **long-range → silver via Athena**. Historical partitions are
immutable → cache hard.
```ts
type Grain = "hourly" | "daily";
interface SeriesQuery { farmId: string; houseId?: string; metric: string; from: string; to: string; grain: Grain; }
interface SeriesPoint { time: string; value: number; min?: number; max?: number; }
fetchSilverSeries(q: SeriesQuery): Promise<SeriesPoint[]>;   // ascending, ≤ ~2k points
```
The app chart needs, from this: **date-range select**, **two metrics on two Y-axes**, **zoom/brush**,
and **schedule/event overlays** (event markers + schedule bands drawn from the `event_*` / schedule-state
columns, or straight from the `Events`/`Schedule` tabs). At single-house hourly scale a 90-day pull is
~2,160 points, so **trend + variance can be computed client-side** — no gold needed for responsiveness.

---

## GOLD — deferred (derived metrics)
Build later, when customers want standardized derived views. Candidates:
- **HDEP** = eggs_total / live-hen-count (from `Houses` cycle + cumulative mortality), vs a breed-standard curve.
- **FCR** = feed_kg / egg mass (or per dozen).
- **Trend** (rolling mean) + **variance/σ bands** for a cleaner customer view.
- Cross-farm rollups, multi-year horizons.

These are cheap to compute **in-app** over silver for one house/short range, so gold is only worth
materializing for consistency across the product or heavy/long-horizon aggregation. Same bucket
convention: `s3://senseagri-dev-gold/…`, own Glue DB `senseagri_gold`.

---

## Open questions (for data-eng)
1. **`devEui → house/role` map** — confirm contents + that it lives in the per-farm SSM config.
2. **Unit-per-pulse** — payload has `pulse_conv`/`pulse_unit_conv` (sample = 1.0), but the app uses
   water = 10 L/pulse. Reconcile the true conversion per meter.
3. **Real vs demo** — sensor uplinks carry no `farm_id`; camera events show `farm_demo_001`. Which
   devEuis/cameras are the real Anike farm?
4. **Refresh cadence** (hourly append) + **backfill** from the full raw history (~191k objects ≈ 217 MB).
5. **Bronze split** — keep bronze as a decode/dedup stage, or fold into silver? (see note above)
6. **Athena vs Lambda reader** — Athena table (above) is the default; a thin Lambda returning
   `SeriesPoint[]` is the alternative. Tell the app team the DB/table name or endpoint.
