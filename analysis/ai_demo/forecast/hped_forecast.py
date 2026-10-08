#!/usr/bin/env python3
"""Hen-day egg production (HPED) FORECAST for the AI demo - farm_anike_001 / house1.

This is a forecast, not a measurement. It uses ONLY the farm's manual DailyLog egg counts
(camera egg counts are deliberately not used - the farm reports them as very inaccurate) plus the
AM308 shed climate sensors for the temperature-humidity index (THI).

Run from the repository root:
    /Users/dylangeldenhuys/Code/Dashboard/analysis/.venv/bin/python analysis/ai_demo/forecast/hped_forecast.py
    ... --offline    # reuse analysis/ai_demo/forecast/cache/ instead of re-reading the sheet and S3

Read-only on every source: the Google Sheet is opened with the spreadsheets.readonly scope, S3 is
only listed and read. Nothing is written back to the sheet, S3 or InfluxDB.

Writes:
    src/data/ai-demo/hped_forecast.json             (app-facing output)
    analysis/ai_demo/forecast/hped_forecast.png     (verification chart)
    analysis/ai_demo/forecast/backtest_variants.csv (every model variant scored on every backtest window)
    analysis/ai_demo/forecast/cache/*.parquet       (local copies of the inputs, for --offline reruns)
"""

from __future__ import annotations

import argparse
import io
import json
import logging
import re
import warnings
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")
from prophet import Prophet  # noqa: E402  (imported before silencing: it installs its own log handlers)

for _name in ("cmdstanpy", "prophet"):
    logging.getLogger(_name).setLevel(logging.ERROR)
    logging.getLogger(_name).disabled = True   # cmdstanpy re-raises its own level on first use

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
JSON_OUT = ROOT / "src" / "data" / "ai-demo" / "hped_forecast.json"
PNG_OUT = HERE / "hped_forecast.png"
VARIANTS_OUT = HERE / "backtest_variants.csv"
CACHE = HERE / "cache"
# Older read-only cache from the water analysis in the main checkout - last-resort fallback only.
FALLBACK_CACHE = Path("/Users/dylangeldenhuys/Code/Dashboard/analysis/water_expected_consumption/cache")

REGION = "af-south-1"
BRONZE = "senseagri-dev-bronze"
FARM_SLUG = "anike"
FARM_ID = "farm_anike_001"
HOUSE = "house1"
SA_PARAM = "/senseagri/dev/google/service-account"
HOUSE_DEFAULTS = {"start_date": "2025-10-13", "start_age_days": 133, "starting_hens": 4479}

HORIZON = 28            # forecast / backtest horizon (days)
HISTORY_DAYS = 120      # history rows in the JSON
DROP_WINDOW = 60        # look-back for "recent drops"
ONSET_DAYS = 28         # lay-onset days excluded from fitting (after the first eggs)
MIN_SENSOR_HOURS = 18   # a day's THI is used only if at least this many hourly values exist
MAX_GAP_FILL = 3        # interpolate THI gaps of at most this many days
THI_HOT = 27.8          # heat-stress threshold (src/lib/thi.ts THI_COMFORT)
DIP_PTS = 15.0          # isolated single-day dip threshold vs neighbouring days
LOW_FLOOR = 50.0        # post-onset days below this are logging gaps / partial counts
COUNT_COLS = ["small", "medium", "large", "xl", "j", "damaged", "mortality"]
EGG_COLS = ["small", "medium", "large", "xl", "j"]   # app: eggs_total excludes damaged

REGRESSORS = [
    {"key": "thi_mean_lag1", "label": "Shed climate (THI daily mean, previous day)", "lag_days": 1},
    {"key": "thi_max_lag1", "label": "Shed climate (THI daily peak, previous day)", "lag_days": 1},
    {"key": "damaged_pct_lag1", "label": "Cracked/damaged eggs % (previous day)", "lag_days": 1},
    {"key": "large_share_lag1", "label": "Large+XL+Jumbo share of eggs % (previous day)", "lag_days": 1},
]
REG_KEYS = [r["key"] for r in REGRESSORS]
REG_LABEL = {r["key"]: r["label"] for r in REGRESSORS}
THI_KEYS = ["thi_mean_lag1", "thi_max_lag1"]

ONSET_REASON = "lay onset (first 4 weeks after first eggs)"
DAY = pd.Timedelta(days=1)


# --------------------------------------------------------------------------------------- inputs
def _ssm():
    import boto3
    return boto3.client("ssm", region_name=REGION)


def read_sheet_tabs() -> tuple[pd.DataFrame, pd.DataFrame]:
    """DailyLog + Houses from the live Google Sheet, read-only scope."""
    import gspread
    from google.oauth2.service_account import Credentials

    ssm = _ssm()
    cfg = json.loads(ssm.get_parameter(Name=f"/senseagri/farms/{FARM_SLUG}/config", WithDecryption=True)["Parameter"]["Value"])
    key = json.loads(ssm.get_parameter(Name=SA_PARAM, WithDecryption=True)["Parameter"]["Value"])
    creds = Credentials.from_service_account_info(key, scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"])
    book = gspread.authorize(creds).open_by_key(cfg["spreadsheetId"])

    def tab(name: str) -> pd.DataFrame:
        values = book.worksheet(name).get_all_values()
        return pd.DataFrame(values[1:], columns=values[0])

    log = tab("DailyLog").rename(columns={
        "Date": "date", "House": "house", "Small": "small", "Medium": "medium", "Large": "large", "XL": "xl",
        "J": "j", "Damaged": "damaged", "Mortality": "mortality", "Avg Egg Weight (g)": "avg_egg_weight_g"})
    houses = tab("Houses").rename(columns={
        "House ID": "house_id", "Start Date": "start_date", "Start Age (days)": "start_age_days",
        "Starting Hens": "starting_hens"})
    return log, houses


def read_bronze_prefix(prefix: str) -> pd.DataFrame:
    import boto3
    import pyarrow.parquet as pq

    s3 = boto3.client("s3", region_name=REGION)
    keys: list[str] = []
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=BRONZE, Prefix=prefix):
        keys += [o["Key"] for o in page.get("Contents", []) if o["Key"].endswith(".parquet")]

    def get(key: str) -> pd.DataFrame:
        df = pq.read_table(io.BytesIO(s3.get_object(Bucket=BRONZE, Key=key)["Body"].read())).to_pandas()
        for part in key.split("/"):            # partition values live in the key
            if "=" in part:
                k, v = part.split("=", 1)
                if k not in df.columns:
                    df[k] = v
        return df

    with ThreadPoolExecutor(max_workers=16) as ex:
        frames = list(ex.map(get, keys))
    if not frames:
        raise RuntimeError(f"no parquet under s3://{BRONZE}/{prefix}")
    return pd.concat(frames, ignore_index=True)


