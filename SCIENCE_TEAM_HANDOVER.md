# SenseAgri — Data-Science Handover

**Audience:** the data-science team.
**Purpose:** (1) how to reach the analytics data in AWS Athena, (2) what's in it and its
gotchas, (3) a working **egg-count forecast** baseline (Meta **Prophet**) you can run and build on.

Verified live against AWS account **336814727818**, region **af-south-1**, on 2026-07-10.

> The data model, S3 layout, and ETL are documented in **[SILVER_LAYER_SPEC.md](SILVER_LAYER_SPEC.md)** —
> read that for the full pipeline picture. This doc is the *consumer's* view: query it and model it.

---

## 1. Access — Athena over the silver layer

Everything for analysis lives in one Glue/Athena table backed by Parquet in S3. **No crawler**
(partition projection), **no database to stand up** — you query it with plain SQL.

| Thing | Value |
|---|---|
| Region | `af-south-1` |
| Athena workgroup | `senseagri` (enforces its own results location) |
| Glue database | `senseagri_silver` |
| Table | `aligned_hourly` |
| Query-results bucket | `s3://senseagri-dev-athena-results/` |
| Data bucket (read) | `s3://senseagri-dev-silver/` |

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

Only farm live today: **`farm_anike_001`**, house **`house1`** (4,479 hens at flock start).

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
| meters | `water_litres, feed_kg` | per-hour consumption (⚠️ meters currently unreliable — see caveats) |
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
not sensor data. What we verified in the live table (274 daily rows, 2025-10-09 → 2026-07-09):

1. **Flock lay curve.** Lay begins ~2025-10-11 and ramps over ~4 weeks to a plateau of
   ~4,000–4,500 eggs/day. The ramp is a **different regime** from steady lay — don't fit one linear
   trend across both (or use logistic growth; see §5).
2. **Nulls mean "not logged", not zero.** When manual logging stops, the hourly *sensor* rows still
   exist so the day is present, but `eggs_total` is **null**. **Never coalesce egg nulls to 0** — a
   missed count is not a production crash. In this dataset **egg logging stopped after 2026-06-28**
   (the last ~11 days are null).
3. **Logging-gap outliers.** Some logged days are partial/catch-up counts — e.g. **2025-12-01 → -06**
   dropped to ~100–1,200/day then jumped back to ~4,000. Treat these as outliers (blank them), don't
   trust them as real dips.
4. **Some totals exceed the flock size.** A few early days log **>4,479** eggs (e.g. 5,220 on
   2025-11-08) — i.e. >100% lay rate, physically impossible in a day. This is **batched logging** (one
   entry covering more than one day's collection). So `eggs_total` is not a clean per-calendar-day
   physical count on every row. Robust models / outlier handling matter.
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

A working, **already-validated** baseline lives in
[analysis/egg_forecast_prophet.py](analysis/egg_forecast_prophet.py). It pulls the daily egg series
from Athena, cleans it (drops the unlogged tail, blanks logging-gap outliers so Prophet ignores them),
fits Prophet with **weekly** seasonality, **backtests on a 21-day holdout**, and forecasts 30 days.

### Run it
```bash
cd analysis
python3.12 -m venv .venv && source .venv/bin/activate    # Prophet has wheels for 3.10–3.12
pip install -r requirements.txt
AWS_REGION=af-south-1 python egg_forecast_prophet.py
```
Outputs `egg_forecast.csv` (full forecast + intervals) and `egg_forecast.png`.

### Result on the live Anike data (2026-07-10)
- Training on the mature laying period (from 2025-11-10), 225 usable days after cleaning.
- **21-day holdout: MAPE ≈ 3.2%, MAE ≈ 120 eggs/day** — solidly accurate for a first pass.
- 30-day forward forecast ≈ **4,090 eggs/day** mean (80% interval ≈ 3,300–5,000).
- Sample fit: [analysis/egg_forecast_sample.png](analysis/egg_forecast_sample.png) — trend + weekly
  seasonality (the sawtooth) and the 80% interval; the 2025-12 logging-gap days are excluded from the
  fit (blanked), so they don't appear as points and the y-axis auto-scales to the plateau.

### Modelling choices (and why)
- **Weekly seasonality on, yearly off** — only ~8 months of data; a yearly term would overfit.
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
- **Per-house / multi-farm:** loop `FARM_ID`/`HOUSE_ID`; the query is already scoped. When farm #2 is
  onboarded, a hierarchical/pooled model shares the lay-curve shape across young flocks.
- **Alternatives worth benchmarking:** the series is short, strongly seasonal-weekly and trend-driven —
  Prophet is a good fit, but compare against a seasonal-naïve baseline (last-week same-day) and
  SARIMA to be sure Prophet earns its keep.

---

## 6. Open questions / dependencies
1. **Data continuity:** manual egg logging lapsed after 2026-06-28 — any live/forecasting product
   needs the farm to log consistently (or the camera egg-count source, kept in raw but not yet in
   silver — see SILVER_LAYER_SPEC §"Camera egg counts").
2. **Batched-logging days** (totals > flock size): confirm with the farm how collection is recorded,
   so we can de-batch rather than just outlier-drop.
3. **Meters** (`water_litres`, `feed_kg`) are currently unreliable (hardware) — don't build FCR on
   them yet.
4. **More history / more farms** improves everything here — this baseline is one house, ~8 months.
