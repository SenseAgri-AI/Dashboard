#!/usr/bin/env python3
"""
Egg-count forecasting for the SenseAgri silver layer using Meta's Prophet.

Pulls the daily egg series for one farm/house straight from Athena
(senseagri_silver.aligned_hourly), cleans it, fits Prophet, backtests on a
holdout window, and forecasts N days forward.

Run:
    python -m pip install prophet pandas pyathena boto3 matplotlib
    AWS_REGION=af-south-1 python egg_forecast_prophet.py

AWS creds must resolve to a role/user with the silver read policy
(senseagri-dev-silver-app-read) + Athena/S3 results access.
"""

from __future__ import annotations
import os
import pandas as pd
from pyathena import connect
from pyathena.pandas.cursor import PandasCursor
from prophet import Prophet

# ---------------------------------------------------------------- config
REGION       = os.environ.get("AWS_REGION", "af-south-1")
WORKGROUP    = "senseagri"
STAGING_DIR  = "s3://senseagri-dev-athena-results/"
DATABASE     = "senseagri_silver"

FARM_ID      = "farm_anike_001"
HOUSE_ID     = "house1"

# The flock ramps from onset of lay to a plateau over ~4 weeks. That ramp is a
# different regime from steady production; for an *operational* forecast we train
# on the mature laying period. Set to None to use the whole lay history instead
# (then prefer growth="logistic" with a cap — see note at bottom).
TRAIN_START  = "2025-11-10"

HOLDOUT_DAYS = 21     # backtest window held out from the tail of real data
HORIZON_DAYS = 30     # days to forecast beyond the last observation
OUT_DIR      = os.path.dirname(os.path.abspath(__file__))


# ---------------------------------------------------------------- load
def load_daily_eggs() -> pd.DataFrame:
    """One row per day: ds (date), y (eggs_total). Daily values are broadcast
    across 24 hourly rows in silver, so we take max() per day."""
    sql = f"""
        SELECT date(bucket_start) AS ds,
               max(eggs_total)     AS y,
               max(mortality)      AS deaths
        FROM {DATABASE}.aligned_hourly
        WHERE farm_id = '{FARM_ID}' AND house_id = '{HOUSE_ID}'
        GROUP BY date(bucket_start)
        ORDER BY ds
    """
    cur = connect(s3_staging_dir=STAGING_DIR, region_name=REGION,
                  work_group=WORKGROUP, cursor_class=PandasCursor).cursor()
    df = cur.execute(sql).as_pandas()
    df["ds"] = pd.to_datetime(df["ds"])
    df["y"] = pd.to_numeric(df["y"], errors="coerce")
    return df


# ---------------------------------------------------------------- clean
def clean(df: pd.DataFrame) -> pd.DataFrame:
    """Drop the unlogged tail (y is null once manual logging stops), and null
    out logging-gap outliers so Prophet ignores them (it skips NaN y) rather
    than treating a missed count as a real production crash."""
    df = df.dropna(subset=["y"]).copy()                 # unlogged days -> gone
    if TRAIN_START:
        df = df[df["ds"] >= pd.Timestamp(TRAIN_START)]
    df = df.sort_values("ds").reset_index(drop=True)

    # A logged day far below the local trend is almost always a partial/missed
    # count, not a real drop. Blank it (NaN) — Prophet drops NaN rows on fit.
    # Wide, centered window so a *run* of gap days can't drag the median down
    # with it (a 7-day window sits inside a 6-day gap and misses it).
    med = df["y"].rolling(15, center=True, min_periods=5).median()
    outlier = df["y"] < 0.5 * med
    df.loc[outlier, "y"] = pd.NA
    print(f"  flagged {int(outlier.sum())} logging-gap outlier(s) as NaN")
    return df[["ds", "y"]]


