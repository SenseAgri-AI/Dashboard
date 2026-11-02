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
     - Deaths: **one day** ≥ 3 deaths and ≥ 2× the usual daily rate (previous 7 days) → amber. **Red** when the last 7 logged days total ≥ 7 and ≥ 2× the prior weekly rate (previous 4 weeks, needs ≥ 2 weeks) → "Check the birds today; consider calling the vet".
     - Log missing > 2 days → amber, > 5 days (`LOG_OVERDUE_DAYS`) → red.
     - Platform welfare alerts: only `sleep_decline` (2 poor nights) raises Birds. `night_disturbance` (17 firings in 7 weeks) does not.
   - **Climate**: *when the house gets hot or the air stays bad, give me one number and what to do.* Always "`T`°C (feels `F`°C)". "Feels" is capped at the actual temperature: below ~14.4 °C the Marai THI reads warmer than the air, which would be wrong for a cold house (heat bands are unaffected). The Dashboard's felt-temperature tile, the Analytics "Felt temp (THI)" series and the night-rest score's "felt" figure use the same cap.
     - Primary: felt temperature (Marai THI) 28.9 / 30 °C, the same as the heat alert.
     - Dry-bulb backstop (dashboard only; the platform notifier is unchanged): the THI understates dry heat (34 °C at 24 % RH reads "feels 29.5"). If the line is otherwise green and every 30-min average temperature in the last ~30 min is ≥ `dryBulbC.amber` (default 32 °C, per farm), the line turns amber: "…, 32°C+ for 30+ min" / "Increase airflow, keep water cool". It needs one more 30-min reading than the dwell spans (2 for 30 min), so it never fires on a single reading, including a lone reading after a data gap, or without the series. 32 °C is PROVISIONAL.
     - Warming fast (early warning, dashboard only): *when the house is heating fast, warn me before it's dangerous, so I can ventilate or cool earlier.* If the line is still green and the latest 30-min average temperature is ≥ `warmingFast.floorC` (28 °C) and ≥ `riseC` (3 °C) above the 30-min average `windowMinutes` (60) earlier, the line turns amber: "… · Warming fast: up 3.5°C in the last hour" / "Early warning: check fans and ventilation". Needs both buckets and a latest bucket ≤ 60 min old; never shown once felt temp or the dry-bulb backstop is already amber. Backtest (3 Oct – 2 Nov 2026): 1.9 days/week, 7 of 8 followed by amber heat the same day (median ~3 h later). PROVISIONAL (31 days, spring only). The rise is compared after rounding to 0.1 °C, so a true 3.0 °C rise isn't missed by floating-point error. The temperature series is the average of every AM308 climate sensor on the farm (the farm config has no climate device to pin to yet), so one hot house can be diluted on a multi-house farm.
     - CO₂ appears only when every 30-min average for the last 60 min is ≥ 1400 ppm (the existing danger band); then the line is red. About 15 episodes in the history.
3. **Only on a problem**
   - **Water**: water use well below the flock's own normal for 2+ days, one meter quiet while the other is normal ([water-use-check.md](water-use-check.md)), or a firing platform water alert (names the A-frame). The water-use query (Athena, a few seconds when not cached) loads separately, so it never delays the rest of the card; the Water line can appear a moment later. Until it arrives the headline says "Nothing flagged yet" with "Checking water use…" underneath, never "All good".
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
  "warmingFast": { "riseC": 3, "windowMinutes": 60, "floorC": 28 },
  "hdepDrop": { "pts": 4, "amberDays": 2, "redDays": 3 },
  "mortality": { "weekMin": 10 },
  "birdsAlertTypes": ["sleep_decline"]
}
```

Without `waterMeters` the card falls back to the single `waterDeviceId`.

All fields are optional and deep-merged over the defaults in `DEFAULT_TODAY_THRESHOLDS`; non-numeric or negative values are ignored.

## Wording rule (all cards)

Amber lines that come from a change against the flock's own normal start with **"Early warning: check …"**
and name what to check, never a cause: lay drop ("check water, feed and the birds"), a bad day of deaths
("check the birds"), water use ("check drinkers, pressure and the birds"), one quiet drinker line, and
"Warming fast". Red lines drop the prefix and say "today" or "now". The This week card and the Ventilation
prompts follow the same rule (docs/this-week.md, docs/ventilation.md).

## Live dashboard temperature tiles follow the Today card (2 Nov)

Farmer story: *"If the Today card says the house is fine and the Live dashboard says 'Out of range', I stop trusting both."*
- `heatTileStatus` (in `todayStatus.ts`) applies the Climate row's heat rules to the Live dashboard: felt ≥ `feltTempC.red` → **Out of range**, felt ≥ `feltTempC.amber` or air at/above `dryBulbC.amber` for `dryBulbC.dwellMinutes` → **Watch**. The Temperature tile uses it on the hot side (cold side unchanged: the summary's < 14 °C / < 10 °C bands) and reads "hot: 32°+ or felt 28.9°+". The Felt temperature tile uses the same two felt levels ("watch from 28.9°"; before it warned from 27.8 °C).
- Uses the default thresholds (the Live dashboard doesn't load per-farm overrides).
- **Display only.** The Home health gauge still scores air temperature with the old bands (warning > 26 °C, danger > 30 °C), so the gauge can dip on a dry afternoon the Today card calls fine. Changing the score is left for Dylan to decide.
- The tiles' shaded bands match the same levels: Temperature 14–32 °C (air alone), Felt temperature up to 28.9 °C. Humid heat can still flag the Temperature tile inside its shading, through felt temperature.

## Cold house (2 Nov)

*As a farmer checking my phone before dawn after a cold night, I want the Today card to say the house is cold, not "All good".*

Climate turns amber with "Cold: 10°C or below for 60+ min" and "Early warning: check curtains and draughts" when every 30-min inside average over the last hour (three buckets) is at or below `coldC.amber` (10 °C, provisional, same as the Live tile's cold-night level and Ventilation's cold night). It never fires on one reading, and only while Climate is otherwise green. A replay over recent weeks gave a handful of cold nights, each amber from after midnight to about 06:00, and nothing in warm spells (figures in the private findings). Per-farm override: `today.coldC`.
