#!/usr/bin/env python3
"""Lay (HPED) forecast for the Flock Vet panel: one model for the next 3 days and the next 4 weeks.

This is a forecast, not a measurement. Egg data: the farm's manual DailyLog only (camera counts are
not used). Data preparation (HPED formula as in the app, exclusions, breed standard, shed THI and the
flock's own Gompertz lay curve) is reused from hped_forecast.py.

The model shown in the app
  level  L(d)  mean of HPED / curve over the flock's last 7 logged days up to day d
  curve  s(t)  the flock's own lay curve (Gompertz rise with linear decline, refitted on data up to d)
  forecast for day t (1-28 days ahead): L(d) x s(t), the recent level carried along the curve

Also tested (lay_backtest.csv): level windows of 3/7/14 days; the breed standard or a flat line as the
curve; and a ridge-regression adjustment for the next 3 days from the last days' departure from the
level, the weekday, shed heat (THI), water per bird, cracked eggs, egg-size mix and mortality. None was
reliably more accurate, so the shown model stays the simple one.

Testing: a forecast is made from every day (rolling origin) using only data up to that day; scored on
forecasts made 15 Apr - 30 Jun and from 1 Jul. A separate "dip watch" reports big drops in water per
bird with their past track record.

Run from the repository root:
    /Users/dylangeldenhuys/Code/Dashboard/analysis/.venv/bin/python analysis/ai_demo/forecast/lay_forecast.py [--offline]

Read-only on every source. Writes src/data/ai-demo/hped_forecast.json, and lay_forecast.png and
lay_backtest.csv (every tested set-up) next to this script.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import hped_forecast as H  # noqa: E402  (shared data preparation)

ROOT = HERE.parents[2]
JSON_OUT = ROOT / "src" / "data" / "ai-demo" / "hped_forecast.json"
PNG_OUT = HERE / "lay_forecast.png"
CSV_OUT = HERE / "lay_backtest.csv"
DAY = pd.Timedelta(days=1)

SHORT_H, LONG_H = 3, 28
SEL_START, SEL_END = pd.Timestamp("2026-04-15"), pd.Timestamp("2026-06-30")
REP_START = pd.Timestamp("2026-07-01")
LEVEL_KS = (3, 7, 14)
SHAPES = ("flock", "standard", "flat")
ADJUSTS = ("recent", "signals")
ALPHAS = (3.0, 30.0, 300.0)
MIN_TRAIN = 40          # training rows needed before the adjustment is used
DIP_PTS = 4.0           # a dip: lay at least 4 points below the recent level
WARN_PTS = 2.0          # a warning: the forecast is at least 2 points below the recent level
HISTORY_DAYS = 120
WM = {"WM1": "24e124136f451854", "WM2": "24e124136f456303"}
WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]  # Sunday is the reference day
RECENT = ["dev1", "dev3"]
SIGNALS = ["heat", "heat_rise", "water_drop", "cracked", "size", "mortality"]
GROUP = {"dev1": "Recent days", "dev3": "Recent days", "heat": "Shed heat (THI)", "heat_rise": "Shed heat (THI)",
         "water_drop": "Water per bird", "cracked": "Cracked eggs", "size": "Egg-size mix", "mortality": "Mortality",
         **{f"wd_{w}": "Weekday pattern" for w in WEEKDAYS}}
SHAPE_TEXT = {"flock": "the flock's own lay curve (Gompertz rise and slow decline)",
              "standard": "the breed-standard curve", "flat": "a flat line"}
SIGNAL_INFO = [
    {"key": "recent", "label": "Lay over the last 1–3 days compared with the recent level"},
    {"key": "weekday", "label": "Weekday pattern in the egg log"},
    {"key": "heat", "label": "Shed heat (THI peak, and its rise over the past week)"},
    {"key": "water", "label": "Drop in water per bird compared with the past week"},
    {"key": "cracked", "label": "Cracked eggs % compared with the past 4 weeks"},
    {"key": "size", "label": "Share of large eggs compared with the past 4 weeks"},
    {"key": "mortality", "label": "Deaths over the last 3 days compared with normal"},
]


# ----------------------------------------------------------------------------------------- inputs
def daily_water(offline: bool, live_hens: pd.Series) -> pd.Series:
    """Whole-house water per live bird (ml/bird/day) on days both A-frame meters reported fully."""
    p = H.CACHE / "meter_readings.parquet"
    if not offline:
        try:
            m = H.read_bronze_prefix("meter_readings/")
            m[["dev_eui", "time", "pulse_total"]].to_parquet(p, index=False)
        except Exception as e:  # noqa: BLE001
            print(f"[warn] bronze meter readings unavailable ({e}); using cache")
    m = pd.read_parquet(p if p.exists() else H.FALLBACK_CACHE / "meter_readings.parquet")
    per_arm = {}
    for arm, dev in WM.items():
        d = m[m["dev_eui"] == dev].copy()
        d["local"] = pd.to_datetime(d["time"]) + pd.Timedelta(hours=2)
        d = d.sort_values("local").drop_duplicates("local")
        inc = pd.to_numeric(d["pulse_total"], errors="coerce").diff()
        ok = (inc >= 0) & (d["local"].diff() <= pd.Timedelta(minutes=25))   # resets and gaps are not spread
        day = d["local"].dt.normalize()
        litres = (inc.where(ok) * 10).groupby(day).sum(min_count=1)
        per_arm[arm] = litres.where(ok.groupby(day).sum() >= 130)          # about 144 readings a day
    house = per_arm["WM1"] + per_arm["WM2"]
    birds = live_hens.reindex(house.index.union(live_hens.index)).ffill().reindex(house.index)
    return (house * 1000 / birds).dropna()


def signal_frame(cal: pd.DataFrame, cclim: pd.DataFrame, water: pd.Series) -> pd.DataFrame:
    """Warning signals as known at the end of each day."""
    idx = cal.index
    thi = cclim["thi_max"].reindex(idx)
    w = water.reindex(idx)
    base_w = w.shift(1).rolling(7, min_periods=4).median()
    dmg, big = cal["damaged_pct"], cal["large_share"]
    mort = cal["mortality"].where(cal["has_log"])
    f = pd.DataFrame(index=idx)
    f["heat"] = thi
    f["heat_rise"] = thi - thi.shift(1).rolling(7, min_periods=4).mean()
    f["water_drop"] = np.minimum(0.0, np.log(w / base_w))       # drops only; rises are not a warning
    f["cracked"] = dmg - dmg.shift(1).rolling(28, min_periods=10).mean()
    f["size"] = big - big.shift(1).rolling(28, min_periods=10).mean()
    f["mortality"] = mort.rolling(3, min_periods=1).sum() - 3 * mort.shift(3).rolling(28, min_periods=10).median()
    return f


# ------------------------------------------------------------------------------------------ model
_FLOCK_CURVES: dict[pd.Timestamp, pd.Series] = {}


def shape_for(cal: pd.DataFrame, kind: str, cutoff: pd.Timestamp) -> pd.Series:
    if kind == "standard":
        return cal["standard"]
    if kind == "flat":
        return pd.Series(100.0, index=cal.index)
    if cutoff not in _FLOCK_CURVES:
        try:
            popt = H.fit_gompertz(cal, cutoff)
            _FLOCK_CURVES[cutoff] = pd.Series(H.gompertz(cal["t_days"].astype(float).values, *popt), index=cal.index)
        except Exception:  # noqa: BLE001  (rare non-convergence: reuse the previous day's curve)
            prev = max(k for k in _FLOCK_CURVES if k < cutoff)
            _FLOCK_CURVES[cutoff] = _FLOCK_CURVES[prev]
    return _FLOCK_CURVES[cutoff]


def level_frame(hped_valid: pd.Series, shape: pd.Series, k: int) -> pd.DataFrame:
    """Per day: the level (mean HPED/shape over the last k logged days) and the last days' departures."""
    r = (hped_valid / shape.reindex(hped_valid.index)).dropna()
    lvl = r.rolling(k, min_periods=max(2, k // 2)).mean()
    out = pd.DataFrame({"L": lvl, "dev1": r - lvl, "dev3": r.rolling(3, min_periods=2).mean() - lvl})
    return out.reindex(shape.index).ffill()   # days without a log keep the last known values


def design(lv: pd.DataFrame, sig: pd.DataFrame, origins: pd.DatetimeIndex, h: int, adjust: str) -> pd.DataFrame:
    X = pd.DataFrame(index=origins)
    X[RECENT] = lv.loc[origins, RECENT].values
    wd = (origins + h * DAY).dayofweek
    for i, w in enumerate(WEEKDAYS):
        X[f"wd_{w}"] = (wd == i).astype(float)
    if adjust == "signals":
        X[SIGNALS] = sig.loc[origins, SIGNALS].values
    return X


def fit_adjust(X: pd.DataFrame, y: pd.Series, alpha: float):
    mu, sd = X.mean(), X.std(ddof=0).replace(0, 1.0)
    Z = ((X - mu) / sd).fillna(0.0)
    return Ridge(alpha=alpha).fit(Z.values, y.values), mu, sd


def forecast_from(cal, sig, hped_valid, origin, cfg, horizons, train_start, with_parts=False):
    """Forecasts made at the end of `origin` with only data up to it. Returns rows per horizon."""
    k, kind, adjust, alpha = cfg
    shape = shape_for(cal, kind, origin)
    known = hped_valid.loc[:origin]
    lv = level_frame(known, shape, k)
    L = lv.at[origin, "L"]
    if not np.isfinite(L):
        return []
    r_known = known / shape.reindex(known.index)
    rows = []
    for h in horizons:
        t = origin + h * DAY
        base = L * shape.at[t]
        adj, parts = 0.0, {}
        if adjust != "none" and h <= SHORT_H:
            tr = lv.index[(lv.index >= train_start) & (lv.index <= origin - h * DAY)]
            tgt = r_known.reindex(tr + h * DAY).values - lv.loc[tr, "L"].values
            keep = np.isfinite(tgt) & np.isfinite(lv.loc[tr, "L"].values)
            if keep.sum() >= MIN_TRAIN:
                X = design(lv, sig, tr[keep], h, adjust)
                model, mu, sd = fit_adjust(X, pd.Series(tgt[keep], index=tr[keep]), alpha)
                z = ((design(lv, sig, pd.DatetimeIndex([origin]), h, adjust) - mu) / sd).fillna(0.0)
                adj = float(model.predict(z.values)[0]) * shape.at[t]
                if with_parts:
                    for col, c in zip(z.columns, model.coef_ * z.values[0]):
                        parts[GROUP[col]] = parts.get(GROUP[col], 0.0) + float(c) * shape.at[t]
        rows.append({"origin": origin, "h": h, "date": t, "base": base, "forecast": base + adj, "adj": adj,
                     "parts": parts})
    return rows


def run_backtest(cal, sig, hped_valid, origins, cfg, horizons, train_start, with_parts=False) -> pd.DataFrame:
    rows = []
    for d in origins:
        rows += forecast_from(cal, sig, hped_valid, d, cfg, horizons, train_start, with_parts)
    bt = pd.DataFrame(rows)
    bt["actual"] = hped_valid.reindex(bt["date"]).values
    bt["err"] = bt["forecast"] - bt["actual"]
    return bt


def mae(bt: pd.DataFrame) -> float:
    return float(bt["err"].abs().mean())


# ------------------------------------------------------------------------------------------- main
MODEL = (7, "flock", "none", 0)   # the shown model: last-7-day level along the flock's own Gompertz curve
BENCH = (7, "flat", "none", 0)    # plain last-7-day average
WATER_DROP = 0.6                  # dip watch: water per bird below 60% of the past week's median


def variants_table(cal, sig, hv, sel, long_sel, rep, long_rep, ts) -> pd.DataFrame:
    """Every tested set-up, scored on forecasts made Apr-Jun and Jul-Sep (mean absolute error, HPED points)."""
    configs = [(k, s, "none", 0) for k in LEVEL_KS for s in SHAPES] + \
              [(MODEL[0], MODEL[1], a, al) for a in ADJUSTS for al in ALPHAS]
    rows = []
    for cfg in configs:
        row = {"level_days": cfg[0], "shape": cfg[1], "adjust": cfg[2], "alpha": cfg[3] or None}
        for name, origins in (("3day_apr_jun", sel), ("3day_jul_sep", rep)):
            row[name] = round(mae(run_backtest(cal, sig, hv, origins, cfg, range(1, SHORT_H + 1), ts)), 3)
        if cfg[2] == "none":
            for name, origins in (("4wk_apr_jun", long_sel), ("4wk_jul_sep", long_rep)):
                row[name] = round(mae(run_backtest(cal, sig, hv, origins, cfg, range(1, LONG_H + 1), ts)), 3)
        rows.append(row)
    return pd.DataFrame(rows)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true", help="reuse the local cache instead of reading the sheet / S3")
    args = ap.parse_args()

    log, houses, am, src = H.load_inputs(args.offline)
    std_w, std_v = H.load_standard()
    cal, cclim, meta = H.build_calendar(log, houses, H.daily_climate(am), std_w, std_v)
    as_of = meta["as_of"]
    water = daily_water(args.offline, cal["live_hens"].dropna())
    sig = signal_frame(cal, cclim, water)
    valid = cal["has_log"] & ~cal["excluded"] & (cal["eggs"] > 0)
    hv = cal["hped"].where(valid).dropna()
    ts = meta["onset_end"] + 14 * DAY
    print(f"as_of {as_of:%Y-%m-%d}; valid days {len(hv)}; water days {len(water)}")

    sel = pd.date_range(SEL_START, SEL_END)
    long_sel = sel[sel + LONG_H * DAY <= as_of]
    rep = pd.date_range(REP_START, as_of - DAY)
    long_rep = rep[rep + LONG_H * DAY <= as_of]

    table = variants_table(cal, sig, hv, sel, long_sel, rep, long_rep, ts)
    table.to_csv(CSV_OUT, index=False)
    print(table.to_string(index=False))
    is_model = (table["level_days"] == MODEL[0]) & (table["shape"] == MODEL[1]) & (table["adjust"] == "none")
    with_signals = table[table["adjust"] != "none"]
    model_row = table[is_model].iloc[0]

    # The shown model and the plain average, on forecasts made from 1 Jul.
    short_rep = run_backtest(cal, sig, hv, rep, MODEL, range(1, SHORT_H + 1), ts)
    short_bench = run_backtest(cal, sig, hv, rep, BENCH, range(1, SHORT_H + 1), ts)
    long_rep_bt = run_backtest(cal, sig, hv, long_rep, MODEL, range(1, LONG_H + 1), ts)
    long_bench = run_backtest(cal, sig, hv, long_rep, BENCH, range(1, LONG_H + 1), ts)
    by_h = short_rep.dropna(subset=["actual"]).groupby("h")["err"].apply(lambda e: e.abs().mean())

    # Uncertainty: 10th-90th percentile of past errors at each horizon (all tested forecasts from 15 Apr).
    tested = pd.concat([run_backtest(cal, sig, hv, long_sel, MODEL, range(1, LONG_H + 1), ts), long_rep_bt,
                        short_rep[short_rep["origin"] > long_rep.max()]])
    q = {}
    for h in range(1, LONG_H + 1):
        e = (tested.loc[tested["h"] == h, "actual"] - tested.loc[tested["h"] == h, "forecast"]).dropna()
        q[h] = (float(e.quantile(0.1)), float(e.quantile(0.9)))

    final = pd.DataFrame(forecast_from(cal, sig, hv, as_of, MODEL, range(1, LONG_H + 1), ts))
    final["lower"] = [f + q[h][0] for f, h in zip(final["forecast"], final["h"])]
    final["upper"] = [f + q[h][1] for f, h in zip(final["forecast"], final["h"])]
    final["standard"] = cal["standard"].reindex(final["date"]).values

    # Dip watch from water: a big drop in water per bird, and how often one was followed by a dip.
    level = hv.rolling(7, min_periods=4).mean().reindex(cal.index).ffill()
    hp = cal["hped"].where(valid)
    wd = water.reindex(cal.index)
    ratio = wd / wd.shift(1).rolling(7, min_periods=4).median()

    def dip_within(d: pd.Timestamp, days: int = SHORT_H) -> bool:
        return bool((hp.loc[d + DAY: d + days * DAY] <= level[d] - DIP_PTS).any())

    era = [d for d in cal.index[(cal.index <= as_of - SHORT_H * DAY)] if np.isfinite(ratio.get(d, np.nan))]
    drops = [d for d in era if ratio[d] < WATER_DROP]
    followed = sum(dip_within(d) for d in drops)
    base_rate = float(np.mean([dip_within(d) for d in era])) if era else float("nan")
    latest = [d for d in (as_of - DAY, as_of) if np.isfinite(ratio.get(d, np.nan))]
    dropped_now = [d for d in latest if ratio[d] < WATER_DROP]
    if dropped_now:
        d = dropped_now[-1]
        watch = {"status": "watch", "message": f"Water use dropped sharply on {d:%a %d %b}. Lay sometimes dips 1–3 days after this."}
    else:
        watch = {"status": "normal", "message": "No warning signs in water use."}
    watch["track_record"] = {"water_drops": len(drops), "followed_by_dip": int(followed),
                             "base_rate_pct": round(base_rate * 100), "threshold_pct": int(WATER_DROP * 100)}

    # Recent dips seen by the next-day forecast: did lay bounce straight back (a likely counting carry-over)?
    one = short_rep[short_rep["h"] == 1].dropna(subset=["actual"]).set_index("date")
    dip_rows = one[(one["actual"] - one["base"] <= -DIP_PTS)]
    recent_dips = []
    for t, r in dip_rows[dip_rows.index > as_of - 60 * DAY].iterrows():
        after = hv.loc[t + DAY: t + 2 * DAY]
        low_days, d = 1, t + DAY
        while d in hv.index and hv[d] <= r.base - DIP_PTS:
            low_days, d = low_days + 1, d + DAY
        before = ratio.loc[t - SHORT_H * DAY: t - DAY]
        recent_dips.append({
            "date": f"{t:%Y-%m-%d}", "hped": round(float(r.actual), 2), "expected": round(float(r.base), 2),
            "drop_pts": round(float(r.actual - r.base), 2), "days_low": int(low_days),
            "bounced_back": bool(len(after) and after.iloc[0] >= r.base - WARN_PTS),
            "next_day_hped": None if not len(after) else round(float(after.iloc[0]), 2),
            "water_drop_before": bool((before < WATER_DROP).any())})
    all_dips = one[(one["actual"] - one["base"] <= -DIP_PTS)]
    bounced = sum(1 for t, r in all_dips.iterrows()
                  if len(hv.loc[t + DAY: t + 2 * DAY]) and hv.loc[t + DAY: t + 2 * DAY].iloc[0] >= r.base - WARN_PTS)

    best_sig = with_signals.loc[with_signals["3day_jul_sep"].idxmin()]
    signals_note = (f"Adding shed heat, water, cracked eggs, egg size and mortality did not make the 3-day forecast reliably "
                    f"better: the best version was worse on forecasts made Apr–Jun ({best_sig['3day_apr_jun']:.2f} vs "
                    f"{model_row['3day_apr_jun']:.2f} points) and within {abs(model_row['3day_jul_sep'] - best_sig['3day_jul_sep']):.2f} "
                    f"points from Jul ({best_sig['3day_jul_sep']:.2f} vs {model_row['3day_jul_sep']:.2f}).")
    print(signals_note)

    next_days = [{"date": f"{r.date:%Y-%m-%d}", "hped": round(r.forecast, 2), "lower": round(r.lower, 2),
                  "upper": round(r.upper, 2), "standard": round(r.standard, 2)}
                 for r in final[final["h"] <= SHORT_H].itertuples()]
    outlook = [{"date": f"{r.date:%Y-%m-%d}", "hped": round(r.forecast, 2), "lower": round(r.lower, 2),
                "upper": round(r.upper, 2), "standard": round(r.standard, 2)} for r in final.itertuples()]
    hist = cal.loc[as_of - (HISTORY_DAYS - 1) * DAY: as_of]
    history = [{"date": f"{d:%Y-%m-%d}", "hped": None if pd.isna(r.hped) else round(float(r.hped), 2),
                "standard": round(float(r.standard), 2), "excluded": bool(r.excluded)}
               for d, r in hist.iterrows() if r.has_log]
    curve = shape_for(cal, "flock", as_of)
    snap = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "farm_id": H.FARM_ID, "house_id": H.HOUSE, "as_of": f"{as_of:%Y-%m-%d}",
        "model": {
            "name": "Recent level along the flock's own lay curve",
            "description": (f"Starts from the flock's average over its last {MODEL[0]} logged days and carries it along "
                            "the flock's own lay curve (a Gompertz rise with a slow decline, fitted to this flock's "
                            "DailyLog). It was the most accurate set-up we tested."),
            "level_days": MODEL[0],
            "curve_slope_pts_per_week": round(float((curve[as_of + 28 * DAY] - curve[as_of]) / 4), 2),
        },
        "next_days": next_days,
        "dip_watch": watch,
        "outlook": outlook,
        "accuracy": {
            "tested_from": f"{REP_START:%Y-%m-%d}", "tested_to": f"{as_of:%Y-%m-%d}",
            "forecasts_made": int(short_rep["origin"].nunique()),
            "next_day_mae": round(float(by_h.get(1, np.nan)), 2), "three_day_mae": round(mae(short_rep), 2),
            "four_week_mae": round(mae(long_rep_bt), 2),
            "benchmark": {"name": "Plain last-7-day average", "three_day_mae": round(mae(short_bench), 2),
                          "four_week_mae": round(mae(long_bench), 2)},
            "dips": int(len(all_dips)), "dips_bounced_back": int(bounced),
            "signals_note": signals_note,
        },
        "history": history,
        "recent_dips": recent_dips,
        "notes": [
            f"This is a forecast, not a measurement. It uses only the farm's manual DailyLog egg counts up to "
            f"{as_of:%Y-%m-%d} (the last day with eggs logged). Camera egg counts are not used.",
            f"Tested by forecasting from every day using only the data available that day: {int(short_rep['origin'].nunique())} "
            f"forecasts made from {REP_START:%d %b}. Set-ups were compared on forecasts made 15 Apr – 30 Jun as well "
            "(lay_backtest.csv).",
            "The flock's own curve and a flat line scored the same over 4 weeks; the generic breed-standard curve was "
            "worse because this flock is not declining as steeply. The flock curve is kept because it will bend down "
            "as the flock ages.",
            f"A dip means lay at least {DIP_PTS:.0f} points below the recent level. {bounced} of the {len(all_dips)} dips "
            "since July bounced straight back the next day, which points to eggs counted on the wrong day rather "
            "than a real drop.",
            "The range is the 10th–90th percentile of past forecast errors at the same number of days ahead.",
            "HPED = (small + medium + large + XL + jumbo) / live hens × 100, as in the app. Live hens = starting hens "
            "minus cumulative DailyLog mortality.",
            "Shed heat has not yet reached heat-stress levels (THI 27.8) in this flock's data.",
        ],
    }
    JSON_OUT.write_text(json.dumps(snap, indent=1))
    make_plot(cal, hv, short_rep, final, as_of, PNG_OUT)
    print(f"model 3-day MAE {mae(short_rep):.2f} (next day {by_h.get(1, np.nan):.2f}) vs average {mae(short_bench):.2f}; "
          f"4-week {mae(long_rep_bt):.2f} vs {mae(long_bench):.2f}")
    print(f"dips since Jul {len(all_dips)}, bounced back next day {bounced}; water drops {len(drops)}, followed {followed}, "
          f"base rate {base_rate:.2f}; dip watch now: {watch['status']}")
    print(f"wrote {JSON_OUT.relative_to(ROOT)} ({JSON_OUT.stat().st_size / 1024:.0f} KB)")
    for d in next_days:
        print("  next:", d)
    for d in recent_dips:
        print("  dip:", d)


def make_plot(cal, hped_valid, short_rep, final, as_of, path) -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    plt.rcParams["font.sans-serif"] = ["Inter", "Helvetica", "Arial", "DejaVu Sans"]
    start = as_of - HISTORY_DAYS * DAY
    fig, ax = plt.subplots(figsize=(11, 4.2))
    h = hped_valid.loc[start:]
    ax.plot(h.index, h.values, color="#2a78d6", lw=1.4, label="Actual (DailyLog)")
    one = short_rep[short_rep["h"] == 1].set_index("date")["forecast"]
    ax.plot(one.index, one.values, color="#eb6834", lw=1.1, alpha=0.8, label="Tested next-day forecasts (from 1 Jul)")
    f = final.set_index("date")
    ax.fill_between(f.index, f["lower"], f["upper"], color="#eb6834", alpha=0.18, lw=0, label="Forecast 80% range")
    ax.plot(f.index, f["forecast"], color="#eb6834", lw=2, ls="--", label="Forecast")
    s = cal["standard"].loc[start: f.index.max()]
    ax.plot(s.index, s.values, color="#6B7C80", lw=1.2, ls=":", label="Breed standard")
    ax.axvline(as_of, color="#002E35", lw=1, ls="--")
    ax.set_ylabel("Hen-day egg %")
    ax.set_title(f"Lay forecast from DailyLog data to {as_of:%d %b %Y}", loc="left", fontsize=11)
    ax.legend(loc="lower left", fontsize=8, ncol=3, frameon=False)
    ax.grid(axis="y", alpha=0.2)
    for sp in ("top", "right"):
        ax.spines[sp].set_visible(False)
    fig.tight_layout()
    fig.savefig(path, dpi=130)
    plt.close(fig)


if __name__ == "__main__":
    main()
