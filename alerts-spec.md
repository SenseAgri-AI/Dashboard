# Alerts — spec & logic

Alerts the farmer gets on **WhatsApp** (the platform sends them via Twilio) and sees in-app. The
platform evaluates the rules and sends; the dashboard reads and shows the same ones.

**How an alert works (v1 — kept simple):**
- The platform checks each rule against the live data.

**Data we can read (farm-scoped):** InfluxDB `sensors` (temp, humidity, CO₂, PM, light…), `audio_noise`
(noise level + fan baseline), silver/Athena (daily eggs, mortality, HDEP), the sheet (log, schedules),
breed-standard curve.

---

## 🌡 Climate control

### Heat stress
- **Fires when:** experienced heat (temp + humidity) above comfort, sustained. Worse if it doesn't cool overnight.
- **Says:** "Experienced heat high in {house} for {time}. Increase airflow/cooling, keep water cool, avoid handling the birds."
- **Logic:** _TBD — THI/heat-index formula, comfort ceiling, dwell time._

### Heat rising fast
- **Fires when:** experienced heat climbing sharply toward the ceiling (rate of change).
- **Says:** "Heat rising fast in {house} — open inlets / start cooling before the midday peak."
- **Logic:** _TBD — slope over ~2 h._

### Heat predicted heat stress event today.
- **Fires when:** experienced heat climbing sharply toward the ceiling (rate of change), models predicts sustained heat from whetther and current barn condition, if nothing is changed.
- **Says:** "model predicts heat stress today, Heat rising fast in {house} — open inlets / start cooling before the midday peak."
- **Logic:** _TBD — slope over ~2 h._

### Cold
- **Fires when:** below the comfort band, sustained — any time of day.
- **Says:** "Temperature low in {house} for {time}. Conserve heat, check heaters; expect higher feed use and watch shell quality."
- **Logic:** _TBD — lower bound + dwell._

## 💨 Ventilation

### Poor air exchange
- **Fires when:** CO₂ high or climbing, sustained.
- **Says:** "CO₂ {n} ppm in {house} — air exchange is low. Increase ventilation / open inlets and re-check in 30 min."
- **Logic:** _TBD — CO₂ thresholds + dwell; corroborate with fan noise._

### Fan change / fault
- **Fires when:** fan noise drops or changes with no scheduled reason (higher confidence if CO₂ rising too).
- **Says:** "Fans sound off in {house} and CO₂ is rising — check the fans and power."
- **Logic:** _TBD — fan-noise baseline from `audio_noise`._

## ⚡ Power / connectivity  *(built — v1)*

**The alert.** Tells the farmer when the shed stops sending data — a power cut, a network drop, or a
device that's come unplugged. This is the most time-critical alert on the board: if power is out the
fans are off, and in hot weather that turns into mass mortality within hours.

**How we detect it — device heartbeat.** Two *independent* feeds come off the shed, each sending a
data point roughly **once a minute**:
- **Climate sensors** — the gateway side → InfluxDB **`sensors`**
- **Acoustics / mic** — the Jetson → InfluxDB **`audio_noise`**

A live device keeps writing points; a dead one goes silent. So the rule just asks *"how long since the
last point?"* for each feed. `/api/alerts` reads the newest timestamp from each measurement and
compares its age to a staleness window (**15 min**, `FEED_STALE_MIN` — tunable). Which feeds are
silent tells us *what* is wrong:

| Climate (`sensors`) | Acoustics (`audio_noise`) | → Alert | Severity |
|---|---|---|---|
| silent | silent | **Power / network down** — whole site is dark; likely a power outage or the network is down. "Ventilation may be off — check the shed and power now." | 🔴 danger |
| live | silent | **Acoustics offline** — only the Jetson is quiet, so it's probably just unplugged. "Plug it back in." | 🟠 warning |
| silent | live | **Climate sensors offline** — only the gateway/sensor feed stopped. "Check the gateway / sensor device." | 🟠 warning |
| live | live | *(nothing — all healthy)* | — |

**Why two feeds?** They're on different hardware. If *both* die together it's almost certainly upstream
of both (power/network). If only *one* dies, the other being alive proves the site still has power — so
it's that single device, not an outage. That's what lets us give the farmer the *right* action
("plug the Jetson back in" vs "check the shed").

**Built here:** `src/lib/alerts.ts` (`powerOutageAlert`, a pure function over the two last-seen times)
+ `src/app/api/alerts/route.ts` (queries the timestamps, farm-scoped). No dwell/cooldown yet — the
platform adds those when it takes over sending.

## 🐔 Welfare

