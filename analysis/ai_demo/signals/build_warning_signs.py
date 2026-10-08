"""Flock warning signs: research-backed drinking and flock features, scored against the flock's own
recent normal. Writes the dated demo snapshot `src/data/ai-demo/warning_signs.json`.

Signs (per local day, SAST):
  water_per_bird      daily house water per live bird (WM1 + WM2)
  drinking_start      minutes from measured lights-on to sustained drinking (10-min data)
  dusk_share          share of the day's water drunk from 2 h before to 2 h after measured lights-off
  night_flow          litres per A-frame between 22:00 and 05:00 (should be ~0)
  frame_balance       WM1 share of house water (the two frames hold similar flocks)
  dry_frame_hours     lit hours where one frame read 0 L while the other drank >= 30 L
  heat_load           hours with THI >= 27.8 °C-eq (comfort threshold in src/lib/thi.ts)
  flock_activity      daytime flock noise above the night fan-on level (dB)

Scoring: each continuous sign is compared with the median and spread of the previous 7 valid days.
Night flow, dry-frame hours and heat load use fixed rules. Read-only on all sources.

Run from the repository root:
    /Users/dylangeldenhuys/Code/Dashboard/analysis/.venv/bin/python analysis/ai_demo/signals/build_warning_signs.py
"""

from __future__ import annotations

import io
import json
from datetime import datetime, timezone
from pathlib import Path

import boto3
import numpy as np
import pandas as pd
import pyarrow.parquet as pq

ROOT = Path(__file__).resolve().parents[3]
CACHE = Path(__file__).resolve().parent / "cache"
OUT = ROOT / "src" / "data" / "ai-demo" / "warning_signs.json"
CACHE.mkdir(exist_ok=True)
OUT.parent.mkdir(parents=True, exist_ok=True)

REGION, BRONZE = "af-south-1", "senseagri-dev-bronze"
TZ = pd.Timedelta(hours=2)
WM = {"WM1": "24e124136f451854", "WM2": "24e124136f456303"}
LPP = 10  # litres per pulse (confirmed)
START_HENS, PLACED = 4479, pd.Timestamp("2025-10-13")
DAYS_BACK = 42           # fetch window
SHOW_DAYS = 28           # days returned in the snapshot
BASE_DAYS = 7            # baseline window for scoring
THI_COMFORT = 27.8

s3 = boto3.client("s3", region_name=REGION)


# ----------------------------------------------------------------------------- fetch (read-only)
def _read_prefix(prefix: str) -> pd.DataFrame:
    frames = []
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=BRONZE, Prefix=prefix):
        for o in page.get("Contents", []):
            if o["Key"].endswith(".parquet"):
                frames.append(pq.read_table(io.BytesIO(s3.get_object(Bucket=BRONZE, Key=o["Key"])["Body"].read())).to_pandas())
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()