# ---------------------------------------------------------------- model
def make_model() -> Prophet:
    # ~8 months of data → weekly seasonality yes, yearly no. The plateau has a
    # gentle post-peak decline that the piecewise-linear trend captures.
    return Prophet(
        growth="linear",
        weekly_seasonality=True,
        yearly_seasonality=False,
        daily_seasonality=False,
        changepoint_prior_scale=0.05,
        interval_width=0.80,
    )


def backtest(df: pd.DataFrame) -> None:
    """Hold out the last HOLDOUT_DAYS of real observations, fit on the rest,
    and report error on the holdout."""
    df = df.dropna(subset=["y"])
    if len(df) <= HOLDOUT_DAYS + 14:
        print("  not enough data for a holdout backtest; skipping")
        return
    cut = df["ds"].iloc[-HOLDOUT_DAYS]
    train, test = df[df["ds"] < cut], df[df["ds"] >= cut]
    m = make_model().fit(train)
    fc = m.predict(test[["ds"]])
    merged = test.merge(fc[["ds", "yhat"]], on="ds")
    mape = (merged["y"] - merged["yhat"]).abs().div(merged["y"]).mean() * 100
    mae  = (merged["y"] - merged["yhat"]).abs().mean()
    print(f"  holdout {HOLDOUT_DAYS}d  MAPE={mape:.1f}%  MAE={mae:.0f} eggs/day")


# ---------------------------------------------------------------- main
def main() -> None:
    print("Loading daily egg series from Athena…")
    raw = load_daily_eggs()
    print(f"  {len(raw)} daily rows, {raw['ds'].min().date()} → {raw['ds'].max().date()}")

    df = clean(raw)
    last_real = df.dropna(subset=["y"])["ds"].max()
    print(f"  training rows: {df['y'].notna().sum()}, last logged day: {last_real.date()}")

    print("Backtesting…")
    backtest(df)

    print("Fitting final model on all data and forecasting…")
    m = make_model().fit(df)
    future = m.make_future_dataframe(periods=HORIZON_DAYS, freq="D")
    fc = m.predict(future)

    horizon = fc[fc["ds"] > last_real][["ds", "yhat", "yhat_lower", "yhat_upper"]].copy()
    for c in ["yhat", "yhat_lower", "yhat_upper"]:
        horizon[c] = horizon[c].round(0).astype(int)
    print(f"\n  {HORIZON_DAYS}-day forecast (eggs/day, 80% interval):")
    print(horizon.head(10).to_string(index=False))
    print(f"  … forecast mean over horizon: {horizon['yhat'].mean():.0f} eggs/day")

    csv = os.path.join(OUT_DIR, "egg_forecast.csv")
    fc[["ds", "yhat", "yhat_lower", "yhat_upper"]].to_csv(csv, index=False)
    print(f"\n  full forecast written to {csv}")

    try:
        fig = m.plot(fc)
        fig.gca().set(title=f"Egg count — {FARM_ID}/{HOUSE_ID}", xlabel="date", ylabel="eggs/day")
        png = os.path.join(OUT_DIR, "egg_forecast.png")
        fig.savefig(png, dpi=110, bbox_inches="tight")
        print(f"  plot written to {png}")
    except Exception as e:  # matplotlib backend issues shouldn't fail the run
        print(f"  (plot skipped: {e})")


if __name__ == "__main__":
    main()

# ---------------------------------------------------------------------------
# Extending this:
#  * Whole-life curve (incl. the ramp): set TRAIN_START=None and switch to
#    growth="logistic"; add df["cap"] (flock size × ~0.95 peak-lay) and a
#    df["floor"]=0 so the S-curve is bounded. Linear growth will over-shoot.
#  * Flock age: add_regressor("age_days") — biologically the lay rate is a
#    function of flock age; a regressor beats letting the trend absorb it.
#  * Env drivers: add_regressor("temp_7d") / heat-stress flags from silver;
#    heat depresses lay a day or two later, so lag them.
#  * Per-house / multi-farm: loop FARM_ID/HOUSE_ID; the silver query is scoped.
# ---------------------------------------------------------------------------
