# Pure-stdlib backtest of the night-acoustics rule (no pandas needed) so we can validate on real
# data right away. Reads analysis/audio_noise.csv (from dump_audio_noise.ts).
#
#   rule under test:  night noise > baseline + SIGMA·std, sustained ≥ MIN_MINUTES  → alert
import csv, statistics, datetime as dt

SAST_H = 2
NIGHT_START, NIGHT_END = 20, 5      # SAST hours counted as night (20:00–05:00)
SIGMA = 2.0
MIN_MINUTES = 2.0
CSV = "analysis/audio_noise.csv"

def parse(s):  # "2026-07-27T20:01:35.000Z" -> aware datetime (UTC)
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))

rows = []
with open(CSV) as f:
    for r in csv.DictReader(f):
        m = r["noise_db_mean"]
        if m == "" or m is None:
            continue
        t_utc = parse(r["time"])
        t_sast = t_utc + dt.timedelta(hours=SAST_H)
        night = (t_sast.hour >= NIGHT_START) or (t_sast.hour < NIGHT_END)
        night_date = (t_sast - dt.timedelta(hours=NIGHT_START)).date() if night else None
        rows.append({"t": t_utc, "sast": t_sast, "mean": float(m),
                     "night": night, "night_date": night_date})
rows.sort(key=lambda x: x["t"])

# cadence
gaps = sorted((rows[i]["t"] - rows[i-1]["t"]).total_seconds() for i in range(1, len(rows)))
med_gap = gaps[len(gaps)//2]; p90_gap = gaps[int(len(gaps)*0.9)]

# night baseline + std
night_vals = [r["mean"] for r in rows if r["night"]]
baseline = statistics.mean(night_vals)
std = statistics.pstdev(night_vals)
thr = baseline + SIGMA * std
nights = sorted({r["night_date"] for r in rows if r["night"]})

# backtest: runs of consecutive above-threshold night points
for r in rows:
    r["above"] = r["night"] and r["mean"] > thr
events, run = [], []
for r in rows:
    if r["above"]:
        run.append(r)
    elif run:
        events.append(run); run = []
if run:
    events.append(run)

def summarize(run):
    dur = (run[-1]["t"] - run[0]["t"]).total_seconds() / 60
    return {"start": run[0]["sast"], "dur_min": dur, "n": len(run),
            "peak": max(x["mean"] for x in run), "night_date": run[0]["night_date"]}

ev = [summarize(r) for r in events]
sustained = [e for e in ev if e["dur_min"] >= MIN_MINUTES]

print("=" * 68)
print(f"NIGHT ACOUSTICS BACKTEST  ·  house1  ·  {rows[0]['t'].date()} → {rows[-1]['t'].date()}")
print("=" * 68)
print(f"points: {len(rows)}  ({len(night_vals)} night)  over {len(nights)} nights")
print(f"sampling gap: median {med_gap:.0f}s  p90 {p90_gap:.0f}s")
print(f"night window (SAST): {NIGHT_START:02d}:00–{NIGHT_END:02d}:00")
print("-" * 68)
print(f"night baseline : {baseline:7.2f} dBFS")
print(f"night std      : {std:7.2f} dB")
print(f"+{SIGMA:g}σ threshold : {thr:7.2f} dBFS   (louder = higher, 0 = loudest)")
print("-" * 68)
print(f"above-threshold night points : {sum(r['above'] for r in rows)} / {len(night_vals)}")
print(f"events (runs of elevated pts) : {len(ev)}")
print(f"SUSTAINED ≥ {MIN_MINUTES:g} min           : {len(sustained)}   "
      f"→  {len(sustained)/max(1,len(nights)):.2f} per night")
print("-" * 68)
if sustained:
    print("sustained events (SAST start · duration · #pts · peak dB):")
    for e in sorted(sustained, key=lambda x: x["start"])[:30]:
        print(f"  {e['start']:%a %d %b %H:%M}   {e['dur_min']:5.1f} min   "
              f"{e['n']:3d} pts   peak {e['peak']:6.1f}")
else:
    print("no sustained events at these settings.")

# flagged-events-per-night distribution (quick histogram)
per_night = {}
for e in sustained:
    per_night[e["night_date"]] = per_night.get(e["night_date"], 0) + 1
if per_night:
    print("-" * 68)
    print("busiest nights:")
    for d, c in sorted(per_night.items(), key=lambda kv: -kv[1])[:8]:
        print(f"  {d}  {'█'*c} {c}")
