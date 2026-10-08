# Lay (HPED) forecast: AI demo

**This is a forecast, not a measurement.** Farm `farm_anike_001`, house `house1`. It uses DailyLog egg counts only; camera counts are not used.

## Current model: `lay_forecast.py` (shown in the app)

Run from the repository root (add `--offline` to use the local cache; about 20 s):

```
/Users/dylangeldenhuys/Code/Dashboard/analysis/.venv/bin/python analysis/ai_demo/forecast/lay_forecast.py
```

- **Model:** the flock's average over its last 7 logged days, carried along the flock's own lay curve (a Gompertz rise with a slow decline, refitted on the data available each day). It forecasts the next 3 days (operational) and the next 4 weeks.
- **Range:** the 10th–90th percentile of past forecast errors at the same number of days ahead.
- **Testing:** a forecast is made from every day using only the data available that day, scored on forecasts made 15 Apr – 30 Jun and from 1 Jul. Every set-up tried is in `lay_backtest.csv`.

**Results** on 74 forecasts made from 1 Jul (average error in hen-day % points):

| Forecast | Next day | Next 3 days | Next 4 weeks |
|---|---|---|---|
| This model | 2.1 | 2.2 | 2.8 |
| Plain last-7-day average | 2.1 | 2.2 | 2.8 |

**What we found:**
- **No set-up beat the recent level by a meaningful margin.**
  - Level windows of 3, 7 and 14 days all scored about the same.
  - The flock's own curve and a flat line tied over 4 weeks.
  - The generic breed-standard curve was worse over 4 weeks (3.2 points), because this flock is not declining as steeply.
  - The flock curve is kept because it will bend down as the flock ages.
- **The extra signals didn't help.** A ridge-regression adjustment for the next 3 days used:
  - the last days' departure from the level and the weekday;
  - shed heat (THI) and water per bird;
  - cracked eggs %, egg-size mix and mortality.

  It was worse on forecasts made Apr–Jun (3.01 vs 2.92 points) and within 0.04 points from Jul. It is not used.
- **Most dips look like counting carry-overs.** 3 of the 4 dips since July (lay at least 4 points below the recent level) bounced straight back the next day, as earlier ones did (22 Jan, 7 Apr, 15 May, 25 Jun, 9 Jul). That pattern points to eggs counted on the wrong day, which no flock signal can predict. 5 Aug was a real dip: it stayed low for 3 days.
- **Water drops are only a hint.** Of 9 days when water per bird fell below 60% of the past week's median (24 May – 10 Sep), 3 were followed by a lay dip within 3 days. About 20% of all days are followed by one. That is too few cases to call it a reliable warning, so the app shows it as a "dip watch" with this track record.

Outputs:
- `src/data/ai-demo/hped_forecast.json` (app);
- `lay_forecast.png` (history, tested next-day forecasts, forecast and range);
- `lay_backtest.csv` (every set-up).

## Earlier model: `hped_forecast.py` (Prophet, superseded)

The first version below forecast 28 days with Prophet anchored to the breed standard. Its data preparation (DailyLog parsing, HPED, exclusions, THI, the Gompertz fit) is still used by `lay_forecast.py`. Its 28-day backtest lost to the plain 7-day average (3.07 vs 1.48 points), because its slow trend never looked at the latest level. That is why it was replaced.

- **as_of: 2026-09-13**, the last DailyLog day with eggs. The live Google Sheet and the bronze copy both end on that date.
- Only the farm's **manual DailyLog egg counts** are used. Camera egg counts (InfluxDB `egg_count`) are **not used** because the farm reports them as very inaccurate.
- All sources were read-only. The sheet was opened with the `spreadsheets.readonly` scope, and S3 was only listed and read.

Outputs:

| File | What |
|---|---|
| `src/data/ai-demo/hped_forecast.json` | App-facing output (schema in the task brief; validated) |
| `analysis/ai_demo/forecast/hped_forecast.png` | History, standard, fitted, forecast with 80% interval, backtest window |
| `analysis/ai_demo/forecast/backtest_variants.csv` | Mean absolute error (MAE) of every model variant and baseline on all three backtest windows |
| `analysis/ai_demo/forecast/hped_forecast.py` | Reproducible script |

## Data

- **DailyLog:** 338 rows for house1, 2025-10-10 to 2026-09-13, one row per date (no duplicates). There are **334 days with eggs** since the first eggs on 2025-10-13. 2026-06-22 has no row.
- **HPED** uses the same formula as the app (`analytics/series/route.ts`, `agentTools.ts`): `eggs_total / live_hens × 100`.
  - `eggs_total` = small + medium + large + XL + jumbo. Damaged eggs are not included, matching `production/route.ts` and the silver spec.
  - `live_hens` = 4,479 (Houses tab) minus cumulative DailyLog mortality, including that day.
  - The app rounds to 1 decimal; the JSON keeps 2.
