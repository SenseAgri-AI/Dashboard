# SenseAgri — Data-Science Handover

**Audience:** the data-science team.
**Purpose:** (1) how to reach the analytics data in AWS Athena, (2) what's in it and its
gotchas, (3) a working **egg-count forecast** baseline (Meta **Prophet**) you can run and build on.

Verified live against AWS account **336814727818**, region **af-south-1**, on **2026-07-10**.

> **Snapshot banner.** Row counts, date ranges, plateau levels, outlier examples, and Prophet
> scores in this file describe that 2026-07-10 pull. They are not the table today. Re-query
> before using them. Current sources: [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) and
> [src/lib/silverSource.ts](src/lib/silverSource.ts). The producer is `senseagri-platform`.

> The July design notes are in **[SILVER_LAYER_SPEC.md](SILVER_LAYER_SPEC.md)**. Where that file
> disagrees with `docs/DATA_SOURCES.md` or `silverSource.ts`, follow those.

---

## 1. Access — Athena over the silver layer

Analysis tables are Glue/Athena tables backed by Parquet in S3. **No crawler**
(partition projection), **no database to stand up** — you query them with plain SQL.
There are two tables, not one (`src/lib/silverSource.ts`).

| Thing | Value |
|---|---|
| Region | `af-south-1` |
| Athena workgroup | `senseagri` (enforces its own results location) |
| Glue database | `senseagri_silver` |
| Environment + sheet table | `aligned_hourly` |
| Water and feed table | `meters_hourly` (`water_l_wm1`, `water_l_wm2`, `feed_pulses_auger1`, `feed_pulses_auger2`) |
| Query-results bucket | `s3://senseagri-dev-athena-results/` |
| Data bucket (read) | `s3://senseagri-dev-silver/` |

`water_litres` and `feed_kg` on `aligned_hourly` are null by design. Meter data lives in
`meters_hourly`. Feed there is pulses, not kilograms. The dashboard derives the water total
from the two per-meter columns (`fetchMetersDaily`). See
[docs/devices/water-meters.md](docs/devices/water-meters.md).

### What to ask platform/eng for
An IAM principal (SSO role or user) with these permissions — the app already runs on a policy
named **`senseagri-dev-silver-app-read`**; ask to be attached to it or given an equivalent:

- `athena:StartQueryExecution`, `athena:GetQueryExecution`, `athena:GetQueryResults`,
  `athena:GetWorkGroup`
- `glue:GetTable`, `glue:GetPartitions`, `glue:GetDatabase` on `senseagri_silver`
- `s3:GetObject`, `s3:ListBucket` on `senseagri-dev-silver`
- `s3:GetObject`, `s3:PutObject`, `s3:ListBucket` on `senseagri-dev-athena-results`
  (Athena writes each query's output there)

Then `aws configure sso` (or export keys) and confirm with `aws sts get-caller-identity`.

### Query it three ways
- **Console:** Athena → Query editor → workgroup `senseagri`, database `senseagri_silver`.
- **CLI:** `aws athena start-query-execution --work-group senseagri --query-execution-context Database=senseagri_silver --query-string "…"` then `get-query-results`.
- **Python (recommended for DS):** `pyathena` → pandas, see §4.

### Scoping rule (important)
Partitions `farm_id` and `house_id` are **injected** — every query **must** put both in the
`WHERE` clause, plus a `year` filter, or projection can't resolve the S3 path (you'll get zero rows
or a scan error). Always:

```sql
WHERE farm_id = 'farm_anike_001' AND house_id = 'house1' AND year = 2026 …
```

The example filter `farm_anike_001` / `house1` is the one used in the 2026-07-10 queries below.
The app has no global `FARM_ID` constant ([src/lib/influxdb.ts](src/lib/influxdb.ts)).
Farm id, house ids, and flock size come from that farm's SSM config
`/senseagri/farms/<slug>/config` (`farmId`, `houseHens`) via `getFarmForRequest`
([src/lib/farms.ts](src/lib/farms.ts)). This file does not state how many farms are live now,
or a current hen count.

---

## 2. The dataset — `aligned_hourly`

