# %% [markdown]
# # Adaptive floor — separating fans/background from bird noise
#
# The fan/weather level isn't fixed (fans cycle; rain/wind drift it), so instead of one baseline we
# **track a moving floor** = a low percentile of `noise_db_mean` over a rolling window. The floor
# follows whatever the fans+weather are doing; **bird noise = level above the current floor.**

# %%
%matplotlib inline
import os
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
plt.rcParams["figure.figsize"] = (14, 4.5)

SAST = 2
FLOOR_WIN = 21      # rolling window in minutes for the floor
FLOOR_PCTL = 15     # low percentile = the quiet/fan floor
NIGHT_START, NIGHT_END = 20, 5
CSV = "audio_noise.csv" if os.path.exists("audio_noise.csv") else "analysis/audio_noise.csv"

# %%
df = pd.read_csv(CSV, parse_dates=["time"])
df = df.dropna(subset=["noise_db_mean"]).sort_values("time").reset_index(drop=True)
df["t_sast"] = df["time"] + pd.Timedelta(hours=SAST)
# adaptive floor: centred rolling low-percentile (ignores brief bird bursts, follows the fan steps)
df["floor"] = df["noise_db_mean"].rolling(FLOOR_WIN, center=True, min_periods=5).quantile(FLOOR_PCTL / 100)
df["bird"] = df["noise_db_mean"] - df["floor"]        # how far above the current floor
print(f"{len(df)} points | floor ranges {df['floor'].min():.0f} … {df['floor'].max():.0f} dB "
      f"(fixed baseline would be one number)")

# %%
# Overview: the whole run — raw level (light) with the adaptive floor (dark) tracking under it.
fig, ax = plt.subplots()
ax.plot(df["t_sast"], df["noise_db_mean"], color="#2A8E9A", lw=.5, alpha=.5, label="noise level")
ax.plot(df["t_sast"], df["floor"], color="#002E35", lw=1.3, label=f"adaptive floor (fans/bg)")
ax.set_ylabel("dBFS"); ax.set_title("Adaptive floor tracking the fan/background level, whole run")
ax.legend(loc="upper right", fontsize=9)
plt.show()

# %%
# Zoom: a window with clear fan changes + the real bird disturbance (08–10 Aug), night shaded.
seg = df[(df["t_sast"] >= "2026-08-08") & (df["t_sast"] < "2026-08-11")]
fig, (a1, a2) = plt.subplots(2, 1, figsize=(14, 7), sharex=True)
a1.plot(seg["t_sast"], seg["noise_db_mean"], color="#2A8E9A", lw=.8, label="noise level")
a1.plot(seg["t_sast"], seg["floor"], color="#002E35", lw=1.6, label="adaptive floor (fans/bg)")
a1.set_ylabel("dBFS"); a1.set_title("Zoom 08–10 Aug — floor follows the fan steps"); a1.legend(fontsize=9)
# bird signal = level above floor
a2.axhline(0, color="#999", lw=.6)
a2.fill_between(seg["t_sast"], 0, seg["bird"].clip(lower=0), color="#B91C1C", alpha=.5)
a2.set_ylabel("dB above floor"); a2.set_title("Bird signal (level − adaptive floor) — spikes = flock up, fans removed")
# shade night on both
for ax in (a1, a2):
    for d in pd.date_range("2026-08-07", "2026-08-11"):
        ax.axvspan(d + pd.Timedelta(hours=20), d + pd.Timedelta(hours=29), color="#000", alpha=.05)
plt.show()

# %% [markdown]
# ### Read-out
# - The **dark line** is the estimated fans/background floor — it should **step up/down with the fans**
#   and drift with weather, where a single fixed baseline couldn't.
# - The **red "bird signal"** (level − floor) is what's left after removing the floor: near-zero when the
#   flock is quiet (even while fans cycle), spiking only when the birds are genuinely up.
# - Tune `FLOOR_WIN` (shorter = tracks faster but noisier) and `FLOOR_PCTL`. Then the sleep score /
#   night-disturbance rule run on **`bird`** instead of raw level — fan-proof, weather-robust.
# - Remaining gap: loud **rain** still lifts the floor *and* can poke above it → that's where the
#   spectral step (frequency separation) earns its place. This handles fans + slow weather now.
