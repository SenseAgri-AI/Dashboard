# Product invariants

These rules protect meanings the farmer already relies on. A task may deliberately change one, but the change must be explicit and reviewed.

## General

- Values shown as measured must come from a documented source and retain their physical unit.
- Estimated values must be labelled as estimates.
- No data is preferable to a fabricated zero or a fabricated percentage.
- Farmer-facing wording should be short and operational. Technical statistical detail belongs in supporting UI or documentation.
- Existing pages, cards, and charts outside the requested feature must remain visually and functionally unchanged.

## Time series

- Zooming or panning a chart should recompute its y-axis from the visible data where that improves readability.
- Dates shown on flock charts include flock age in weeks where the context provides a cycle start.
- Missing telemetry, no counter movement, and zero consumption remain distinguishable.

## Water

- The two water meters serve separate A-frames with similar bird counts and expected consumption.
- Each pulse represents 10 litres.
- A cumulative counter must be differenced; resets or negative differences are not consumption.
- Do not interpret a period without a pulse increment as a definite zero. It can represent less than one 10-litre pulse, flow below reliable sensitivity, or a telemetry gap.
- Farmer-facing meter comparisons use absolute differences and an absolute normal range. Do not show a negative/positive directional range.

## Silos

- Radar values are head-space distance from the sensor to the feed surface. Larger distance means less feed.
- The existing silo history graph displays distance in millimetres. Do not replace it with percentage without explicit approval.
- Do not combine the approximately 3.5 m measurable cylinder and approximately 3 m funnel into a 6.5 m calibration or cutoff.
- The funnel is sloped and cannot currently support a trustworthy percentage conversion.
- Future funnel-region behavior is **Running low**, with no percentage. The transition needs measured calibration before implementation.
- FCR experiments must not change the silo cards, percentage calibration, or history chart.

## Alerts and notifications

- A normal user must never send a test notification to every farm device.
- A subscription belongs to the authenticated user, farm, and device/browser endpoint.
- Alert evaluation and push delivery are separate steps; showing an alert on a dashboard does not prove a push was sent.
- Prevent repeated notifications for the same continuing condition unless the alert specification defines a reminder interval.
