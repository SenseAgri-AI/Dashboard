# Today card (Home)

Status: **implemented on branch `jack/today-card-freshness`; thresholds marked PROVISIONAL need a backtest.**
Why each element exists (or was cut): `/workspace/jack/user-stories.md` review, summarised below.

Rules: `src/lib/todayStatus.ts` (pure, tested in `tests/today-status.test.mjs`). UI: `src/components/TodayCard.tsx`.
New read-only endpoint: `/api/freshness` (latest reading time for climate, each water meter and the silo radar; farm-scoped, 7-day lookback).

## What the farmer sees

1. **Headline**: "All good", "N things need you today", or "Nothing flagged" when nothing is wrong but a check failed to load.
2. **Always shown**
   - **Birds**: *when lay rate or deaths move against my own last week, or I forgot the log, tell me today.* DailyLog counts only (not the egg camera). Hen-day % drop vs median of the previous 7 logged days: 3 / 6 pts (needs ≥ 3 days, PROVISIONAL). Deaths vs mean of the previous 7 days: 2× / 3×, minimum 3 deaths (PROVISIONAL). Log missing > 2 days → amber, > 5 days (`LOG_OVERDUE_DAYS`) → red.
   - **Climate**: *when the house gets hot or the air stays bad, give me one number and what to do.* Felt temperature (Marai THI) 28.9 / 30 °C, the same as the heat alert. CO₂ appears only when every 30-min average for the last 60 min is ≥ 1400 ppm (the existing danger band; dwell PROVISIONAL), and then the line is red.
3. **Only on a problem**
   - **Water**: a firing platform water alert (names the A-frame).
   - **Feed silo**: the existing silo-levels `low` flag. "Silo N running low", no percentage, no days-left.
   - **Sensors**: climate, water meters or silo radar stale, a power alert, or delayed farm-alert checks. Windows (minutes, amber / red): climate 15 / 60 (15 = `FEED_STALE_MIN`), water 90 / 360, silo 2880 / 5760 (PROVISIONAL; the radar is sparse).
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
"today": { "staleMinutes": { "silo": { "amber": 1440 } }, "co2Sustained": { "dwellMinutes": 90 }, "hdepDropPts": { "amber": 4 } }
```

Without `waterMeters` the card falls back to the single `waterDeviceId`.