- **Breed standard:** parsed from `src/lib/henStandard.ts`. Flock week = floor((133 + days since 2025-10-13) / 7). This is a generic layer curve.
- **Climate:** AM308-1 bronze readings.
  - Processing: hourly mean per sensor, then the mean of the two sensors, using local time (UTC+2). A day counts only if it has at least 18 hourly values. Gaps of up to 3 days are interpolated.
  - THI = T − (0.31 − 0.31·RH/100)(T − 14.4), as in `src/lib/thi.ts`.
  - Coverage: 2026-02-20 to 2026-10-08, with **a gap from 2026-02-26 to 2026-04-13**.
  - **THI never reached the 27.8 heat-stress level** (highest daily peak 26.0 up to as_of). The "hours ≥ 27.8" feature is therefore always zero and was dropped.

## Exclusions from fitting

Excluded days stay in the history and are flagged `excluded: true` there.

| Rule | Days |
|---|---|
| Lay onset: first 28 days after first eggs | 2025-10-10 to 2025-11-09 (includes the pre-lay zero days and a 0-egg day on 2025-11-04) |
| Below 50%: logging gap or partial count | 2025-12-01 to 2025-12-07 (27.5, 3.1, 2.8, 0.4, 2.2, 2.7, 4.3%) |
| Above 100% of live hens: eggs likely carried over from another day | 2025-11-16, 11-20, 11-23, 11-24, 12-16, 12-20, 12-31; 2026-01-29, 04-04, 04-17, 05-13 |
| Isolated one-day dip more than 15 points below the median of the ±3 days around it, with both next-door days normal | 2026-06-30 (69.1%) |

Some real-looking dips are **kept**:

- 2026-06-08 and 06-09 (76%, two days in a row)
- 2026-03-09 to 03-12 (65–78%, with 7.2% cracked eggs on 03-10)
- 2026-08-05 (78.0%)

On 8 laying days damaged eggs were logged as `0`: 2025-11-10, 2026-02-24, 06-25, 07-20, 07-28, 07-29, 08-04 and 09-07. These are treated as **not recorded** for the cracked % regressor, which carries the previous value forward. The HPED for those days is unaffected.

## Model

**Prophet** with weekly seasonality, no yearly seasonality and 80% intervals. Every regressor is **lagged one day**, so it is known when the forecast is made:

| key | label |
|---|---|
| `thi_mean_lag1` | Shed climate (THI daily mean, previous day) |
| `thi_max_lag1` | Shed climate (THI daily peak, previous day) |
| `damaged_pct_lag1` | Cracked/damaged eggs % (previous day) |
| `large_share_lag1` | Large+XL+Jumbo share of eggs % (previous day) |

Average egg weight was skipped. It is logged on only 21 days.

**Variant search.** 24 variants were scored:

- **Target:** HPED − anchor, HPED ÷ anchor, or HPED with the anchor as a regressor
- **Anchor:** breed standard, or a Gompertz curve fitted to this flock (rise with linear decline)
- **Trend:** linear (changepoint prior 0.05) or flat
- **Training window:**
  - "short": 2026-04-15 onward, where THI is complete
  - "long": from 2025-11-10, with THI set to its average where no sensor data exists, so it contributes nothing on those days

**Selection was honest.** The variant was chosen by mean MAE on two earlier 28-day backtests (cutoffs 2026-06-21 and 2026-07-19). The required backtest (cutoff as_of − 28 = **2026-08-16**) was kept as a holdout and **not used to choose**.

Chosen: **`ratio|standard|linear|long`**. It forecasts HPED ÷ breed standard with a slowly changing trend, then multiplies the standard back in. It was trained on 288 days (2025-11-10 to 2026-09-13).

### Backtest (MAE in HPED points, 28-day horizon)

| Cutoff | Prophet (chosen) | Breed standard × recent ratio | Last 7-day mean |
|---|---|---|---|
| 2026-06-21 (selection) | **2.18** | 3.36 | 2.82 |
| 2026-07-19 (selection) | **2.29** | 2.56 | 2.31 |
| **2026-08-16 (holdout, reported in JSON)** | 3.07 (MAPE 3.31%) | 4.61 (MAPE 4.97%) | **1.48** (MAPE 1.60%) |

**Honest read:**

