# %% [markdown]
# # Flock Night-Rest Score — v3 (fan-clean, adaptive floor)
#
# v1 used a per-night floor → fooled by fans. v2 used an absolute line → fan-proof but flat (100-or-
# disturbed). **v3 runs on the `bird` signal = level − adaptive floor**, so the fan/weather level is
# removed and a *relative* rise is finally safe — giving a graded 0–100 that moves every night.

# %%
%matplotlib inline
import os
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
plt.rcParams["figure.figsize"] = (13, 4.5)

SAST = 2
NIGHT_START, NIGHT_END = 20, 5
FLOOR_WIN, FLOOR_PCTL = 21, 15     # adaptive floor: rolling low-percentile (fans/background)
AWAKE_MARGIN = 8                   # dB above the current floor = birds vocalising
BOUT_MIN = 2
CSV = "audio_noise.csv" if os.path.exists("audio_noise.csv") else "analysis/audio_noise.csv"

# %%
df = pd.read_csv(CSV, parse_dates=["time"])
df = df.dropna(subset=["noise_db_mean"]).sort_values("time").reset_index(drop=True)
df["t_sast"] = df["time"] + pd.Timedelta(hours=SAST)
df["hour"] = df["t_sast"].dt.hour
df["is_night"] = (df["hour"] >= NIGHT_START) | (df["hour"] < NIGHT_END)
df["night"] = (df["t_sast"] - pd.Timedelta(hours=NIGHT_START)).dt.normalize()
df["floor"] = df["noise_db_mean"].rolling(FLOOR_WIN, center=True, min_periods=5).quantile(FLOOR_PCTL / 100)
df["bird"] = df["noise_db_mean"] - df["floor"]        # fan/weather removed
night = df[df["is_night"]].dropna(subset=["bird"]).copy()
print(f"{len(night)} night points over {night['night'].nunique()} nights | "
      f"night bird signal: median {night['bird'].median():.1f}, p95 {night['bird'].quantile(.95):.1f} dB")

# %%
def score_one(g):
    g = g.sort_values("t_sast")
    bird = g["bird"].to_numpy()
    hours = g["hour"].to_numpy()
    awake = bird > AWAKE_MARGIN
    bouts = wake_min = run = longest_quiet = cur_quiet = 0
    for a in awake:
        if a:
            run += 1; wake_min += 1; cur_quiet = 0
        else:
            if run >= BOUT_MIN: bouts += 1
            run = 0; cur_quiet += 1; longest_quiet = max(longest_quiet, cur_quiet)
    if run >= BOUT_MIN: bouts += 1
    mean_bird = float(np.mean(np.clip(bird, 0, None)))          # avg dB above floor = restlessness
    pre = (hours >= 3) & (hours < 5)
    predawn = float((bird[pre] > AWAKE_MARGIN).mean()) if pre.any() else 0.0
    restless = max(0.0, mean_bird - 3.0)                        # calm sits ~3 dB over a 15th-pct floor
    score = 100 - 3.0 * wake_min - 4 * bouts - 9 * restless - 20 * predawn
    return {"points": len(bird), "quiet_frac": round(1 - awake.mean(), 3), "wake_min": wake_min,
            "bouts": bouts, "mean_bird": round(mean_bird, 1), "longest_quiet_min": longest_quiet,
            "predawn": round(predawn, 2), "score": round(max(0, min(100, score)), 1)}

scores = pd.DataFrame([{"night": nd.date(), **score_one(g)} for nd, g in night.groupby("night")]).sort_values("night")
scores.reset_index(drop=True)

# %%
print(f"average score {scores['score'].mean():.1f} | spread {scores['score'].min():.0f}–{scores['score'].max():.0f} "
      f"(v2 was flat: 15 nights at 100)\n")
print("ranked worst → best:")
print(scores.sort_values("score")[["night", "wake_min", "bouts", "mean_bird", "predawn", "score"]].to_string(index=False))

# %%
fig, ax = plt.subplots()
colors = ["#B91C1C" if s < 60 else "#D97706" if s < 80 else "#166534" for s in scores["score"]]
ax.bar(range(len(scores)), scores["score"], color=colors)
ax.set_xticks(range(len(scores))); ax.set_xticklabels([str(d)[5:] for d in scores["night"]], rotation=60, fontsize=8)
ax.axhline(80, color="#166534", ls="--", lw=.8); ax.axhline(60, color="#B91C1C", ls="--", lw=.8)
ax.set_ylim(0, 102); ax.set_ylabel("Night-Rest Score"); ax.set_title("v3 fan-clean score — graded, per night")
plt.show()

# %%
worst = scores.loc[scores["score"].idxmin(), "night"]
best = scores.loc[scores["score"].idxmax(), "night"]
fig, axes = plt.subplots(2, 1, figsize=(13, 7), sharex=False)
for ax, nd, tag in [(axes[0], best, "BEST"), (axes[1], worst, "WORST")]:
    g = night[night["night"].dt.date == nd].sort_values("t_sast")
    ax.plot(g["t_sast"], g["bird"], color="#2A8E9A", lw=1)
    ax.axhline(AWAKE_MARGIN, color="#B91C1C", ls="--", lw=1, label=f"awake > +{AWAKE_MARGIN}dB")
    aw = g[g["bird"] > AWAKE_MARGIN]
    ax.scatter(aw["t_sast"], aw["bird"], s=16, c="#B91C1C", zorder=3)
    row = scores[scores["night"] == nd].iloc[0]
    ax.set_title(f"{tag} — {nd}  (score {row['score']:.0f})   bird signal = level − adaptive floor")
    ax.set_ylabel("dB above floor"); ax.legend(fontsize=8)
plt.tight_layout(); plt.show()

# %% [markdown]
# ### Read-out
# The score now **grades every night** (fan level removed via the adaptive floor), while the real
# disturbances still rank worst. Components: `wake_min`/`bouts` (bird above floor), `mean_bird`
# (restlessness), `predawn` (final-2h unrest — the red-mite window), `longest_quiet_min` (consolidation).
# Tune `AWAKE_MARGIN` and the score weights. Remaining gap: loud **rain** (spectral step).