def load_inputs(offline: bool) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, dict]:
    CACHE.mkdir(exist_ok=True)
    src: dict[str, str] = {}
    log = houses = am = None
    keep = ["date", "house", *COUNT_COLS, "avg_egg_weight_g"]
    if not offline:
        try:
            log, houses = read_sheet_tabs()
            src["daily_log"] = "live Google Sheet DailyLog tab (read-only)"
        except Exception as e:  # noqa: BLE001
            print(f"[warn] live sheet unavailable ({e}); falling back to bronze")
            try:
                log, houses = read_bronze_prefix("sheet_daily_log/"), read_bronze_prefix("sheet_houses/")
                src["daily_log"] = "bronze s3://senseagri-dev-bronze/sheet_daily_log/"
            except Exception as e2:  # noqa: BLE001
                print(f"[warn] bronze DailyLog unavailable ({e2}); using cache")
        if log is not None:
            log[[c for c in keep if c in log.columns]].astype(str).to_parquet(CACHE / "daily_log.parquet", index=False)
            houses.astype(str).to_parquet(CACHE / "houses.parquet", index=False)
        try:
            am = read_bronze_prefix("device_readings/device_type=AM308-1/")
            am[["dev_eui", "time", "temperature", "humidity", "device_type"]].to_parquet(CACHE / "am308.parquet", index=False)
            src["climate"] = "bronze s3://senseagri-dev-bronze/device_readings/device_type=AM308-1/"
        except Exception as e:  # noqa: BLE001
            print(f"[warn] bronze AM308 unavailable ({e}); using cache")
    if log is None:
        p = CACHE / "daily_log.parquet"
        log = pd.read_parquet(p if p.exists() else FALLBACK_CACHE / "sheet_daily_log.parquet")
        hp = CACHE / "houses.parquet"
        houses = pd.read_parquet(hp if hp.exists() else FALLBACK_CACHE / "sheet_houses.parquet")
        src["daily_log"] = f"cached copy ({p if p.exists() else FALLBACK_CACHE})"
    if am is None:
        p = CACHE / "am308.parquet"
        am = pd.read_parquet(p if p.exists() else FALLBACK_CACHE / "am308_readings.parquet")
        src["climate"] = f"cached copy ({p if p.exists() else FALLBACK_CACHE})"
    return log, houses, am, src


def load_standard() -> tuple[np.ndarray, np.ndarray]:
    """HEN_STANDARD (week -> HDEP %) parsed from src/lib/henStandard.ts."""
    txt = (ROOT / "src" / "lib" / "henStandard.ts").read_text()
    rows = re.findall(r"week:\s*(\d+),\s*hdep:\s*([\d.]+)", txt)
    weeks = np.array([int(w) for w, _ in rows], dtype=float)
    vals = np.array([float(v) for _, v in rows])
    return weeks, vals


# ------------------------------------------------------------------------------------ features
def daily_climate(am: pd.DataFrame) -> pd.DataFrame:
    """Hourly mean per AM308 sensor -> mean of sensors -> THI -> daily mean / max / hot hours (local UTC+2)."""
    a = am.copy()
    if "device_type" in a.columns:
        a = a[a["device_type"].astype(str) == "AM308-1"]
    a["temperature"] = pd.to_numeric(a["temperature"], errors="coerce")
    a["humidity"] = pd.to_numeric(a["humidity"], errors="coerce")
    a = a[a["temperature"].between(-20, 60) & a["humidity"].between(0, 100)]
    t = pd.to_datetime(a["time"], utc=True).dt.tz_localize(None) + pd.Timedelta(hours=2)
    a = a.assign(hour=t.dt.floor("h"))
    hourly = a.groupby(["hour", "dev_eui"])[["temperature", "humidity"]].mean().groupby("hour").mean()
    hourly["thi"] = hourly["temperature"] - (0.31 - 0.31 * hourly["humidity"] / 100) * (hourly["temperature"] - 14.4)
    day = hourly.index.floor("D")
    d = hourly.groupby(day)["thi"].agg(thi_mean="mean", thi_max="max", sensor_hours="size")
    d["hot_hours"] = (hourly["thi"] >= THI_HOT).groupby(day).sum()
    return d


def fill_short_gaps(s: pd.Series, max_gap: int = MAX_GAP_FILL) -> pd.Series:
    """Linear interpolation only inside NaN runs of length <= max_gap (long gaps stay NaN)."""
    isna = s.isna()
    run = (isna != isna.shift()).cumsum()
    run_len = isna.groupby(run).transform("sum")
    return s.where(~(isna & (run_len <= max_gap)), s.interpolate(limit_area="inside"))


