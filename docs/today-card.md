# Today in 30 seconds + freshness badges (Home)

Status: **implemented on branch `jack/today-card-freshness`; thresholds marked PROVISIONAL need a backtest.**

Rules: `src/lib/todayStatus.ts` (pure, tested in `tests/today-status.test.mjs`). UI: `src/components/TodayCard.tsx`.
New read-only endpoint: `/api/freshness` (latest reading time per stream, farm-scoped, 7-day lookback).

| Line | Source | Green / amber / red |
|---|---|---|
| Birds | `/api/production` (DailyLog counts, **not** the egg camera) + welfare alerts | Hen-day % drop vs median of previous 7 logged days (3 / 6 pts, needs ≥3 days, PROVISIONAL); deaths vs mean of previous 7 days (2× / 3×, min 3 deaths, PROVISIONAL); log > 2 days old → amber |
| Climate | `/api/dashboard/summary` latest-hour averages + climate alerts | Felt temp (Marai THI) 28.9 / 30 °C (same as heat alert); CO₂ 800 / 1400 ppm (same as `thresholds.ts`) |
| Water | `/api/freshness` per meter + water alerts | Meter stale (90 min / 6 h, PROVISIONAL) or a firing water alert. No volume judgement on the card |
| Feed silo | `/api/silo-levels` `low` flag | Running low → amber. No percentage, no days-left |
| Data health | Freshness badges + power alerts + notifier `stale` | Worst stale stream |

Freshness windows (minutes, amber / red): climate and sound 15 / 60 (15 = `FEED_STALE_MIN`), water 90 / 360, silo 720 / 2880,
egg camera 1560 / 3000 (PROVISIONAL). Daily log days: 2 / 5 (5 = `LOG_OVERDUE_DAYS`).

A failed check shows grey "couldn't check" — never stale and never OK. A firing alert can raise a line's colour, never lower it.

Per-farm config (SSM `/senseagri/farms/<slug>/config`), both optional:

```jsonc
"waterMeters": [ { "deviceId": "<devEui>", "name": "A-frame 1" }, { "deviceId": "<devEui>", "name": "A-frame 2" } ],
"today": { "staleMinutes": { "silo": { "amber": 1440 } }, "hdepDropPts": { "amber": 4 } }
```

Without `waterMeters` the card falls back to the single `waterDeviceId`.