One wide row per **`farm_id, house_id, hour`** (UTC), sensors resampled to the hour and the farm's
Google-Sheet logs joined on. Full column list + derivation in
[SILVER_LAYER_SPEC.md](SILVER_LAYER_SPEC.md#silver--aligned_hourly-one-wide-row-per-farm_id-house_id-hour);
the ones you'll use most:

| group | columns | notes |
|---|---|---|
| keys | `bucket_start` (ts, UTC), `farm_id`, `house_id`, `year`, `month` | hour left-edge |
| environment (AM308 sensor) | `temperature, humidity, co2, tvoc, pm2_5, pm10, pressure, light_level, battery` | hourly **mean**; real intra-day variation |
| eggs (manual, DailyLog) | `eggs_total, eggs_small, eggs_medium, eggs_large, eggs_xl, eggs_jumbo, eggs_damaged, avg_egg_weight` | **daily** value broadcast onto all 24 hourly rows |
| flock (manual, DailyLog) | `mortality`/`deaths` | daily deaths |
| meters | `water_litres, feed_kg` on this table | **Null by design.** Use `meters_hourly` (see §1). Do not treat a null here as zero consumption |
| interventions | `event_flag, event_type, event_note, feed_delivery_flag, feed_kg_delivered` | stamped on the hour they occurred |
| quality | `n` | sensor-reading count in the bucket |

### Grain: sensors are hourly, sheet values are daily
Environment/PM columns carry **genuine hourly** signal. Egg/mortality/weight columns are **daily**
figures **broadcast** across that day's 24 rows — so to get a daily series, group by day and take
`max()` (or `avg()`, they're identical across the 24), **not** `sum()`:

```sql
SELECT date(bucket_start) AS d, max(eggs_total) AS eggs, max(mortality) AS deaths
FROM senseagri_silver.aligned_hourly
WHERE farm_id='farm_anike_001' AND house_id='house1' AND year IN (2025,2026)
GROUP BY date(bucket_start) ORDER BY d;
```

---

## 3. Egg data — caveats before you model

The egg columns are **manually logged** on the farm's Google Sheet, so they behave like human data,
not sensor data.

**2026-07-10 snapshot only** (274 daily rows, 2025-10-09 → 2026-07-09 in that pull). Re-query
before relying on these counts, ranges, or plateau levels:

1. **Flock lay curve.** Lay begins ~2025-10-11 and ramps over ~4 weeks to a plateau of
   ~4,000–4,500 eggs/day. The ramp is a **different regime** from steady lay — don't fit one linear
   trend across both (or use logistic growth; see §5).
2. **Nulls mean "not logged" (or not yet ingested), not zero.** The hourly *sensor* rows can still
   exist so the day is present, but `eggs_total` is **null**. **Never coalesce egg nulls to 0** — a
   missed count is not a production crash. In the 2026-07-10 snapshot the last ~11 days of
   `eggs_total` were null. That empty tail was a pull artefact. It is not evidence that logging
   stopped. Do not describe egg logging as lapsed. (Owner, 2026-10-19.)
3. **Logging-gap outliers.** Some logged days are partial/catch-up counts — e.g. **2025-12-01 → -06**
   dropped to ~100–1,200/day then jumped back to ~4,000. Treat these as outliers (blank them), don't
   trust them as real dips.
4. **Some totals in that snapshot exceed the hen count recorded then.** A few early days log more
   eggs than the 4,479 hens the July notes used for house1 (e.g. 5,220 on 2025-11-08) — i.e. >100%
   lay rate against that figure, physically impossible in a day. This is **batched logging** (one
   entry covering more than one day's collection). So `eggs_total` is not a clean per-calendar-day
   physical count on every row. Robust models / outlier handling matter. 4,479 is not a code
   constant; live flock size is `houseHens` in the farm config.
5. **`avg_egg_weight` is sparsely logged** (many null days) — usable as a slow-moving covariate, not a
   dense series.

For **HDEP** (hen-day egg %), the app computes `eggs_total / live-hens × 100`, where
`live-hens = flock_start − cumulative_deaths` (see
[src/app/api/analytics/series/route.ts](src/app/api/analytics/series/route.ts)). Reuse that definition
so DS numbers match the dashboard.

---

## 4. Pull it into pandas

```python
from pyathena import connect
from pyathena.pandas.cursor import PandasCursor

cur = connect(
    s3_staging_dir="s3://senseagri-dev-athena-results/",
    region_name="af-south-1",
    work_group="senseagri",
    cursor_class=PandasCursor,
).cursor()

df = cur.execute("""
    SELECT date(bucket_start) AS ds, max(eggs_total) AS y
    FROM senseagri_silver.aligned_hourly
    WHERE farm_id='farm_anike_001' AND house_id='house1' AND year IN (2025,2026)
    GROUP BY date(bucket_start) ORDER BY ds
""").as_pandas()
```

---

## 5. Egg-count forecast baseline — Prophet

A working baseline lives in
[analysis/egg_forecast_prophet.py](analysis/egg_forecast_prophet.py). It was validated on the
2026-07-10 snapshot, not as a standing accuracy claim. It pulls the daily egg series from Athena,
drops days where `eggs_total` is null (a missing log, not a stopped series), blanks logging-gap
outliers so Prophet ignores them, fits Prophet with **weekly** seasonality, **backtests on a 21-day
holdout**, and forecasts 30 days. The script's own comment still says nulls begin "once manual
logging stops"; that wording is wrong. Nulls are missing logs.

### Run it
```bash
cd analysis
python3.12 -m venv .venv && source .venv/bin/activate    # Prophet has wheels for 3.10–3.12
pip install -r requirements.txt
AWS_REGION=af-south-1 python egg_forecast_prophet.py
```
Outputs `egg_forecast.csv` (full forecast + intervals) and `egg_forecast.png`.

### Result on the 2026-07-10 snapshot
These scores are that run only. Re-run [analysis/egg_forecast_prophet.py](analysis/egg_forecast_prophet.py)
before quoting them. The script still hard-codes `FARM_ID = "farm_anike_001"` for this baseline;
the app does not.

- Training on the mature laying period (from 2025-11-10), 225 usable days after cleaning.
- **21-day holdout: MAPE ≈ 3.2%, MAE ≈ 120 eggs/day** on that snapshot.
- 30-day forward forecast from that fit ≈ **4,090 eggs/day** mean (80% interval ≈ 3,300–5,000).
- Sample fit: [analysis/egg_forecast_sample.png](analysis/egg_forecast_sample.png) — trend + weekly
  seasonality (the sawtooth) and the 80% interval; the 2025-12 logging-gap days are excluded from the
  fit (blanked), so they don't appear as points and the y-axis auto-scales to the plateau.

### Modelling choices (and why)
- **Weekly seasonality on, yearly off** — the 2026-07-10 snapshot had only ~8 months of data; a yearly term would overfit. Do not quote "~8 months" as the history available now.
- **Train on the plateau, not the ramp** (`TRAIN_START` constant). For an *operational* "how many
  eggs next week" forecast this is what you want. The ramp needs different handling (below).
- **Outliers → NaN** (wide rolling-median filter) rather than deletion, so the date index stays
  regular and Prophet simply skips them.
- **Linear growth** — the plateau has a gentle post-peak decline that piecewise-linear + changepoints
  capture well.

### Where to take it next
- **Whole-life curve (incl. onset ramp):** `TRAIN_START=None`, `growth="logistic"`, set a `cap`
  (~flock size × peak-lay fraction) and `floor=0` so the S-curve is bounded — linear growth
  over-shoots the ramp.
- **Flock age as a regressor:** biologically, lay rate is a function of flock age (weeks in lay).
  `add_regressor("age_days")` beats letting the trend absorb it, and it transfers across flocks/houses.
- **Environmental drivers:** join hourly `temperature`/heat-stress from the same table, aggregate to
  daily, and add as **lagged** regressors (heat depresses lay a day or two later).
- **Per-house / multi-farm:** the query is already scoped by `farm_id` and `house_id`. Take those
  from the farm config, not from a global app constant. A hierarchical/pooled model can share the
  lay-curve shape across flocks once more than one house is in the training extract.
- **Alternatives worth benchmarking:** the series is short, strongly seasonal-weekly and trend-driven —
  Prophet is a good fit, but compare against a seasonal-naïve baseline (last-week same-day) and
  SARIMA to be sure Prophet earns its keep.

---

## 6. Open questions / dependencies
1. **Check the latest logged day before training.** Forecasting needs a current non-null
   `eggs_total` series. Nulls are missing logs, not a stopped series. Camera counts are a separate
   feed: the dashboard reads InfluxDB `egg_count` per camera
   ([src/lib/eggCountSource.ts](src/lib/eggCountSource.ts),
   [src/app/api/egg-count/route.ts](src/app/api/egg-count/route.ts)). Both cameras point at the egg
   belts, one per A-frame, and the API adds them (`totals.combined`). No camera faces the manure
   belt. (Owner, 2026-10-19. See [docs/PROJECT_STATE.md](docs/PROJECT_STATE.md).) The silver reader
   does not select camera counts. Whether the platform also writes them into silver is not visible
   in this repo.
2. **Batched-logging days** in the 2026-07-10 snapshot (totals above the hen count used then):
   confirm with the farm how collection is recorded, so models can de-batch rather than only
   outlier-drop. This file does not say whether that pattern is still present.
3. **Do not build FCR from `aligned_hourly.water_litres` / `feed_kg`.** Those columns are null by
   design. `meters_hourly` feed columns are pulses, not kg. The provisional kilogram FCR is
   [docs/calculations/feed-conversion-ratio.md](docs/calculations/feed-conversion-ratio.md) and must
   not be shown as a measured value. The production route's `fcr` field is previous-day pulses from
   the single `feedDeviceId` divided by eggs ([src/app/api/production/route.ts](src/app/api/production/route.ts)),
   which is a different quantity.
4. The 2026-07-10 Prophet baseline was one house and about 8 months. Re-query before describing how
   much history exists now.