def fetch(today: pd.Timestamp, cached: bool = False) -> dict:
    if cached and all((CACHE / f"{n}.parquet").exists() for n in ("meters", "am308", "daily_log", "noise")):
        noise = pd.read_parquet(CACHE / "noise.parquet")
        return {"meters": pd.read_parquet(CACHE / "meters.parquet"), "am308": pd.read_parquet(CACHE / "am308.parquet"),
                "daily_log": pd.read_parquet(CACHE / "daily_log.parquet"),
                "noise": noise.set_index("bucket")["noise"] if len(noise) else pd.Series(dtype=float)}
    out = {}
    days = pd.date_range(today - pd.Timedelta(days=DAYS_BACK), today)
    for name, prefix in (("meters", "meter_readings/date={d}/"), ("am308", "device_readings/device_type=AM308-1/date={d}/")):
        path = CACHE / f"{name}.parquet"
        parts = [_read_prefix(prefix.format(d=f"{d:%Y-%m-%d}")) for d in days]
        df = pd.concat([p for p in parts if len(p)], ignore_index=True)
        df.to_parquet(path, index=False)
        out[name] = df
    out["daily_log"] = _read_prefix("sheet_daily_log/")
    out["daily_log"].astype(str).to_parquet(CACHE / "daily_log.parquet", index=False)
    try:
        from influxdb_client_3 import InfluxDBClient3
        tok = boto3.client("ssm", region_name=REGION).get_parameter(
            Name="/senseagri/dev/influxdb/token", WithDecryption=True)["Parameter"]["Value"]
        c = InfluxDBClient3(host="https://us-east-1-1.aws.cloud2.influxdata.com", token=tok, database="senseagri-telemetry")
        try:
            t = c.query(f"""
              SELECT date_bin(INTERVAL '10 minutes', time, TIMESTAMP '1970-01-01 00:00:00') AS bucket,
                     AVG(noise_db_mean) AS noise
              FROM audio_noise WHERE farm_id = 'farm_anike_001' AND house_id = 'house1'
                AND time >= TIMESTAMP '{(today - pd.Timedelta(days=DAYS_BACK)):%Y-%m-%d} 00:00:00'
              GROUP BY bucket ORDER BY bucket""").to_pandas()
        finally:
            c.close()
        t["bucket"] = pd.to_datetime(t["bucket"]).dt.tz_localize(None) + TZ
        out["noise"] = t.set_index("bucket")["noise"]
    except Exception as exc:  # noise is optional context
        print("noise unavailable:", exc)
        out["noise"] = pd.Series(dtype=float)
    out["noise"].rename("noise").rename_axis("bucket").reset_index().to_parquet(CACHE / "noise.parquet", index=False)
    return out


# ----------------------------------------------------------------------------- 10-minute series
def ten_minute(raw: dict) -> pd.DataFrame:
    m = raw["meters"].copy()
    m["local"] = pd.to_datetime(m["time"]) + TZ
    lo, hi = m["local"].min().floor("D"), m["local"].max().ceil("D")
    grid = pd.date_range(lo, hi, freq="10min", inclusive="left")
    s = pd.DataFrame(index=grid)
    for arm, dev in WM.items():
        d = m[m["dev_eui"] == dev].sort_values("local").drop_duplicates("local")
        inc = d["pulse_total"].diff()
        inc[(inc < 0) | (d["local"].diff() > pd.Timedelta(minutes=25))] = np.nan  # resets / gaps not spread
        ser = pd.Series((inc * LPP).to_numpy(), index=d["local"].dt.floor("10min")).groupby(level=0).sum(min_count=1)
        s[f"{arm}_l"] = ser.reindex(grid)
        s[f"{arm}_seen"] = pd.Series(1.0, index=d["local"].dt.floor("10min")).groupby(level=0).max().reindex(grid)
    e = raw["am308"].copy()
    e["local"] = pd.to_datetime(e["time"]) + TZ
    e["bin"] = e["local"].dt.floor("10min")
    per = e.groupby(["bin", "dev_eui"])[["temperature", "humidity"]].mean().groupby(level=0).mean()
    s["T"] = per["temperature"].reindex(grid)
    s["RH"] = per["humidity"].reindex(grid)
    s["lit"] = e.assign(l=e["light_level"] >= 1).groupby("bin")["l"].max().reindex(grid).astype(float)
    s["noise"] = raw["noise"].reindex(grid) if len(raw["noise"]) else np.nan
    s["THI"] = s["T"] - (0.31 - 0.31 * s["RH"] / 100) * (s["T"] - 14.4)
    s["date"] = s.index.normalize()
    return s