### Night disturbance  *(built — v1)*
- **Fires when:** at night (**20:00–05:00 SAST**), the **average** noise level (`noise_db_mean`) stays above **−32 dBFS** for **≥ 2 min**.
- **Says:** "Raised flock noise overnight around {HH:MM} for ~{N} min — the birds were unsettled (draught, light leak, predator?). Listen to the clip and check them." _(🟠 warning, with the 30 s clip attached)_
- **Logic:** Use the **mean, not the peak** — validated by ear on real clips. The mean = *how much of the flock* is vocalising; a single loud bang spikes the peak but barely moves the mean. Quiet-night baseline is ~−38 dBFS; a real disturbance jumps the mean ~9 dB (to ~−29) and **holds** for minutes. −32 sits cleanly between the two.
  - Detect: night points where `noise_db_mean > −32`, grouped into consecutive runs; a run counts if it spans ≥ 2 min.
  - On a hit, attach the nearest saved anomaly **clip** (S3) so the farmer can listen.
  - Backtested on 18 nights: **2 alerts (~1/week)** — 09 Aug (mean −29.7, 8 min) and 10 Aug (mean −29.9, ~2–6 min); the loud-but-brief 08 Aug transient (mean only −33) is correctly ignored.
  - Built in `src/lib/alerts.ts` (`nightDisturbanceAlert`) + `/api/alerts` (clip lookup via `acousticSource`).
  - _Note: baseline includes fan noise; an absolute mean threshold sidesteps the per-night fan-count variation (per-night baselines were too unstable to use)._

### Poor flock sleep  *(built — v1)*
- **Fires when:** the nightly **Flock Night-Rest Score** is below **70** for **2 nights running**.
- **Says:** "The flock's night-rest score has been low {N} nights running ({scores} /100). Persistent overnight disruption — {cause}." Where **{cause}** is _"overnight heat is the likely cause … improve night ventilation / cooling"_ when the poor nights ran hot (felt like ≥28.9 °C, the severe/extreme zone), else _"look for a recurring cause: predator, light leak, red mite, or equipment"_. _(🟠 warning)_
- **Logic:** A single bad night is a one-off; a *run* of them is a recurring problem. `/api/alerts` scores every night in the recent window (`noise_db_mean` + `sensors` temp/humidity) and fires when the last `SLEEP_BAD_RUN` (**2**) nights are all below `SLEEP_POOR_SCORE` (**70**). The message names **heat** when those nights sat in the severe/extreme heat zone (felt like ≥28.9 °C) (research puts heat as the #1 sleep disruptor). Built in `src/lib/alerts.ts` (`sleepDeclineAlert`) over `src/lib/sleepScore.ts` + `src/lib/thi.ts`.
- **Full logic + the score itself:** see [docs/flock-night-rest-score.md](docs/flock-night-rest-score.md) — the dark-period window, the −32 dBFS disruption line, the **five-factor** formula (disrupt-minutes, bouts, severity, pre-dawn, **experienced heat / THI**), the score bands, and the dashboard tile.

### Distress spike
- **Fires when:** sudden noise anomaly vs baseline.
- **Says:** "Sudden noise spike in {house} — check the flock."
- **Logic:** _reuse the existing `audio_noise` anomaly detection._

## 📉 Production (predicted)

### HDEP dip predicted
- **Fires when:** lay rate trending down, projected to fall below standard within ~N days.
- **Says:** "HDEP in {house} is trending down — projected ~{X} pts below standard within {N} days. Check feed, water and health now."
- **Logic:** _TBD — trend/forecast vs breed-standard curve; only fire when confident._

### Mortality rising
- **Fires when:** death rate accelerating above the breed-standard curve.
- **Says:** "Death rate in {house} is rising above the standard for its age — flag for a vet."
- **Logic:** _TBD._

## 📋 Reminders

### Fill in the daily log  *(built — v1)*
- **Fires when:** the last daily-log entry is **more than 5 days** old — or there are no entries at all.
- **Says:** "The daily log hasn't been filled in for {N} days (last entry {date}). Log today's eggs and mortality so production and HDEP stay accurate." _(🟠 warning)_
- **Logic:** `/api/alerts` reads the latest date from the sheet's `DailyLog` (normalising the date format), and compares its age to `LOG_OVERDUE_DAYS` (**5**). Fires if age > 5 days, or if there are no entries. Built in `src/lib/alerts.ts` (`logsOverdueAlert`).

### Check schedules
- **Fires when:** standing reminder.
- **Says:** "Check lighting, feed and fan schedules still match the flock's age and the season."

## ⏸ Parked (data not reliable yet)
- **Feed** — meter broken.
- **Water intake** — inaccurate now; high-value once fixed (a sudden drop is an early illness signal).

---

_Later (not v1): "sensor offline" (a single device drops while others stay live — softer than a full
outage), and two-way WhatsApp if we ever want the farmer to acknowledge/resolve._
