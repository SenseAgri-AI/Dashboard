# Implemented Alerts (live)

The alerts that **actually run today** in `/api/alerts`, with their real logic and thresholds. Planned /
not-yet-built alerts (climate, ventilation, production) live separately in
[../alerts-spec.md](../alerts-spec.md) — this file is only what's shipped.

## How the engine works

- **Pure rules** in [`src/lib/alerts.ts`](../src/lib/alerts.ts) turn already-fetched farm state into an
  `Alert` (or `null`). Data fetching lives in [`src/app/api/alerts/route.ts`](../src/app/api/alerts/route.ts).
- **Farm-scoped** — the farm is resolved server-side (`getFarmForRequest`); every query is bounded by
  `farm.farmId`. Climate reads `device_type = 'AM308-1'` only (see [sensors.md](sensors.md)).
- **Fault-isolated** — each data source is fetched with `Promise.allSettled`, so one feed failing never
  blocks, or falsely fires, another rule.
- The route returns the currently-firing alerts to the dashboard. The platform owns sending them on
  WhatsApp (Twilio); the dashboard reads and displays the same set.

**Alert shape:** `{ id, category, severity, title, message, since, clipKey? }` · severity is
`info | warning | danger`.

| # | Alert | id | Category | Severity | Fires when |
|---|---|---|---|---|---|
| 1 | Power / network down | `power_outage` | power | 🔴 danger | both feeds silent |
| 1 | Acoustics offline | `acoustics_offline` | power | 🟠 warning | only the mic silent |
| 1 | Climate sensors offline | `climate_offline` | power | 🟠 warning | only the climate feed silent |
| 2 | Fill in the daily log | `logs_overdue` | reminder | 🟠 warning | last log > 5 days old / none |
| 3 | Birds unsettled overnight | `night_disturbance` | welfare | 🟠 warning | sustained raised night noise |
| 4 | Poor flock sleep | `sleep_decline` | welfare | 🟠 warning | low sleep score 2 nights running |

---

## 1. Power / connectivity  ·  `powerOutageAlert`

Two independent feeds come off the shed, each writing ~1 point/min: **climate sensors** (gateway →
InfluxDB `sensors`) and the **acoustics/mic** (Jetson → InfluxDB `audio_noise`). A live device keeps
writing; a dead one goes silent. The rule compares each feed's newest timestamp to a staleness window.

- **Staleness window:** `FEED_STALE_MIN = 15` min (a feed with no point for longer counts as down).
- **Which feeds are silent tells us what's wrong:**

| Climate | Acoustics | → Alert | Severity | Action |
|---|---|---|---|---|
| silent | silent | **Power / network down** | 🔴 danger | "Ventilation may be off — check the shed and power now." |
| live | silent | **Acoustics offline** | 🟠 warning | "The Jetson is probably unplugged — plug it back in." |
| silent | live | **Climate sensors offline** | 🟠 warning | "Check the gateway / sensor device." |
| live | live | *(nothing)* | — | — |

- **Why two feeds:** different hardware. Both dead → almost certainly upstream (power/network). Only one
  dead → the other proves the site still has power, so it's that single device.
- **Guard:** only evaluated when *both* last-seen queries succeed — a query error must never masquerade
  as a device being down.

## 2. Daily-log overdue  ·  `logsOverdueAlert`

The daily log (eggs + mortality) should be filled every day.

- **Fires when:** the latest entry is **more than `LOG_OVERDUE_DAYS = 5`** days old, **or** there are no
  entries at all.
- **Data:** latest entry date from the farm's Google Sheet `DailyLog` (date format normalised).
- **Says:** *"The daily log hasn't been filled in for {N} days (last entry {date}). Log today's eggs and
  mortality so production and HDEP stay accurate."*

## 3. Night disturbance  ·  `nightDisturbanceAlert`

A sustained rise in the **mean** flock-noise level overnight — the whole flock unsettled, not one bang.

- **Fires when:** during the night (**`NIGHT_START_SAST` 20:00 – `NIGHT_END_SAST` 05:00 SAST**),
  `noise_db_mean` stays above **`NIGHT_NOISE_DB` = −32 dBFS** for at least **`NIGHT_MIN_MINUTES` = 2 min**
  (consecutive points above threshold).
- **Why mean, not peak / why −32:** validated by ear on real clips. Quiet-night baseline ~−38 dBFS; a
  real disturbance lifts the mean ~9 dB (to ~−29) and *holds*. −32 sits cleanly between. An absolute mean
  threshold also sidesteps per-night fan-count variation.
- **Clip:** on a hit, the route attaches the nearest saved anomaly **audio clip** (S3) via `clipKey`, so
  the farmer can listen. Evaluated over the last ~18 h of the noise series (so it's about *last* night).
- **Says:** *"Raised flock noise overnight around {HH:MM} for ~{N} min — the birds were unsettled
  (draught, light leak, predator?). Listen to the clip and check them."*

## 4. Poor flock sleep  ·  `sleepDeclineAlert`

A one-off bad night is noise; a *run* of them is a recurring problem. Built on the Flock Night-Rest
Score ([flock-night-rest-score.md](flock-night-rest-score.md)).

- **Fires when:** the nightly score is below **`SLEEP_POOR_SCORE` = 70** for **`SLEEP_BAD_RUN` = 2**
  consecutive nights.
- **Cause attribution** (names the likely cause when the data points at one):
  - poor nights all in the **severe/extreme heat** zone → names **overnight heat**;
  - else all with **< 6 h darkness** → names **too little darkness** (long days / supplemental light);
  - else the generic list (predator, light leak, red mite, equipment).
- **Says:** *"The flock's night-rest score has been low {N} nights running ({scores} /100). Persistent
  overnight disruption — {cause}."*

---

## Constants (all in `src/lib/alerts.ts`, tunable)

| Constant | Value | Alert |
|---|---|---|
| `FEED_STALE_MIN` | 15 min | power / connectivity |
| `LOG_OVERDUE_DAYS` | 5 days | daily-log overdue |
| `NIGHT_NOISE_DB` | −32 dBFS | night disturbance |
| `NIGHT_MIN_MINUTES` | 2 min | night disturbance |
| `NIGHT_START_SAST` / `NIGHT_END_SAST` | 20 / 5 | night disturbance |
| `SLEEP_POOR_SCORE` | 70 | poor flock sleep |
| `SLEEP_BAD_RUN` | 2 nights | poor flock sleep |