def build_calendar(log, houses, clim, std_weeks, std_vals):
    h = houses.copy()
    h.columns = [c.strip() for c in h.columns]
    row = h[h["house_id"].astype(str).str.strip().str.lower() == HOUSE]
    info = dict(HOUSE_DEFAULTS)
    if len(row):
        info = {"start_date": str(row.iloc[0]["start_date"]).strip(),
                "start_age_days": int(float(row.iloc[0]["start_age_days"])),
                "starting_hens": int(float(row.iloc[0]["starting_hens"]))}
    placed = pd.Timestamp(info["start_date"])

    d = log[log["house"].astype(str).str.strip().str.lower() == HOUSE].copy()
    d["date"] = pd.to_datetime(d["date"].astype(str).str.strip(), errors="coerce")
    d = d.dropna(subset=["date"])
    for c in COUNT_COLS:
        d[c] = pd.to_numeric(d[c].astype(str).str.replace(",", "").str.strip(), errors="coerce").fillna(0)
    d["avg_egg_weight_g"] = pd.to_numeric(d.get("avg_egg_weight_g"), errors="coerce")
    g = d.groupby("date").agg(**{c: (c, "sum") for c in COUNT_COLS},
                              avg_egg_weight_g=("avg_egg_weight_g", "mean"), log_rows=("house", "size"))
    g["eggs"] = g[EGG_COLS].sum(axis=1)
    # Same as the app (analytics/series route + agentTools): cumulative mortality includes the same day.
    g["live_hens"] = (info["starting_hens"] - g["mortality"].cumsum()).clip(lower=1)
    g["hped"] = g["eggs"] / g["live_hens"] * 100

    as_of = g.index[g["eggs"] > 0].max()
    g = g.loc[:as_of]
    first_egg = g.index[g["eggs"] > 0].min()
    onset_end = first_egg + pd.Timedelta(days=ONSET_DAYS)

    # ---- transparent exclusions (fitting only; every day stays in the history output)
    reason = pd.Series("", index=g.index, dtype=object)
    cat = pd.Series("", index=g.index, dtype=object)
    reason[g.index < onset_end], cat[g.index < onset_end] = ONSET_REASON, "onset"
    post = g.index >= onset_end
    m = post & (g["hped"] > 100)
    reason[m], cat[m] = "above 100% of live hens (eggs likely carried over from another day)", "over100"
    m = post & (g["hped"] < LOW_FLOOR)
    reason[m], cat[m] = f"below {LOW_FLOOR:.0f}% (logging gap / partial count)", "low"
    clean = g["hped"].where(reason == "")
    for day in g.index[post & (reason == "")]:
        nb = clean[(clean.index >= day - 3 * DAY) & (clean.index <= day + 3 * DAY) & (clean.index != day)].dropna()
        # Isolated = the adjacent days are not low too (a multi-day dip is treated as a real event and kept).
        adj = [clean.get(day - DAY, np.nan), clean.get(day + DAY, np.nan)]
        isolated = all(np.isnan(v) or v >= nb.median() - DIP_PTS / 2 for v in adj)
        if len(nb) >= 3 and isolated and g.at[day, "hped"] < nb.median() - DIP_PTS:
            reason[day] = (f"single-day count {nb.median() - g.at[day, 'hped']:.1f} pts below neighbouring days "
                           "(likely partial count)")
            cat[day] = "dip"
    g["reason"] = reason
    g["reason_cat"] = cat
    g["excluded"] = reason != ""
    ok = ~g["excluded"] & (g["eggs"] > 0)
    # Regressor bases. Damaged == 0 on a laying day is treated as "not recorded" (the farm logs 20-80 a day).
    g["damaged_pct"] = (g["damaged"] / g["eggs"] * 100).where(ok & (g["damaged"] > 0))
    g["large_share"] = ((g["large"] + g["xl"] + g["j"]) / g["eggs"] * 100).where(ok)
    g["damaged_zero"] = (g["eggs"] > 0) & (g["damaged"] == 0) & (g.index >= onset_end)

    idx = pd.date_range(g.index.min(), as_of + HORIZON * DAY)
    cal = g.reindex(idx)
    cal["has_log"] = cal["eggs"].notna()
    cal["excluded"] = cal["excluded"].fillna(False).astype(bool)
    cal["reason"] = cal["reason"].fillna("")
    cal["reason_cat"] = cal["reason_cat"].fillna("")
    age = info["start_age_days"] + (cal.index - placed).days
    cal["week"] = np.floor(age / 7).astype(int)
    cal["standard"] = np.interp(cal["week"], std_weeks, std_vals)   # clamps at the ends like interpolate()
    cal["t_days"] = (cal.index - first_egg).days

    c = clim.copy()
    valid = c["sensor_hours"] >= MIN_SENSOR_HOURS
    c.loc[~valid, ["thi_mean", "thi_max"]] = np.nan
    climate_idx = pd.date_range(min(idx.min(), c.index.min()), max(idx.max(), c.index.max()))
    c = c.reindex(climate_idx)
    cal_clim = pd.DataFrame({k: fill_short_gaps(c[k]) for k in ["thi_mean", "thi_max"]})
    cal_clim["sensor_hours"] = c["sensor_hours"]
    cal_clim["hot_hours"] = c["hot_hours"]
    meta = {"info": info, "placed": placed, "as_of": as_of, "first_egg": first_egg, "onset_end": onset_end,
            "egg_days": int((g["eggs"] > 0).sum()), "log_days": int(len(g))}
    return cal, cal_clim, meta


def regressors_asof(cal: pd.DataFrame, clim: pd.DataFrame, cutoff: pd.Timestamp, end: pd.Timestamp):
    """Lagged regressors as they would be known when forecasting from `cutoff`.

    Egg-log features: actual values up to the cutoff; after it they are held at the last-14-day mean
    (so day 1 of the horizon uses the known cutoff-day value via the 1-day lag).
    THI: actual sensor values wherever a valid day exists (sensors keep running after the last egg log);
    after the last valid sensor day, the mean of the last 14 valid sensor days.
    """
    idx = pd.date_range(cal.index.min(), end)
    egg = cal[["damaged_pct", "large_share"]].reindex(idx)
    egg.loc[egg.index > cutoff] = np.nan
    recent = egg.loc[cutoff - 13 * DAY: cutoff].mean()
    egg = egg.ffill()
    egg.loc[egg.index > cutoff] = recent.values

    thi = clim[["thi_mean", "thi_max"]].reindex(idx)
    last_valid = clim["thi_mean"].last_valid_index()
    fallback = clim.loc[last_valid - 13 * DAY: last_valid, ["thi_mean", "thi_max"]].mean()
    thi_actual = thi["thi_mean"].notna()
    after = thi.index > last_valid
    thi.loc[after] = fallback.values
    out = pd.DataFrame({
        "thi_mean_lag1": thi["thi_mean"].shift(1),
        "thi_max_lag1": thi["thi_max"].shift(1),
        "damaged_pct_lag1": egg["damaged_pct"].shift(1),
        "large_share_lag1": egg["large_share"].shift(1),
    }, index=idx)
    out["thi_is_actual"] = thi_actual.shift(1, fill_value=False) & ~pd.Series(after, index=idx).shift(1, fill_value=False)
    return out, last_valid, fallback


