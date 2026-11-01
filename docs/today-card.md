# Today card (Home)

Status: **implemented on branch `jack/today-card-freshness`. Thresholds were backtested on the farm's own history (Sep–Oct 2026, `/workspace/jack/backtest.md`); they remain PROVISIONAL until a farmer and vet confirm them.**
Why each element exists (or was cut): `/workspace/jack/user-stories.md` review, summarised below.

Rules: `src/lib/todayStatus.ts` (pure, tested in `tests/today-status.test.mjs`). UI: `src/components/TodayCard.tsx`.
New read-only endpoint: `/api/freshness` (latest reading time for climate, each water meter and each silo radar; farm-scoped, 7-day lookback).

## What the farmer sees

1. **Headline**: "All good", "N things need you today", or "Nothing flagged" when nothing is wrong but a check failed to load.
2. **Always shown**
   - **Birds**: *when lay rate or deaths move against my own last weeks, or I forgot the log, tell me today.* DailyLog counts only (not the egg camera).
     - Lay: each day's hen-day % vs the median of the previous 7 plausible logged days (needs ≥ 3). Amber when the last **2 consecutive** days are each ≥ 5 pts down, red at **3**. A single-day dip is ignored (in the backtest, single-day ≥ 3 pts flagged 20 % of days, mostly collection timing).
     - A hen-day % outside 20–100 % is shown as "Lay X% looks wrong" (amber, "check the last egg count in the log") and is kept out of the baselines.
     - Deaths: **one day** ≥ 3 deaths and ≥ 2× the usual daily rate (previous 7 days) → amber. **Red** when the last 7 logged days total ≥ 7 and ≥ 2× the prior weekly rate (previous 4 weeks, needs ≥ 2 weeks) → "call the vet".
     - Log missing > 2 days → amber, > 5 days (`LOG_OVERDUE_DAYS`) → red.
     - Platform welfare alerts: only `sleep_decline` (2 poor nights) raises Birds. `night_disturbance` (17 firings in 7 weeks) does not.
   - **Climate**: *when the house gets hot or the air stays bad, give me one number and what to do.* Always "`T`°C (feels `F`°C)".
     - Primary: felt temperature (Marai THI) 28.9 / 30 °C, the same as the heat alert.
     - Dry-bulb backstop (dashboard only; the platform notifier is unchanged): the THI understates dry heat (34 °C at 24 % RH reads "feels 29.5"). If the line is otherwise green and every 30-min average temperature in the last ~30 min is ≥ `dryBulbC.amber` (default 32 °C, per farm), the line turns amber: "…, 32°C+ for 30+ min" / "Increase airflow, keep water cool". It never fires on a single reading or without the series. 32 °C is PROVISIONAL.
     - CO₂ appears only when every 30-min average for the last 60 min is ≥ 1400 ppm (the existing danger band); then the line is red. About 15 episodes in the history.
3. **Only on a problem**
   - **Water**: a firing platform water alert (names the A-frame).
   - **Feed silo**: the existing silo-levels `low` flag. "Silo N running low", no percentage, no days-left.
   - **Sensors**: climate, water meters or silo radar stale, a power alert, or delayed farm-alert checks. Windows (minutes, amber / red): climate 30 / 90 (sensors report every 10 min; 15 was too twitchy), water 90 / 360, silo 2880 / 5760 **per radar** (radars report about every 3 h; a combined check hid radar `…ccc2b` going silent on 29 Oct).
   - **Other attention items** from `src/lib/attention.ts` at warning/danger. The daily-log item is already covered by Birds; the info-level "check schedules" reminder is left for a future weekly summary.
4. **Footer** "Some checks didn't load" when any source failed. Failed checks never show as green or stale.

A firing alert can raise a line's colour, never lower it. Info-level alerts don't count as problems.

## Removed or relabelled on Home

- Per-stream freshness badges and the per-line grey "couldn't check" state: replaced by the Sensors line (stale streams only) and the footer.
- Sound (mic) and egg-camera freshness: SenseAgri ops checks, not shown to farmers (the "Acoustics offline" alert still exists).
- The hardcoded "Sensing enabled" card (it showed water as Off while both meters were live).
- The separate Attention list: folded into the card.
- House card curve: "Typical layer curve (not breed-specific)", because breed is not recorded anywhere.

## Per-farm config

Optional fields in SSM `/senseagri/farms/<slug>/config`:

```jsonc
"waterMeters": [ { "deviceId": "<devEui>", "name": "A-frame 1" }, { "deviceId": "<devEui>", "name": "A-frame 2" } ],
"today": {
  "staleMinutes": { "silo": { "amber": 1440 } },
  "dryBulbC": { "amber": 33, "dwellMinutes": 30 },
  "co2Sustained": { "dwellMinutes": 90 },
  "hdepDrop": { "pts": 4, "amberDays": 2, "redDays": 3 },
  "mortality": { "weekMin": 10 },
  "birdsAlertTypes": ["sleep_decline"]
}
```

Without `waterMeters` the card falls back to the single `waterDeviceId`.

All fields are optional and deep-merged over the defaults in `DEFAULT_TODAY_THRESHOLDS`; non-numeric or negative values are ignored.