def lighting(s: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for day, g in s.groupby("date"):
        lit = g[(g.index >= day + pd.Timedelta(hours=3)) & (g.index <= day + pd.Timedelta(hours=21)) & (g["lit"] == 1)]
        if len(lit) < 3:
            continue
        t = lit.index.to_series()
        on = t[(t.shift(-1) - t) <= pd.Timedelta(minutes=30)]
        off = t[(t - t.shift(1)) <= pd.Timedelta(minutes=30)]
        if len(on) and len(off):
            rows.append({"date": day, "lights_on": on.iloc[0], "lights_off": off.iloc[-1] + pd.Timedelta(minutes=10)})
    return pd.DataFrame(rows).set_index("date")


def live_birds(daily_log: pd.DataFrame) -> tuple[pd.Series, str]:
    dl = daily_log.copy()
    dl = dl[dl.get("house", "house1") == "house1"] if "house" in dl else dl
    dl["date"] = pd.to_datetime(dl["date"], errors="coerce")
    dl["mortality"] = pd.to_numeric(dl["mortality"], errors="coerce")
    deaths = dl.dropna(subset=["date"]).groupby("date")["mortality"].sum().sort_index()
    return START_HENS - deaths.cumsum(), f"{deaths.index.max():%Y-%m-%d}"


# ----------------------------------------------------------------------------- daily features
def _longest_dry_run(hourly: pd.DataFrame) -> tuple:
    """Longest run of consecutive lit hours where one frame read 0 L while the other drank >= 30 L."""
    best = (0, None, None, None, 0.0)
    for dry, other in (("WM1", "WM2"), ("WM2", "WM1")):
        flag = (hourly[f"{dry}_l"] == 0) & (hourly[f"{other}_l"] >= 30)
        run, start = 0, None
        for t, f in flag.items():
            if not f:
                run = 0
                continue
            start = t if run == 0 else start
            run += 1
            if run > best[0]:
                best = (run, dry, start, t + pd.Timedelta(hours=1), float(hourly.loc[start:t, f"{other}_l"].sum()))
    return best


def daily_features(s: pd.DataFrame, light: pd.DataFrame, birds: pd.Series) -> pd.DataFrame:
    rows = []
    for day, g in s.groupby("date"):
        seen = min(g["WM1_seen"].count(), g["WM2_seen"].count())
        if seen < 130 or g["T"].count() < 120:
            continue
        known = birds.index <= day - pd.Timedelta(days=1)
        nb = float(birds[known].iloc[-1]) if known.any() else START_HENS
        w1, w2 = g["WM1_l"].sum(), g["WM2_l"].sum()
        house = (g["WM1_l"].fillna(0) + g["WM2_l"].fillna(0))
        rec = {"date": day, "birds": nb, "wm1_l": w1, "wm2_l": w2, "house_l": w1 + w2,
               "water_per_bird": (w1 + w2) * 1000 / nb, "frame_balance": (w1 + 5) / (w1 + w2 + 10)}
        lo = light.loc[day] if day in light.index else None
        if lo is not None:
            after = house[(house.index >= day + pd.Timedelta(hours=3))]
            flow = (after > 0).astype(int)
            nxt = flow.shift(-1, fill_value=0) + flow.shift(-2, fill_value=0) + flow.shift(-3, fill_value=0)
            hit = after.index[(flow == 1) & (nxt >= 2)]
            if len(hit):
                rec["drinking_start"] = (hit[0] - lo["lights_on"]).total_seconds() / 60
                rec["drink_from"] = hit[0]
            dusk = house[(house.index >= lo["lights_off"] - pd.Timedelta(hours=2)) &
                         (house.index < lo["lights_off"] + pd.Timedelta(hours=2))].sum()
            rec["dusk_share"] = dusk / house.sum() if house.sum() > 0 else np.nan
            rec["lights_on"], rec["lights_off"] = lo["lights_on"], lo["lights_off"]
            lit_h = g[(g.index >= lo["lights_on"]) & (g.index < lo["lights_off"])]
            hourly = lit_h[["WM1_l", "WM2_l"]].resample("h").sum(min_count=1)
            (rec["dry_frame_hours"], rec["dry_frame"], rec["dry_from"], rec["dry_to"],
             rec["dry_other_l"]) = _longest_dry_run(hourly)
        night = s[(s.index >= day - pd.Timedelta(hours=2)) & (s.index < day + pd.Timedelta(hours=5))]
        rec["night_flow_wm1"], rec["night_flow_wm2"] = night["WM1_l"].sum(), night["WM2_l"].sum()
        rec["night_flow"] = max(rec["night_flow_wm1"], rec["night_flow_wm2"])
        thi_h = g["THI"].resample("h").mean()
        rec["heat_load"] = int((thi_h >= THI_COMFORT).sum())
        rec["thi_max"] = float(thi_h.max())
        rec["temp_max"] = float(g["T"].resample("h").mean().max())
        day_noise = g["noise"][(g.index >= day + pd.Timedelta(hours=9)) & (g.index < day + pd.Timedelta(hours=17))]
        night_noise = s["noise"][(s.index >= day) & (s.index < day + pd.Timedelta(hours=5))]
        if day_noise.count() >= 30 and night_noise.count() >= 18:
            rec["flock_activity"] = float(day_noise.median() - night_noise.quantile(0.75))
        rows.append(rec)
    df = pd.DataFrame(rows).set_index("date").sort_index()
    # Days with a meter or supply fault do not define "normal" for the flock signs.
    df["meter_fault"] = ((df["dry_frame_hours"].fillna(0) >= 3) | (df["night_flow"] >= 50) |
                         ~df["frame_balance"].between(0.38, 0.62))
    return df


SIGNS = [
    # key, label, unit, spread floor, direction that matters, group, research note
    ("water_per_bird", "Daily water per bird", "ml/bird/day", 0.07, "both", "flock",
     "A sudden change in daily water, especially a drop, is often the earliest sign of a health or supply problem."),
    ("drinking_start", "Drinking start after lights-on", "min", 30.0, "high", "flock",
     "A late or sluggish morning start can mean a flock that is unwell or water that is not reaching the drinkers."),
    ("dusk_share", "Drinking around dusk", "% of day", 0.06, "low", "flock",
     "Laying hens normally drink heavily in the hours before dark; losing that evening peak is a behaviour change."),
    ("frame_balance", "A-frame 1 share of water", "% of house", 0.04, "both", "supply",
     "The two A-frames hold similar flocks, so a shift in balance points to a local line, drinker or meter problem."),
    ("flock_activity", "Flock activity (noise)", "dB above night", 1.0, "both", "flock",
     "Changes in flock sound level accompany stress and illness; a quieter day can mean lethargic birds."),
]


def status_from_z(z: float, direction: str) -> str:
    if not np.isfinite(z):
        return "unknown"
    zz = abs(z) if direction == "both" else (z if direction == "high" else -z)
    return "alert" if zz >= 3.5 else ("watch" if zz >= 2.0 else "normal")


def score(df: pd.DataFrame) -> pd.DataFrame:
    """Each continuous sign vs the median and robust spread of the flock's previous 7 good days.
    Days with a meter fault, or an alert on that sign, are left out of "normal" — unless the last 4 days
    were all alerts, in which case the change has persisted and becomes the new normal.
    Water per bird is scored on a log scale, so its spread is relative (a floor of 7%)."""
    out = df.copy()
    fault = out["meter_fault"].to_numpy()
    for key, _label, _unit, floor, direction, _group, _research in SIGNS:
        if key not in out:
            continue
        x = (np.log(out[key]) if key == "water_per_bird" else out[key]).to_numpy(dtype=float)
        meds, sds, zs = (np.full(len(x), np.nan) for _ in range(3))
        alert = np.zeros(len(x), dtype=bool)
        for i in range(len(x)):
            prev = [j for j in range(i) if not fault[j] and np.isfinite(x[j])]
            persisted = len(prev) >= 4 and all(alert[j] for j in prev[-4:])
            base = x[(prev if persisted else [j for j in prev if not alert[j]])[-BASE_DAYS:]]
            if len(base) < 4:
                continue
            med = float(np.median(base))
            meds[i], sds[i] = med, max(1.4826 * float(np.median(np.abs(base - med))), floor)
            zs[i] = (x[i] - med) / sds[i]
            alert[i] = status_from_z(zs[i], direction) == "alert"
        out[f"{key}_median"], out[f"{key}_sd"], out[f"{key}_z"] = meds, sds, zs
    return out


def _fmt(key: str, x: float) -> str:
    if key in ("dusk_share", "frame_balance"):
        return f"{x * 100:.0f}%"
    return f"{x:.1f}" if key == "flock_activity" else f"{x:.0f}"


def describe(day: pd.Series) -> list[dict]:
    signs = []
    for key, label, unit, _floor, direction, group, research in SIGNS:
        v = day.get(key, np.nan)
        v = np.nan if v is None else float(v)
        z = day.get(f"{key}_z", np.nan)
        med, sd = day.get(f"{key}_median", np.nan), day.get(f"{key}_sd", np.nan)
        st = status_from_z(z, direction) if np.isfinite(v) else "unknown"
        if key == "water_per_bird" and np.isfinite(med):
            lo_n, hi_n, med_n = np.exp(med - 2 * sd), np.exp(med + 2 * sd), np.exp(med)
        elif np.isfinite(med):
            lo_n, hi_n, med_n = med - 2 * sd, med + 2 * sd, med
        else:
            lo_n = hi_n = med_n = np.nan
        u = "" if key in ("dusk_share", "frame_balance") else f" {unit}"
        rng = f"({_fmt(key, max(lo_n, 0))}–{_fmt(key, hi_n)})" if np.isfinite(lo_n) else ""
        if not np.isfinite(v):
            msg = "No data for this day."
        elif key == "drinking_start" and v < 0:
            st = "watch"
            msg = (f"Water was flowing {abs(v):.0f} min before lights-on — hens don't normally drink in the dark; "
                   "see the night-water sign.")
        elif not np.isfinite(med):
            msg = f"{_fmt(key, v)}{u} — not enough recent days to judge."
        else:
            higher = v > med_n
            if key == "water_per_bird":
                change = f"{abs(v / med_n - 1) * 100:.0f}% {'above' if higher else 'below'} the last week's normal"
            elif key == "drinking_start":
                change = f"{'later' if higher else 'earlier'} than the last week's normal"
            else:
                change = f"{'above' if higher else 'below'} the last week's normal"
            prefix = f"{_fmt(key, v)}{u}"
            if key == "drinking_start" and pd.notna(day.get("drink_from")):
                prefix = f"Started {day['drink_from']:%H:%M}, {v:.0f} min after lights-on"
            if st in ("watch", "alert"):
                msg = f"{prefix} — {change} {rng}."
            elif abs(z) >= 2.0:
                msg = f"{prefix} — {change} {rng}; not a warning sign on its own."
            else:
                msg = f"{prefix} — within the last week's normal {rng}."
        signs.append({"key": key, "label": label, "unit": unit, "group": group,
                      "value": None if not np.isfinite(v) else round(v, 4),
                      "normal_low": None if not np.isfinite(lo_n) else round(float(max(lo_n, 0)), 4),
                      "normal_high": None if not np.isfinite(hi_n) else round(float(hi_n), 4),
                      "z": None if not np.isfinite(z) else round(float(z), 2), "status": st, "message": msg,
                      "research": research})
    # Rule-based signs
    nf1, nf2 = float(day.get("night_flow_wm1", 0) or 0), float(day.get("night_flow_wm2", 0) or 0)
    nf = max(nf1, nf2)
    signs.append({"key": "night_flow", "label": "Water used at night (22:00–05:00)", "unit": "L", "group": "supply",
                  "value": round(nf, 1), "normal_low": 0, "normal_high": 20, "z": None,
                  "status": "alert" if nf >= 50 else ("watch" if nf >= 30 else "normal"),
                  "message": (f"A-frame 1 {nf1:.0f} L, A-frame 2 {nf2:.0f} L overnight — "
                              + ("water should be close to zero in the dark; check for leaks, flushing or disturbance."
                                 if nf >= 30 else "close to zero, as expected in the dark.")),
                  "research": "Hens stop drinking after lights-out; flow in the dark points to leaks, flushing, light leaks or disturbed birds."})
    dh = int(day.get("dry_frame_hours", 0) or 0)
    if dh:
        dry, other = ("A-frame 1 (WM1)", "A-frame 2") if day.get("dry_frame") == "WM1" else ("A-frame 2 (WM2)", "A-frame 1")
        dmsg = (f"{dry} read 0 L from {day['dry_from']:%H:%M} to {day['dry_to']:%H:%M} while {other} drank "
                f"{day['dry_other_l']:.0f} L" + (" — check the meter, valve and supply to that frame." if dh >= 2
                                                   else " — a single hour, often just a slow start on one frame."))
    else:
        dmsg = "Both A-frames drank through the lit hours."
    signs.append({"key": "dry_frame_hours", "label": "One A-frame dry while the other drinks", "unit": "h", "group": "supply",
                  "value": dh, "normal_low": 0, "normal_high": 1, "z": None,
                  "status": "alert" if dh >= 3 else ("watch" if dh >= 2 else "normal"), "message": dmsg,
                  "research": "Uneven or interrupted flow points to blocked lines, closed valves or meter faults rather than the birds."})
    hl = int(day.get("heat_load", 0) or 0)
    thi_max = float(day.get("thi_max", np.nan))
    signs.append({"key": "heat_load", "label": "Heat load (THI above comfort)", "unit": "h", "group": "environment",
                  "value": hl, "normal_low": 0, "normal_high": 1, "z": None,
                  "status": "alert" if thi_max >= 30 else ("watch" if hl >= 2 else "normal"),
                  "message": f"{hl} h above the {THI_COMFORT} °C-eq comfort threshold (peak THI {thi_max:.1f}, "
                             f"house max {float(day.get('temp_max', np.nan)):.1f} °C).",
                  "research": "Water-to-feed ratio climbs from about 2:1 at 21 °C to 8:1 at 38 °C; heat raises water need and stresses birds."})
    return signs


RANK = {"alert": 0, "watch": 1}


def main() -> None:
    import sys
    today = (pd.Timestamp.now(tz="UTC").tz_localize(None) + TZ).normalize()  # SAST calendar day
    raw = fetch(today, cached="--cached" in sys.argv)
    s = ten_minute(raw)
    light = lighting(s)
    birds, last_log = live_birds(raw["daily_log"])
    df = score(daily_features(s, light, birds))
    df = df[df.index < today]  # complete days only
    as_of = df.index.max()
    show = df[df.index > as_of - pd.Timedelta(days=SHOW_DAYS)]
    history, flagged = [], []
    for day, row in show.iterrows():
        signs = describe(row)
        counts = {k: sum(1 for x in signs if x["status"] == k) for k in ("alert", "watch")}
        history.append({"date": f"{day:%Y-%m-%d}", "alerts": counts["alert"], "watches": counts["watch"],
                        "meter_fault": bool(row["meter_fault"]),
                        "house_litres": round(float(row["house_l"]), 0),
                        "wm1_litres": round(float(row["wm1_l"]), 0), "wm2_litres": round(float(row["wm2_l"]), 0),
                        "lights_on": f"{row['lights_on']:%H:%M}" if pd.notna(row.get("lights_on")) else None,
                        "lights_off": f"{row['lights_off']:%H:%M}" if pd.notna(row.get("lights_off")) else None,
                        "signs": [{k: x[k] for k in ("key", "status", "value", "normal_low", "normal_high", "message")}
                                  for x in signs]})
        hits = sorted((x for x in signs if x["status"] in RANK), key=lambda x: RANK[x["status"]])
        if hits:
            flagged.append({"date": f"{day:%Y-%m-%d}", "status": hits[0]["status"],
                            "headline": f"{hits[0]['label']}: {hits[0]['message']}",
                            "reasons": [{"key": x["key"], "label": x["label"], "status": x["status"],
                                         "group": x["group"], "message": x["message"]} for x in hits]})
    detail = {}
    for day in show.index:
        g = s[s["date"] == day]
        h = g.resample("h").agg({"WM1_l": "sum", "WM2_l": "sum", "T": "mean", "THI": "mean", "lit": "mean", "noise": "mean"})
        detail[f"{day:%Y-%m-%d}"] = [
            {"hour": int(t.hour), "wm1_l": round(float(r["WM1_l"]), 1), "wm2_l": round(float(r["WM2_l"]), 1),
             "temp_c": None if pd.isna(r["T"]) else round(float(r["T"]), 1),
             "thi": None if pd.isna(r["THI"]) else round(float(r["THI"]), 1),
             "light_share": None if pd.isna(r["lit"]) else round(float(r["lit"]), 2),
             "noise_db": None if pd.isna(r["noise"]) else round(float(r["noise"]), 1)} for t, r in h.iterrows()]
    today_row = df.loc[as_of]
    snap = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "farm_id": "farm_anike_001", "house_id": "house1",
        "as_of": f"{as_of:%Y-%m-%d}",
        "baseline": f"Each flock sign is compared with the flock's own previous {BASE_DAYS} days, leaving out days with a meter or supply fault.",
        "birds_note": f"Water per bird uses the live-hen count from the DailyLog (last mortality entry {last_log}); "
                      "after that the last known count is carried forward.",
        "day": {"date": f"{as_of:%Y-%m-%d}", "house_litres": round(float(today_row["house_l"]), 0),
                "wm1_litres": round(float(today_row["wm1_l"]), 0), "wm2_litres": round(float(today_row["wm2_l"]), 0),
                "lights_on": f"{today_row['lights_on']:%H:%M}" if pd.notna(today_row.get("lights_on")) else None,
                "lights_off": f"{today_row['lights_off']:%H:%M}" if pd.notna(today_row.get("lights_off")) else None,
                "signs": describe(today_row)},
        "sign_info": {x["key"]: {k: x[k] for k in ("label", "unit", "group", "research")} for x in describe(today_row)},
        "history": history,
        "flagged_days": flagged[::-1],
        "hourly_detail": detail,
        "notes": [
            "Snapshot built from raw meter (10-minute) and climate readings; water from the cumulative pulse counters at 10 L per pulse.",
            "Per-A-frame bird numbers are unknown, so water is judged for the whole house per live bird; per-frame readings are used only for balance and dry-frame checks.",
            "Lights-on and lights-off are measured from the climate sensors' light index, not taken from a schedule.",
            "Flock noise is broadband and includes fan noise; activity is daytime noise above the night fan-on level.",
            "Thresholds (2 and 3.5 robust spreads for watch and alert; night water ≥ 30 L; a frame dry ≥ 2 h) are demo defaults, not approved alert rules.",
        ],
    }
    OUT.write_text(json.dumps(snap, indent=1, default=str))
    print(f"as_of {as_of:%Y-%m-%d}; days scored {len(show)}; flagged days {len(flagged)} "
          f"({sum(f['status'] == 'alert' for f in flagged)} alert); size {OUT.stat().st_size / 1024:.0f} KB")
    for x in snap["day"]["signs"]:
        print(f"  {x['status']:7s} {x['label']}: {x['message']}")
    for f in snap["flagged_days"]:
        print(f["date"], f["status"], "|", " / ".join(f"[{r['status']}] {r['label']}: {r['message'][:80]}" for r in f["reasons"]))


if __name__ == "__main__":
    main()