# --------------------------------------------------------------------------------------- models
def gompertz(t, a, b, c, d):
    return a * np.exp(-b * np.exp(-c * t)) - d * t


def fit_gompertz(cal: pd.DataFrame, cutoff: pd.Timestamp):
    """Gompertz rise with linear decline, fitted to the flock's own HPED vs days since first egg."""
    from scipy.optimize import curve_fit

    m = cal.loc[:cutoff]
    m = m[m["has_log"] & m["reason"].isin(["", ONSET_REASON]) & (m["hped"] <= 100)]
    m = m[~((m["t_days"] >= 0) & (m["eggs"] == 0))]          # zero-count days after first eggs = logging gaps
    popt, _ = curve_fit(gompertz, m["t_days"].astype(float), m["hped"].astype(float),
                        p0=[95, 20, 0.15, 0.005], bounds=([50, 0.5, 0.01, -0.05], [110, 1e4, 2, 0.2]), maxfev=50000)
    return popt


@dataclass(frozen=True)
class Variant:
    target: str   # diff | ratio | anchor_reg
    anchor: str   # standard | gompertz
    growth: str   # linear | flat
    window: str   # short (THI-complete period) | long (post-onset, THI mean-imputed where missing)

    @property
    def name(self) -> str:
        return f"{self.target}|{self.anchor}|{self.growth}|{self.window}"


def anchor_series(cal, variant: Variant, cutoff) -> pd.Series:
    if variant.anchor == "standard":
        return cal["standard"]
    popt = fit_gompertz(cal, cutoff)
    return pd.Series(gompertz(cal["t_days"].astype(float).values, *popt), index=cal.index)


def short_window_start(regs: pd.DataFrame, cutoff) -> pd.Timestamp:
    r = regs.loc[:cutoff, THI_KEYS]
    nan_days = r.index[r.isna().any(axis=1)]
    return nan_days.max() + DAY


def fit_predict(cal, clim, meta, variant: Variant, cutoff, predict_dates, uncertainty: bool, seed: int = 0):
    end = max(predict_dates.max(), cutoff)
    regs, _, _ = regressors_asof(cal, clim, cutoff, end)
    anchor = anchor_series(cal, variant, cutoff).reindex(regs.index)
    start = short_window_start(regs, cutoff) if variant.window == "short" else meta["onset_end"]

    rows = cal.loc[start:cutoff]
    rows = rows[rows["has_log"] & ~rows["excluded"]]
    X = regs.loc[rows.index, REG_KEYS].copy()
    thi_means = X[THI_KEYS].mean()
    X[THI_KEYS] = X[THI_KEYS].fillna(thi_means)          # long window only: mean-imputed = zero contribution
    train_means = X.mean()
    X = X.fillna(train_means)                             # rare first-day gaps in the egg-log lags
    a = anchor.loc[rows.index]
    if variant.target == "diff":
        y = rows["hped"] - a
    elif variant.target == "ratio":
        y = rows["hped"] / a
    else:
        y = rows["hped"]
    train = pd.DataFrame({"ds": rows.index, "y": y.values}, index=rows.index).join(X)
    if variant.target == "anchor_reg":
        train["anchor"] = a.values

    m = Prophet(growth=variant.growth, yearly_seasonality=False, weekly_seasonality=True, daily_seasonality=False,
                changepoint_prior_scale=0.05, interval_width=0.8, uncertainty_samples=1000 if uncertainty else 0)
    for k in REG_KEYS:
        m.add_regressor(k)
    if variant.target == "anchor_reg":
        m.add_regressor("anchor")
    m.fit(train.reset_index(drop=True))

    fut = pd.DataFrame({"ds": predict_dates}, index=predict_dates).join(regs.loc[predict_dates, REG_KEYS])
    fut[REG_KEYS] = fut[REG_KEYS].fillna(train_means)     # in-sample rows only; future rows are always filled
    if variant.target == "anchor_reg":
        fut["anchor"] = anchor.loc[predict_dates].values
    np.random.seed(seed)
    fc = m.predict(fut.reset_index(drop=True))
    fc.index = predict_dates
    a_pred = anchor.loc[predict_dates]

    def to_hped(v):
        if variant.target == "diff":
            return v + a_pred.values
        if variant.target == "ratio":
            return v * a_pred.values
        return v

    out = pd.DataFrame(index=predict_dates)
    out["yhat"] = to_hped(fc["yhat"].values)
    if uncertainty:
        out["lower"] = to_hped(fc["yhat_lower"].values)
        out["upper"] = to_hped(fc["yhat_upper"].values)
    for k in REG_KEYS:                                   # additive components -> HPED points
        comp = fc[k].values
        out[f"c_{k}"] = comp * a_pred.values if variant.target == "ratio" else comp
    out["anchor"] = a_pred.values
    info = {"train_start": start, "train_rows": len(train), "regs": regs, "model": m}
    return out, info


def score(pred: pd.Series, actual: pd.Series) -> tuple[float, float]:
    err = (pred - actual).abs()
    return float(err.mean()), float((err / actual).mean() * 100)


def test_dates(cal, cutoff):
    w = cal.loc[cutoff + DAY: cutoff + HORIZON * DAY]
    return w.index[w["has_log"] & ~w["excluded"]]