- Prophet beats the breed-standard baseline in every window.
- **On the holdout it loses clearly to the simple last-7-day mean.** It under-predicted by 2.9 points on average, because lay recovered in late August.
- Lay has been nearly flat (about 89–93%) for months, so a recent average is very hard to beat over 28 days.
- The differences between the top ~10 variants (≈2.2–2.4 on the selection windows) are within noise. No variant beat the 7-day mean on the holdout; the best was 1.98.
- The model's value for the demo is the breed-curve context, the interval and the driver breakdown, not better point accuracy.

**Gompertz vs breed standard as the anchor.** The best Gompertz-anchored variant (`anchor_reg|gompertz|linear|long`) scored 2.31 on the selection windows, against 2.23 for the chosen standard-anchored variant. On the holdout it did better: 2.58 against 3.07. There is no consistent winner. The fitted Gompertz curve plateaus at about 90.4% with no decline yet: its slope is +0.07 points per month.

## Forecast (2026-09-14 to 2026-10-11)

- Weekly means: **91.2, 91.3, 90.8, 90.7%**. The 80% interval is about ±5 points (for example 84.8–94.9% on day 1).
- The breed standard over the same weeks is 82.5 → 80.8%. The flock has run about 8 points above this generic curve.

### Driver contributions

Mean over the forecast horizon, in HPED points, relative to an average training day:

| Driver | Contribution | Approx. effect size |
|---|---|---|
| Shed climate (THI mean, previous day) | **+1.54** | +0.38 pts per °C-eq |
| Shed climate (THI peak, previous day) | −0.42 | −0.20 pts per °C-eq |
| Cracked/damaged eggs % (previous day) | −0.81 | −2.8 pts per point of cracked % |
| Large+XL+Jumbo share (previous day) | +0.74 | +0.12 pts per point of share |

Prophet regressor components are additive, so they are read directly (×standard for the ratio target), and **SHAP is not needed**.

- **Milder spring THI** adds about 1.5 points compared with the cold winter average.
- **Higher cracked %** (1.5% against 1.2%) takes off about 0.8 points.

### Recent drops (last 60 days)

"Expected" is the model baseline (anchor, trend and weekday pattern, with every driver at its average). Drop = actual − expected = the sum of the driver contributions plus a part the model does not explain.

| Date | Actual | Expected | Drop | THI mean | THI peak | Cracked | Size mix | Unexplained |
|---|---|---|---|---|---|---|---|---|
| 2026-07-25 | 85.5 | 91.6 | −6.1 | −1.0 | +0.3 | +0.7 | +0.8 | −6.9 |
| 2026-08-05 | 78.0 | 91.3 | −13.3 | −1.4 | 0.0 | +0.6 | +0.8 | −13.3 |
| 2026-08-07 | 84.6 | 91.6 | −7.1 | −0.8 | −0.4 | +0.3 | +0.8 | −7.0 |

**The recent drops are mostly not explained by the drivers.** A cold previous day accounts for about 1 point at most. Something the data doesn't capture caused the rest: an event, a partial count, or a feed or water issue.

## Caveats

- **Future regressors.**
  - THI uses actual sensor data where it exists (25 of 28 forecast days; sensors run to 2026-10-07). The remaining days use the mean of the last 14 sensor days.
  - Cracked % and size mix are held at their last-14-day means, except day 1, which uses the known 2026-09-13 value.
- **THI is mixed up with season.** There is only one autumn–winter–spring of data. The model links milder days with higher lay, but day length and flock age move with it. It has **never seen heat stress**, so it cannot predict a summer heat effect.
- **The cracked-egg effect rests mostly on one event.** That event was 7.2% cracked on 2026-03-10, followed by 65.2% lay on 03-11. Treat the cracked-egg contribution as indicative only.
- **The breed standard is generic** and pessimistic for this flock.
- **The 80% interval covers normal day-to-day noise only.** It does not cover disease, feed or lighting changes, or counting errors.
- **The backtest is a single 28-day window.** Treat its error as indicative.

## How to rerun

From the repository root:

```bash
/Users/dylangeldenhuys/Code/Dashboard/analysis/.venv/bin/python analysis/ai_demo/forecast/hped_forecast.py            # live sheet + S3 (read-only)
/Users/dylangeldenhuys/Code/Dashboard/analysis/.venv/bin/python analysis/ai_demo/forecast/hped_forecast.py --offline  # reuse ./cache
```

- The script needs `prophet` (1.5.0 is installed in that venv) and AWS credentials for account 336814727818 (region af-south-1).
- It falls back from the live sheet to bronze, and then to the local cache.
- `cache/` holds farm data and is git-ignored.
- A run takes about 15 s.
