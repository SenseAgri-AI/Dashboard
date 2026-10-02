# September 2026 water-meter findings

Status: analysis notes requiring a reproducible notebook/script before production use.

- The meters were installed around 13 April 2026; earlier dates must be excluded.
- Historical consumption appeared substantially lower in the earlier installed period even during hot weather.
- Counting intervals above the reported 50 L/hour reliable-flow threshold showed fewer reliable-range readings in the earlier period.
- Temperature and mature flock age alone did not explain the observed step-up.
- Possible farm-side causes include pressure/regulator changes, valve position, filters, flushing, leaks, supply routing, meter installation/orientation, pulse configuration, or reporting changes.
- The water meter remains the direct instrument, but direct does not guarantee accuracy outside its specified flow range.

Next evidence needed: manufacturer datasheet, exact installation/configuration history, a farm maintenance timeline, raw cumulative counters, telemetry-row coverage, and a comparison of the same temperature bands before and after the change.

Do not convert these observations into automatic correction factors. First establish whether the difference is physical consumption, measurement sensitivity, configuration, or ingestion.