def baselines(cal, cutoff, dates):
    hist = cal.loc[cutoff - 27 * DAY: cutoff]
    hist = hist[hist["has_log"] & ~hist["excluded"]]
    ratio = (hist["hped"] / hist["standard"]).mean()
    last7 = cal.loc[cutoff - 6 * DAY: cutoff]
    last7 = last7[last7["has_log"] & ~last7["excluded"]]["hped"].mean()
    actual = cal.loc[dates, "hped"]
    b1 = cal.loc[dates, "standard"] * ratio
    b2 = pd.Series(last7, index=dates)
    return {"Breed standard × recent ratio": score(b1, actual), "Last 7-day mean": score(b2, actual)}, b1, b2


# ------------------------------------------------------------------------------------------ plot
def make_plot(cal, meta, hist_fit, fc, bt_pred, bt_cutoff, gomp_curve, variant, path):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.dates as mdates
    import matplotlib.pyplot as plt

    INK, INK2, GRID = "#0b0b0b", "#52514e", "#e4e3df"
    BLUE, ORANGE, AQUA, YELLOW, VIOLET = "#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#4a3aa7"
    as_of = meta["as_of"]
    obs = cal[cal["has_log"]]
    inc, exc = obs[~obs["excluded"]], obs[obs["excluded"]]

    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(13, 9.5), gridspec_kw={"height_ratios": [1, 1.15]})
    for ax in (ax1, ax2):
        ax.set_facecolor("#fcfcfb")
        ax.grid(axis="y", color=GRID, lw=0.8)
        ax.spines[["top", "right"]].set_visible(False)
        ax.spines[["left", "bottom"]].set_color(INK2)
        ax.tick_params(colors=INK2, labelsize=9)

    lo, hi = 55, 106
    x0 = meta["onset_end"] - 21 * DAY
    sl = slice(x0, fc.index.max())
    ax1.plot(cal.loc[sl].index, cal.loc[sl, "standard"], color=AQUA, lw=2, ls="--", label="Breed standard (generic)")
    if gomp_curve is not None:
        ax1.plot(gomp_curve.loc[sl].index, gomp_curve.loc[sl], color=VIOLET, lw=1.5, ls=":", label="Own-flock Gompertz curve")
    ax1.scatter(inc.loc[x0:].index, inc.loc[x0:, "hped"], s=9, color=INK2, alpha=0.75, label="Actual HPED (DailyLog)", zorder=3)
    e = exc.loc[x0:]
    ax1.scatter(e.index, e["hped"].clip(lo + 1, hi - 1), s=22, marker="x", color=INK, lw=1,
                label="Excluded from fitting (values clipped to axis)", zorder=3)
    ax1.plot(hist_fit.index, hist_fit["yhat"], color=BLUE, lw=1.4, label="Model fit (training window)")
    ax1.plot(fc.index, fc["yhat"], color=ORANGE, lw=2, label="Forecast")
    ax1.fill_between(fc.index, fc["lower"], fc["upper"], color=ORANGE, alpha=0.18, lw=0)
    ax1.set_ylim(lo, hi)
    ax1.set_ylabel("Hen-day egg production (%)", color=INK2)
    ax1.set_title(f"House 1 egg production since lay onset, with 28-day forecast from {as_of:%d %b %Y}",
                  loc="left", fontsize=12, color=INK)
    ax1.legend(loc="lower right", fontsize=8, ncol=3, frameon=False)
    ax1.xaxis.set_major_formatter(mdates.DateFormatter("%b %Y"))

    z0 = as_of - (HISTORY_DAYS - 1) * DAY
    zi = inc.loc[z0:]
    ze = exc.loc[z0:]
    ax2.axvspan(bt_cutoff + 0.5 * DAY, as_of + 0.5 * DAY, color="#f0efec", zorder=0)
    ax2.text(bt_cutoff + 1.5 * DAY, 100.6, "Backtest window\n(model fitted only up to the cutoff)", fontsize=8, color=INK2, va="top")
    ax2.plot(cal.loc[z0:fc.index.max()].index, cal.loc[z0:fc.index.max(), "standard"], color=AQUA, lw=2, ls="--",
             label="Breed standard (generic)")
    ax2.plot(hist_fit.loc[z0:].index, hist_fit.loc[z0:, "yhat"], color=BLUE, lw=1.6, label="Model fit")
    ax2.plot(bt_pred.index, bt_pred.values, color=YELLOW, lw=2, label="Backtest forecast (from cutoff)")
    ax2.scatter(zi.index, zi["hped"], s=14, color=INK2, label="Actual HPED (DailyLog)", zorder=4)
    ax2.scatter(ze.index, ze["hped"].clip(lo + 1, hi - 1), s=30, marker="x", color=INK, lw=1.2,
                label="Excluded from fitting", zorder=4)
    ax2.plot(fc.index, fc["yhat"], color=ORANGE, lw=2.2, label="Forecast (80% interval shaded)")
    ax2.fill_between(fc.index, fc["lower"], fc["upper"], color=ORANGE, alpha=0.2, lw=0)
    ax2.axvline(as_of + 0.5 * DAY, color=INK2, lw=1, ls="-")
    ax2.text(as_of + 1 * DAY, 57, f"as_of {as_of:%d %b}\n(last DailyLog egg day)", fontsize=8, color=INK2)
    ax2.set_ylim(lo, 101)
    ax2.set_ylabel("Hen-day egg production (%)", color=INK2)
    ax2.set_title(f"Last {HISTORY_DAYS} days and forecast (model: {variant.name})", loc="left", fontsize=12, color=INK)
    ax2.legend(loc="lower left", fontsize=8, ncol=3, frameon=False)
    ax2.xaxis.set_major_formatter(mdates.DateFormatter("%d %b"))
    fig.text(0.01, 0.005, "FORECAST - manual DailyLog egg counts only (camera counts not used). Breed standard is a generic layer curve.",
             fontsize=8, color=INK2)
    fig.tight_layout(rect=(0, 0.02, 1, 1))
    fig.savefig(path, dpi=130)
    plt.close(fig)


