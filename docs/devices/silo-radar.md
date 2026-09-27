# Silo radar

Last reviewed: 2026-09-27.

## Measurement meaning

The radar measures head-space distance from the sensor to the feed surface in millimetres. A larger reading means the feed surface is farther away and the silo contains less feed.

The current dashboard history graph intentionally displays this raw distance in millimetres. Preserve its unit and direction unless a separately approved product change replaces it.

## Physical estimates

These are **provisional farm estimates**, not a production calibration:

- measurable straight cylinder depth: approximately 3.5 m;
- sloped funnel below the cylinder: approximately another 3 m;
- cylinder radius: approximately 2 m;
- bulk feed density: approximately 600 kg/m³.

The cylinder and funnel must not be added to create a 6.5 m percentage calibration or validity cutoff. Feed depth in the sloped funnel does not map linearly to volume.

## Desired future low-level behavior

Once the feed surface enters the funnel region, hide the percentage and show **Running low**. The precise radar distance for that transition must be measured on the installed silo. A previously discussed “20%” describes the rough operational region; it is not a validated calibration constant.

## Data quality

Radar reporting can be sparse and readings can bounce. For trends:

- retain raw samples for inspection;
- smooth only a derived trend line and identify the smoothing method;
- do not replace raw data with smoothed values;
- do not silently clamp unexpected readings;
- investigate readings outside the physically measured installation before classifying them.

Current application constants in `src/app/api/silo-levels/route.ts` are existing product behavior, not validated physical dimensions. Changing them requires a dedicated calibration task and visual verification of the silo cards and distance graph.
