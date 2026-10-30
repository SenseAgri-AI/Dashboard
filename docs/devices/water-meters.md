# Water meters

Last reviewed: 2026-10-29.

## Physical setup

**Confirmed by the farm:** two meters measure separate A-frames. The frames contain similar bird numbers and normally have similar consumption, so divergence can indicate a local pressure, supply, leakage, or drinking problem.

| Logical meter | Device ID | Silver column | Conversion |
|---|---|---|---|
| Water Meter 1 | `24e124136f451854` | `water_l_wm1` | 10 L per pulse |
| Water Meter 2 | `24e124136f456303` | `water_l_wm2` | 10 L per pulse |

Dylan confirmed on 2026-10-29 that these two meters are the ones in use. The platform registry lists both as `water_meter`, `enabled: true`, which matches the meter pipeline (see platform PR 28).

The house's other two EM300s, `24e124136f458449` and `24e124136f452271`, are feed (auger) meters. They are installed but unreliable, so their data is not used. The registry marks them `feed_meter`, `enabled: false`. The pipeline still writes `feed_pulses_auger1` and `feed_pulses_auger2`, and those columns should be treated as unreliable.

## How to interpret readings

`pulse_total` is cumulative. Consumption over an interval is the positive difference between consecutive counter readings multiplied by 10 L. Counter resets or negative differences are not negative consumption.

**Reported hardware behavior, datasheet still to be attached:** reliable flow sensitivity is about 50 L/hour. Below that rate the meter may under-read. Since one pulse is 10 L, an unchanged counter can also mean that consumption has not yet accumulated enough for another pulse.

Keep these cases distinct:

| Observation | Possible meaning |
|---|---|
| Row exists, counter unchanged | Less than one pulse accumulated, genuinely no use, or low-flow under-reading |
| No telemetry row | Connectivity/ingestion gap, device reporting cadence, or device outage |
| Counter increases | At least the recorded pulse volume passed; accuracy still depends on flow regime |
| Counter decreases | Reset, rollover, replacement, or bad data; do not count as consumption |

Do not forward-fill missing rows and then call them measured zero without explaining the transformation.

## Known installation timing

The devices were installed around 13 April 2026. Data before installation is not physical meter evidence. Confirm the exact commissioning timestamp before formal analysis.

## Questions for the farmer or installer

- Were drinker-line pressure, regulator settings, flush schedules, or supply routing changed?
- Were valves partially closed/opened, filters cleaned, leaks repaired, or meters repositioned?
- Did reporting cadence or pulse configuration change after commissioning?
- What are the manufacturer model, minimum accurate flow, orientation requirements, and calibration certificate?

## Related references

- `../calculations/water-deviation-alerts.md`
- `../../DATA_ACCESS.md` for Influx access examples. The dashboard total is `fetchMetersDaily` in `src/lib/silverSource.ts`, not a single meter id
- Platform `pipeline/meters_to_silver.py`