# ------------------------------------------------------------------------------------------ main
def r2(v):
    return None if v is None or (isinstance(v, float) and not np.isfinite(v)) else round(float(v), 2)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true", help="reuse local cache instead of reading the sheet / S3")
    args = ap.parse_args()

    log, houses, am, sources = load_inputs(args.offline)
    std_weeks, std_vals = load_standard()
    clim_daily = daily_climate(am)
    cal, clim, meta = build_calendar(log, houses, clim_daily, std_weeks, std_vals)
    as_of = meta["as_of"]
    print(f"as_of {as_of:%Y-%m-%d}; {meta['egg_days']} egg days; DailyLog source: {sources['daily_log']}")
    print(f"climate: {clim_daily.index.min():%Y-%m-%d}..{clim_daily.index.max():%Y-%m-%d}, max hot hours/day = {int(clim_daily['hot_hours'].max())}")

    # ---- backtests: select on two earlier windows, report the as_of-28 window as an untouched holdout
    holdout = as_of - HORIZON * DAY
    select_cutoffs = [as_of - 3 * HORIZON * DAY, as_of - 2 * HORIZON * DAY]
    variants = [Variant(t, a, g, w) for t in ["diff", "ratio", "anchor_reg"] for a in ["standard", "gompertz"]
                for g in ["linear", "flat"] for w in ["short", "long"]]
    records = []
    for cutoff in [*select_cutoffs, holdout]:
        dates = test_dates(cal, cutoff)
        actual = cal.loc[dates, "hped"]
        base, _, _ = baselines(cal, cutoff, dates)
        for bname, (mae, mape) in base.items():
            records.append({"cutoff": cutoff.date(), "variant": f"baseline: {bname}", "mae_pts": mae, "mape_pct": mape})
        for v in variants:
            pred, _ = fit_predict(cal, clim, meta, v, cutoff, dates, uncertainty=False)
            mae, mape = score(pred["yhat"], actual)
            records.append({"cutoff": cutoff.date(), "variant": v.name, "mae_pts": mae, "mape_pct": mape})
    bt = pd.DataFrame(records)
    wide = bt.pivot(index="variant", columns="cutoff", values="mae_pts")
    sel_cols = [c.date() for c in select_cutoffs]
    wide["selection_mean_mae"] = wide[sel_cols].mean(axis=1)
    wide = wide.sort_values("selection_mean_mae")
    wide.round(3).to_csv(VARIANTS_OUT)
    print(wide.round(2).to_string())
    model_rows = wide[~wide.index.str.startswith("baseline")]
    best = model_rows.index[0]
    chosen = next(v for v in variants if v.name == best)
    print(f"chosen variant: {chosen.name}")

    # ---- headline backtest (holdout)
    h_dates = test_dates(cal, holdout)
    h_actual = cal.loc[h_dates, "hped"]
    bt_pred, _ = fit_predict(cal, clim, meta, chosen, holdout, h_dates, uncertainty=False)
    bt_mae, bt_mape = score(bt_pred["yhat"], h_actual)
    bt_bias = float((bt_pred["yhat"] - h_actual).mean())
    base, _, _ = baselines(cal, holdout, h_dates)
    gomp_std = [v for v in variants if v.anchor == "gompertz"]
    best_gomp = model_rows.loc[[v.name for v in gomp_std]].sort_values("selection_mean_mae").index[0]
    best_std = model_rows.loc[[v.name for v in variants if v.anchor == "standard"]].sort_values("selection_mean_mae").index[0]

    # ---- final fit through as_of
    hist_dates = cal.loc[as_of - (HISTORY_DAYS - 1) * DAY: as_of]
    hist_dates = hist_dates.index[hist_dates["has_log"]]
    fc_dates = pd.date_range(as_of + DAY, as_of + HORIZON * DAY)
    probe, info = fit_predict(cal, clim, meta, chosen, as_of, fc_dates, uncertainty=False)
    train_start = info["train_start"]
    fit_dates = cal.loc[train_start:as_of]
    fit_dates = fit_dates.index[fit_dates["has_log"]]
    all_dates = fit_dates.append(fc_dates)
    final, info = fit_predict(cal, clim, meta, chosen, as_of, all_dates, uncertainty=True)
    regs = info["regs"]
    hist_fit = final.loc[fit_dates]
    fc = final.loc[fc_dates].copy()
    fc["lower"] = fc["lower"].clip(0, 100)
    fc["upper"] = fc["upper"].clip(0, 100)

    # ---- drivers over the forecast horizon
    drivers = [{"key": k, "label": REG_LABEL[k], "contribution_pts": r2(fc[f"c_{k}"].mean())} for k in REG_KEYS]

    # ---- recent drops: actual vs model baseline (fitted with drivers at their training-average level)
    win = hist_fit.loc[as_of - (DROP_WINDOW - 1) * DAY: as_of].copy()
    win = win.join(cal[["hped", "excluded"]])
    win = win[~win["excluded"]]
    win["drivers_sum"] = win[[f"c_{k}" for k in REG_KEYS]].sum(axis=1)
    win["expected"] = win["yhat"] - win["drivers_sum"]
    win["gap"] = win["hped"] - win["expected"]
    chosen_days: list[pd.Timestamp] = []
    for day in win.sort_values("gap").index:
        if all(abs((day - c).days) > 1 for c in chosen_days):
            chosen_days.append(day)
        if len(chosen_days) == 3:
            break
    recent_drops = []
    for day in sorted(chosen_days):
        r = win.loc[day]
        dl = [{"label": REG_LABEL[k], "contribution_pts": r2(r[f"c_{k}"])} for k in REG_KEYS]
        dl.append({"label": "Not explained by these drivers", "contribution_pts": r2(r["gap"] - r["drivers_sum"])})
        recent_drops.append({"date": f"{day:%Y-%m-%d}", "hped": r2(r["hped"]), "expected": r2(r["expected"]),
                             "drop_pts": r2(r["gap"]), "drivers": dl})

    # ---- history + forecast rows
    history = [{"date": f"{d:%Y-%m-%d}", "hped": r2(cal.at[d, "hped"]), "standard": r2(cal.at[d, "standard"]),
                "fitted": r2(final.at[d, "yhat"]) if d in final.index else None, "week": int(cal.at[d, "week"]),
                "excluded": bool(cal.at[d, "excluded"])} for d in hist_dates]
    forecast = [{"date": f"{d:%Y-%m-%d}", "hped": r2(fc.at[d, "yhat"]), "lower": r2(fc.at[d, "lower"]),
                 "upper": r2(fc.at[d, "upper"]), "standard": r2(cal.at[d, "standard"]), "week": int(cal.at[d, "week"])}
                for d in fc_dates]

    # ---- notes
    logged = cal[cal["has_log"]]
    excl = logged[logged["excluded"]]
    post_excl = excl[excl["reason"] != ONSET_REASON]
    missing_days = [f"{d:%Y-%m-%d}" for d in cal.loc[meta["first_egg"]:as_of].index[~cal.loc[meta["first_egg"]:as_of, "has_log"]]]
    used_rows = cal.loc[train_start:as_of]
    used_rows = used_rows[used_rows["has_log"] & ~used_rows["excluded"]]
    fc_regs = regs.loc[fc_dates]
    thi_actual_days = int(fc_regs["thi_is_actual"].sum())
    last_thi = clim["thi_mean"].last_valid_index()
    dmg_zero = logged[logged["damaged_zero"]].index
    target_txt = {"diff": "HPED minus {a} (percentage points)", "ratio": "HPED divided by {a}",
                  "anchor_reg": "HPED (%) with {a} as a regressor"}[chosen.target]
    anchor_txt = "the generic breed standard" if chosen.anchor == "standard" else "the flock's own Gompertz curve"
    def fmt_days(ix):
        return ", ".join(f"{d:%Y-%m-%d} ({cal.at[d, 'hped']:.1f}%)" for d in ix)
    cat_text = {"low": f"below {LOW_FLOOR:.0f}%, a logging gap or partial count",
                "over100": "above 100% of live hens, likely eggs carried over from another day",
                "dip": f"a single-day count more than {DIP_PTS:.0f} points below the days around it, likely a partial count"}
    excl_lines = "; ".join(f"{len(ix)} day{'s' if len(ix) != 1 else ''} {cat_text[c]}: {fmt_days(ix)}"
                           for c in ["low", "over100", "dip"]
                           if len(ix := post_excl.index[post_excl['reason_cat'] == c]))
    thi_train = clim.loc[train_start:as_of]
    notes = [
        f"This is a forecast, not a measurement. It uses only the farm's manual DailyLog egg counts up to {as_of:%Y-%m-%d} "
        f"(the last day with eggs logged). Camera egg counts are not used.",
        f"HPED = (small + medium + large + XL + jumbo) / live hens × 100, the same formula as the app (damaged eggs are not "
        f"counted in the total). Live hens = {meta['info']['starting_hens']:,} starting hens minus cumulative DailyLog mortality.",
        f"The model was trained on {len(used_rows)} logged days from {train_start:%Y-%m-%d} to {as_of:%Y-%m-%d}. "
        f"{'Earlier days were left out because the shed climate sensors have no data from 2026-02-26 to 2026-04-13. ' if chosen.window == 'short' else 'Shed sensors have no data before 2026-02-20 or from 2026-02-26 to 2026-04-13. On those days THI was set to its average, so it adds nothing there. '}"
        f"In total {meta['egg_days']} DailyLog days with eggs exist since first eggs on {meta['first_egg']:%Y-%m-%d}.",
        f"The first {ONSET_DAYS} days of lay (to {meta['onset_end'] - DAY:%Y-%m-%d}) are excluded from fitting. Other excluded "
        f"days, kept in the history and flagged: {excl_lines}.",
        (f"Dates with no DailyLog row: {', '.join(missing_days)}." if missing_days else "Every date since first eggs has a DailyLog row."),
        f"Damaged eggs were logged as 0 on {len(dmg_zero)} laying days ({', '.join(f'{d:%Y-%m-%d}' for d in dmg_zero)}). "
        f"These are treated as not recorded, and the cracked % regressor carries the previous day's value forward.",
        f"All regressors are lagged by one day so they are known when the forecast is made. Over the forecast, shed THI uses actual "
        f"sensor readings where they exist ({thi_actual_days} of {HORIZON} forecast days; sensors run to {last_thi:%Y-%m-%d}) and the "
        f"mean of the last 14 sensor days otherwise. Cracked % and size mix are held at their last-14-day means.",
        f"Shed THI never reached the {THI_HOT} °C-eq heat-stress level in the training period (maximum daily peak "
        f"{thi_train['thi_max'].max():.1f}). The THI effects therefore describe cooler versus milder days, not heat stress, so the "
        f"model cannot yet say how a hot spell would affect lay.",
        "Driver contributions come straight from the model's additive components, so SHAP is not needed. Each value is measured "
        "against that driver's average level in the training period, so 0 means an average day.",
        "For recent drops, 'expected' is the model baseline for that day: the anchor, trend and weekday pattern with every driver "
        "at its average. drop_pts = actual − expected. It splits into the listed driver contributions plus the part the model "
        "does not explain.",
        f"Model choice: {len(variants)} variants (target, anchor, trend, training window) were scored on two earlier 28-day "
        f"backtests (cutoffs {select_cutoffs[0]:%Y-%m-%d} and {select_cutoffs[1]:%Y-%m-%d}). The reported backtest "
        f"(cutoff {holdout:%Y-%m-%d}) was not used for the choice. It is a single 28-day window, so treat the error as indicative.",
        "The breed standard (src/lib/henStandard.ts) is a generic layer curve, not this breed's exact curve. This flock has run "
        f"well above it (recent gap about {(logged.loc[as_of - 27 * DAY:as_of, 'hped'] - logged.loc[as_of - 27 * DAY:as_of, 'standard']).mean():.1f} points).",
        "The 80% interval reflects day-to-day noise and trend uncertainty seen in training. It does not cover events the model "
        "has not seen, such as disease, a feed change, a lighting change or a counting error.",
    ]
    naive_mae = base["Last 7-day mean"][0]
    std_mae = base["Breed standard × recent ratio"][0]
    notes.insert(1, (
        f"Accuracy, stated plainly: in the latest backtest (cutoff {holdout:%Y-%m-%d}) the model's average error was "
        f"{bt_mae:.2f} points. It {'beat' if bt_mae < std_mae else 'did not beat'} the breed-standard baseline "
        f"({std_mae:.2f}) and {'beat' if bt_mae < naive_mae else 'did not beat'} the simple last-7-day mean ({naive_mae:.2f}). "
        f"The model {'over' if bt_bias > 0 else 'under'}-predicted by {abs(bt_bias):.1f} points on average in that window. "
        "Lay has been flat for months, so a recent average is hard to beat over 28 days. The model's value is the breed-curve "
        "context, the interval and the driver breakdown, not better accuracy."))
    tr_c = hist_fit[[f"c_{k}" for k in REG_KEYS]]
    dmg_top = tr_c["c_damaged_pct_lag1"].idxmin()
    notes.append(
        f"The cracked-egg effect rests mostly on one event. Cracked eggs reached "
        f"{cal.at[dmg_top - DAY, 'damaged_pct']:.1f}% on {dmg_top - DAY:%Y-%m-%d} and lay fell to "
        f"{cal.at[dmg_top, 'hped']:.1f}% the next day. Read its contribution as indicative only.")
    notes.append(
        "There is only one autumn-winter-spring of climate data, so the THI effect is mixed up with season (for example "
        "day length and the flock's age). Lay dipped in midwinter and recovered as the shed warmed. The model credits that "
        "recovery to milder THI, but this is an association, not a proven cause.")

    out = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "farm_id": FARM_ID,
        "house_id": HOUSE,
        "as_of": f"{as_of:%Y-%m-%d}",
        "model": {
            "name": f"Prophet + {'breed-standard' if chosen.anchor == 'standard' else 'own-flock Gompertz'} anchor",
            "description": (f"Prophet forecasts how far daily lay sits from {anchor_txt}, with a "
                            f"{'flat' if chosen.growth == 'flat' else 'slowly changing'} trend, a weekday pattern and "
                            "previous-day shed climate and egg-quality drivers. The anchor is then added back to give HPED."),
            "target": target_txt.format(a="breed standard" if chosen.anchor == "standard" else "own-flock Gompertz curve"),
            "regressors": REGRESSORS,
        },
        "backtest": {
            "cutoff": f"{holdout:%Y-%m-%d}", "horizon_days": HORIZON, "mae_pts": r2(bt_mae), "mape_pct": r2(bt_mape),
            "baselines": [{"name": n, "mae_pts": r2(v[0])} for n, v in base.items()],
        },
        "history": history,
        "forecast": forecast,
        "drivers": drivers,
        "recent_drops": recent_drops,
        "notes": notes,
    }
    JSON_OUT.parent.mkdir(parents=True, exist_ok=True)
    JSON_OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")

    # ---- plot
    gomp_popt = fit_gompertz(cal, as_of)
    gomp_curve = pd.Series(gompertz(cal["t_days"].astype(float).values, *gomp_popt), index=cal.index)
    make_plot(cal, meta, hist_fit, fc, bt_pred["yhat"], holdout, gomp_curve, chosen, PNG_OUT)

    # ---- console summary for the README
    print("\n=== summary ===")
    print(f"as_of={as_of:%Y-%m-%d} train={train_start:%Y-%m-%d}..{as_of:%Y-%m-%d} rows={len(used_rows)} variant={chosen.name}")
    print(f"holdout cutoff {holdout:%Y-%m-%d}: model MAE {bt_mae:.2f} MAPE {bt_mape:.2f} bias {bt_bias:+.2f}; " +
          "; ".join(f"{n} MAE {v[0]:.2f} MAPE {v[1]:.2f}" for n, v in base.items()))
    print(f"best standard-anchor variant (selection): {best_std}; best Gompertz-anchor variant: {best_gomp}")
    print(f"Gompertz params a,b,c,d = {np.round(gomp_popt, 4).tolist()}")
    from prophet.utilities import regressor_coefficients
    coefs = regressor_coefficients(info["model"])
    scale = float(cal.loc[train_start:as_of, "standard"].mean()) if chosen.target == "ratio" else 1.0
    coefs["pts_per_unit_approx"] = coefs["coef"] * scale
    print("regressor coefficients (pts per unit ~ coef x mean anchor for ratio target):")
    print(coefs[["regressor", "center", "coef", "pts_per_unit_approx"]].round(4).to_string(index=False))
    tr = hist_fit.join(cal[["hped", "excluded"]])
    for k in REG_KEYS:
        top = tr[f"c_{k}"].abs().sort_values(ascending=False).head(3)
        print(f"  largest |{k}| contributions in training:",
              ", ".join(f"{d:%Y-%m-%d} {tr.at[d, f'c_{k}']:+.2f}" for d in top.index))
    print("excluded days:", "; ".join(f"{d:%Y-%m-%d} {cal.at[d, 'hped']:.1f} [{cal.at[d, 'reason_cat']}]" for d in post_excl.index))
    print("drivers:", json.dumps(drivers))
    print("recent drops:", json.dumps(recent_drops, indent=1))
    print("forecast first/last:", forecast[0], forecast[-1])
    print("mean forecast HPED:", round(float(fc["yhat"].mean()), 2), "mean standard:", round(float(cal.loc[fc_dates, "standard"].mean()), 2))
    print(f"wrote {JSON_OUT} ({JSON_OUT.stat().st_size / 1024:.1f} KB), {PNG_OUT}, {VARIANTS_OUT}")


if __name__ == "__main__":
    main()
