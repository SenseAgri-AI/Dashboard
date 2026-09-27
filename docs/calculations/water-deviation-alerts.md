# Water deviation alerts

Status: **approved alert design from backtest discussion; implementation/deployment not verified on the current branch**.

The two meters serve separate A-frames with similar bird counts. Calculate litres per meter from cumulative pulses, then compare the frames. Baselines use the preceding 21 days and must exclude the interval being evaluated.

## 1. Acute three-hour zero-flow alert

Evaluate non-overlapping or explicitly documented rolling three-hour totals for each frame.

Trigger only when:

- one frame records zero litres;
- the other frame records a meaningfully high volume; and
- the observed absolute difference is at least 2 standard deviations beyond the 21-day baseline.

The “meaningfully high” rule must be fixed from the accepted backtest before implementation; do not invent it. Identify which frame is zero/lower.

Example farmer wording:

> **Water use is unusually low in A-frame 1**
>
> A-frame 1 recorded 0 L while A-frame 2 recorded 180 L in the last 3 hours. Please check the water supply and pressure in A-frame 1. The normal difference range is 0–60 L.

## 2. Six-hour divergence alert

Compare the absolute difference between the two frames' six-hour totals with the preceding 21-day distribution. Trigger at 3 standard deviations.

Example farmer wording:

> **Large difference in water use**
>
> The two A-frames differed by 240 L in the last 6 hours. The normal difference range is 0–110 L. Please check both water lines and pressure.

## 3. Daily divergence alert

After a complete farm-local day, compare yesterday's absolute difference with the preceding 21-day distribution. Trigger at 3 standard deviations.

Example farmer wording:

> **Yesterday's water difference was unusually high**
>
> The two A-frames differed by 620 L yesterday. The normal daily difference range is 0–290 L. Please check the water system and compare the two frames.

The numbers above illustrate message structure only. Production messages must use the evaluated interval and its actual baseline.

## Statistical and delivery requirements

- Define whether standard deviation is sample or population and use it consistently in backtests and production.
- Use absolute differences for the farmer-facing value and normal range.
- Require sufficient valid baseline coverage. Do not treat telemetry gaps as zero.
- Account for the 10 L pulse resolution and possible under-reading below roughly 50 L/hour.
- Deduplicate overlapping alerts and define reminder/clear behavior.
- Link every sent alert to the farm, evaluated interval, meter values, baseline window, threshold, and rule version for later audit.
