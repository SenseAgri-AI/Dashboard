# Alerts — spec & logic

The farmer sees alerts in the dashboard. **Push** is the live outbound channel in this repo
([`src/lib/push.ts`](src/lib/push.ts)). **WhatsApp** (Twilio) is planned and is not live.

Rules run in the **senseagri-platform hourly notifier**, not in [`src/lib/alerts.ts`](src/lib/alerts.ts).
That file only maps a stored row (`storedAlert`). The notifier writes DynamoDB
`senseagri-dev-alerts` (`ALERTS_TABLE`). [`/api/alerts`](src/app/api/alerts/route.ts) reads firing rows
when a notifier heartbeat is present. With no heartbeat, and unless `ALERTS_REQUIRE_SHARED=true`, it
falls back to [`src/lib/legacyAlertReader.ts`](src/lib/legacyAlertReader.ts). Whether the heartbeat
exists in the deployed table, and whether that env var is set on Vercel, is not visible here.
Current behavior is summarised in [docs/PROJECT_STATE.md](docs/PROJECT_STATE.md) and
[docs/alerts-implemented.md](docs/alerts-implemented.md).

Dashboard fallback function names below are from `src/lib/legacyAlerts.ts`. This spec used to attribute
the same camelCase names (`powerOutageAlert`, `nightDisturbanceAlert`, `sleepDeclineAlert`,
`logsOverdueAlert`) to platform `pipeline/alert_rules.py`. Those Python names are not in this repo, so
they are not restated. Episode dedup and resolve are platform behavior this repo does not contain.
WhatsApp delivery is not live.

**Data we can read (farm-scoped):** InfluxDB `sensors` (temp, humidity, CO₂, PM, light…), `audio_noise`
(noise level + fan baseline), silver/Athena (daily eggs, mortality, HDEP), the sheet (log, schedules),
breed-standard curve.

---

## 🌡 Climate control

### Heat stress
- **Fires when:** experienced heat (temp + humidity) above comfort, sustained. Worse if it doesn't cool overnight.
- **Says:** "Experienced heat high in {house} for {time}. Increase airflow/cooling, keep water cool, avoid handling the birds."
- **Logic:** Dashboard fallback `currentThi` (`src/lib/legacyAlertReader.ts`) uses the mean felt
  temperature over plausible AM308 samples from the last hour. Warning at 28.9 °C effective, danger
  at 30 °C (`src/lib/thi.ts`). The live evaluator is the platform hourly notifier. This repo does not
  show whether a missing hour preserves the last episode. The sentence under **Says** is the catalogue
  wording; the fallback string is the `heat_stress` message in `src/lib/legacyAlerts.ts`.

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

**How we detect it — device heartbeat.** Two *independent* feeds come off the shed. This spec does
not state how often they report:
- **Climate sensors** — the gateway side → InfluxDB **`sensors`**
- **Acoustics / mic** — the Jetson → InfluxDB **`audio_noise`**

A live device keeps writing points; a dead one goes silent. So the rule just asks *"how long since the
last point?"* for each feed. The platform notifier reads the newest timestamp from each measurement and
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

**In this repo:** fallback `powerOutageAlert` in `src/lib/legacyAlerts.ts` (`FEED_STALE_MIN` = 15).
The live evaluator is the platform hourly notifier. DynamoDB dedup is not implemented in this repo.

## 🐔 Welfare

### Night disturbance  *(built — v1)*
- **Fires when:** at night (**20:00–05:00 SAST**), the **average** noise level (`noise_db_mean`) stays above **−32 dBFS** for **≥ 2 min**.
- **Says:** "Raised flock noise overnight around {HH:MM} for ~{N} min — the birds were unsettled (draught, light leak, predator?). Listen to the clip and check them." _(🟠 warning, with the 30 s clip attached)_
- **Logic:** Use the **mean, not the peak** — validated by ear on real clips. The mean = *how much of the flock* is vocalising; a single loud bang spikes the peak but barely moves the mean. Quiet-night baseline is ~−38 dBFS; a real disturbance jumps the mean ~9 dB (to ~−29) and **holds** for minutes. −32 sits cleanly between the two.
  - Detect: night points where `noise_db_mean > −32`, grouped into consecutive runs; a run counts if it spans ≥ 2 min.
  - On a hit, attach the nearest saved anomaly **clip** (S3) so the farmer can listen.
  - Recorded backtest, not a current rate: 18 nights, **2 alerts** — 09 Aug (mean −29.7, 8 min) and 10 Aug (mean −29.9, ~2–6 min); the loud-but-brief 08 Aug transient (mean only −33) was ignored.
  - In this repo: fallback `nightDisturbanceAlert` in `src/lib/legacyAlerts.ts`. `/api/alerts` can attach a clip from `acousticSource` on either the shared-store path or the fallback.
  - _Note: baseline includes fan noise; an absolute mean threshold sidesteps the per-night fan-count variation (per-night baselines were too unstable to use)._

### Poor flock sleep  *(built — v1)*
- **Fires when:** the nightly **Flock Night-Rest Score** is below **70** for **2 nights running**.
- **Says:** "The flock's night-rest score has been low {N} nights running ({scores} /100). Persistent overnight disruption — {cause}." In the dashboard fallback, **{cause}** is overnight heat when the poor nights ran hot (felt like ≥28.9 °C), else too little darkness when each of those nights has under 6 h dark, else predator, light leak, red mite, or equipment. _(🟠 warning)_
- **Logic:** A single bad night is a one-off; a *run* of them is a recurring problem. The dashboard fallback `sleepDeclineAlert` (`src/lib/legacyAlerts.ts`) fires when the last `SLEEP_BAD_RUN` (**2**) nights are all below `SLEEP_POOR_SCORE` (**70**). The message names **heat** when those nights sat in the severe/extreme zone (felt like ≥28.9 °C), else **too little darkness** when every poor night has under 6 h of darkness, else the generic list. The live evaluator is the platform notifier; this repo does not contain its Python.
- **Full logic + the score itself:** see [docs/flock-night-rest-score.md](docs/flock-night-rest-score.md) — the dark-period window, the −32 dBFS disruption line, the **six-factor** formula (disrupt-minutes, bouts, severity, pre-dawn, experienced heat / THI, **darkness**), the score bands, and the dashboard tile. Code: `src/lib/sleepScore.ts`.

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
- **Logic:** The dashboard fallback `logsOverdueAlert` (`src/lib/legacyAlerts.ts`) reads the latest date from the sheet's `DailyLog` and compares its age to `LOG_OVERDUE_DAYS` (**5**). Fires if age > 5 days, or if there are no entries. The live evaluator is the platform notifier.

### Check schedules
- **Fires when:** standing reminder.
- **Says:** "Check lighting, feed and fan schedules still match the flock's age and the season."

## Not evaluated by the dashboard fallback
- **Feed mass (kg).** `meters_hourly` stores feed as pulses, not kilograms (`src/lib/silverSource.ts`). This spec does not describe a live feed-kg alert, and it does not say whether an auger counter is healthy.
- **Water deviation.** Approved design only: [docs/calculations/water-deviation-alerts.md](docs/calculations/water-deviation-alerts.md). `legacyAlertReader.ts` does not run it. This repo does not show whether the platform notifier does.

---

_Later: two-way WhatsApp, if the farmer should acknowledge or resolve an alert. One-way WhatsApp is
also not live. A single-device "sensor offline" case softer than the power rules above is not a
separate rule in this repo; the fallback already splits acoustics-only and climate-only silence._
