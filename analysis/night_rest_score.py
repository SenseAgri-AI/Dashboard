# %% [markdown]
# # Flock Night-Rest Score  (final — absolute disruption signal)
#
# A sleep score for the flock from the night acoustics. **Foundation: the absolute noise level.**
# A restful night = the dark period stays quiet; a poor night = loud disruptions (the flock erupting)
# above the level a steady fan/rain background sits at. Validated: the absolute line cleanly separates
# real disturbances from quiet nights (confirmed by ear), and is robust to the background moving
# (background stayed −37…−58 across these nights, all well under the −32 line). The relative-to-floor
# approach was explored (`adaptive_floor` / `night_rest_score_v3`) and rejected — it's confounded.
#
# `noise_db_mean` is dBFS (higher = louder). Dark period = 20:00–05:00 SAST. A "night" is named by the
# **evening it starts** (so the "08 Aug" night = Fri 8th 20:00 → Sat 9th 05:00).

# %%
%matplotlib inline
import os
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
plt.rcParams["figure.figsize"] = (13, 4.5)

SAST = 2
NIGHT_START, NIGHT_END = 20, 5
DISRUPT_DB = -32                 # absolute: mean above this = a loud disruption (birds up)
BOUT_MIN = 2                     # minutes to count as a disruption bout
CSV = "audio_noise.csv" if os.path.exists("audio_noise.csv") else "analysis/audio_noise.csv"

# %%
df = pd.read_csv(CSV, parse_dates=["time"])
df = df.dropna(subset=["noise_db_mean"]).sort_values("time").reset_index(drop=True)
df["t_sast"] = df["time"] + pd.Timedelta(hours=SAST)
df["hour"] = df["t_sast"].dt.hour
df["is_night"] = (df["hour"] >= NIGHT_START) | (df["hour"] < NIGHT_END)
df["night"] = (df["t_sast"] - pd.Timedelta(hours=NIGHT_START)).dt.normalize()
night = df[df["is_night"]].copy()
print(f"{len(night)} night points over {night['night'].nunique()} nights")

# %%
def score_one(g):
    g = g.sort_values("t_sast")
    m = g["noise_db_mean"].to_numpy()
    hours = g["hour"].to_numpy()
    disrupt = m > DISRUPT_DB
    bouts = disrupt_min = run = longest_quiet = cur_quiet = 0
    for d in disrupt:
        if d:
            run += 1; disrupt_min += 1; cur_quiet = 0
        else:
            if run >= BOUT_MIN: bouts += 1
            run = 0; cur_quiet += 1; longest_quiet = max(longest_quiet, cur_quiet)
    if run >= BOUT_MIN: bouts += 1
    severity = float(np.mean(m[disrupt] - DISRUPT_DB)) if disrupt.any() else 0.0   # avg dB over the line
    pre = (hours >= 3) & (hours < 5)
    predawn = float((m[pre] > DISRUPT_DB).mean()) if pre.any() else 0.0            # final-2h (red-mite window)
    score = 100 - 2 * disrupt_min - 5 * bouts - 2 * severity - 25 * predawn
    return {"points": len(m), "disrupt_min": disrupt_min, "bouts": bouts, "severity_dB": round(severity, 1),
            "longest_quiet_min": longest_quiet, "predawn": round(predawn, 2), "score": round(max(0, min(100, score)), 1)}

scores = pd.DataFrame([{"night": nd.date(), **score_one(g)} for nd, g in night.groupby("night")]).sort_values("night")
scores.reset_index(drop=True)

# %%
print(f"average night-rest score: {scores['score'].mean():.1f}\n")
print("ranked worst → best  (evening the night starts):")
print(scores.sort_values("score")[["night", "disrupt_min", "bouts", "severity_dB", "predawn", "score"]].to_string(index=False))

# %%
fig, ax = plt.subplots()
colors = ["#B91C1C" if s < 60 else "#D97706" if s < 85 else "#166534" for s in scores["score"]]
ax.bar(range(len(scores)), scores["score"], color=colors)
ax.set_xticks(range(len(scores))); ax.set_xticklabels([str(d)[5:] for d in scores["night"]], rotation=60, fontsize=8)
ax.axhline(85, color="#166534", ls="--", lw=.8); ax.axhline(60, color="#B91C1C", ls="--", lw=.8)
ax.set_ylim(0, 102); ax.set_ylabel("Night-Rest Score")
ax.set_title("Flock Night-Rest Score — green ≥85 (restful), amber, red <60 (disturbed)")
plt.show()

# %%
worst = scores.loc[scores["score"].idxmin(), "night"]
best = scores.loc[scores["score"].idxmax(), "night"]
fig, axes = plt.subplots(2, 1, figsize=(13, 7))
for ax, nd, tag in [(axes[0], best, "RESTFUL"), (axes[1], worst, "MOST DISTURBED")]:
    g = night[night["night"].dt.date == nd].sort_values("t_sast")
    ax.plot(g["t_sast"], g["noise_db_mean"], color="#2A8E9A", lw=1)
    ax.axhline(DISRUPT_DB, color="#B91C1C", ls="--", lw=1, label=f"disruption > {DISRUPT_DB}")
    dd = g[g["noise_db_mean"] > DISRUPT_DB]
    ax.scatter(dd["t_sast"], dd["noise_db_mean"], s=16, c="#B91C1C", zorder=3)
    row = scores[scores["night"] == nd].iloc[0]
    ax.set_title(f"{tag} — night of {nd}  (score {row['score']:.0f}, {row['disrupt_min']} disrupt-min, {row['bouts']} bouts)")
    ax.set_ylabel("dBFS"); ax.legend(fontsize=8)
plt.tight_layout(); plt.show()

# %% [markdown]
# ### Components (all off the absolute level)
# - **disrupt_min / bouts** — how long / how many times the flock was loudly up
# - **severity_dB** — how far over the disruption line (how loud)
# - **predawn** — disruption fraction in the final 2 h (the red-mite window)
# - **longest_quiet_min** — longest consolidated calm stretch
#
# Weights (`2·disrupt_min + 5·bouts + 2·severity + 25·predawn`) are the calibratable part — the
# *signal* is settled. Undisturbed & quiet-fan nights correctly score 100; the real flock disturbances
# rank lowest. Next: validate the score against next-day HDEP/mortality when production data overlaps.
