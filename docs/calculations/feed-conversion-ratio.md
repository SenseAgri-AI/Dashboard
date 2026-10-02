# Silo-derived feed conversion ratio

Status: **provisional calculation design; not ready for production display**.

The goal is weekly feed conversion ratio (FCR):

`FCR = feed consumed (kg) / egg mass produced (kg)`

## Provisional cylinder conversion

For a straight cylindrical section:

`mass per depth = π × radius² × bulk density`

Using the current rough estimates of radius 2 m and density 600 kg/m³:

- mass per metre = `π × 2² × 600 ≈ 7,540 kg/m`;
- mass per millimetre = approximately `7.54 kg/mm`;
- 3.5 m of measurable cylinder would hold approximately `26,400 kg`.

These values are highly sensitive to the actual internal radius and bulk density. Keep them configurable and visibly provisional. They must not alter the existing silo percentage calibration or radar-distance graph.

## Weekly feed consumed

Within the validated straight-cylinder region:

`feed used = opening estimated mass + confirmed deliveries − closing estimated mass`

Since radar distance increases as feed is consumed, cylinder drawdown mass can equivalently be computed from the positive increase in head-space distance. Refill events must be separated from consumption and should use delivery weights where available.

Do not infer feed mass while the surface is in the sloped funnel. Show the week as unavailable or partial rather than fabricating a value.

## Egg mass

`egg mass kg = egg count × representative average egg weight grams / 1000`

Prefer measured daily average egg weight. If it is absent, do not silently choose a breed-table weight. A clearly labelled estimate may be added only after product approval.

## Inputs still requiring validation

- actual internal silo radius and measurable cylinder depth;
- radar reading at the cylinder/funnel boundary;
- installed radar offset and blind zone;
- feed bulk density for the delivered ration;
- feed delivery timestamps and weights;
- reliable weekly opening and closing radar observations;
- complete egg counts and average egg weights.

Until these are available, the app may show the raw evidence and trend, but it must not present a numeric FCR as measured fact.
