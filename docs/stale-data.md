# Stale and empty data: what each page says

Rule: never show an old reading as "now", and never show "nothing logged" when the list simply failed to
load. Each notice says what is missing, since when, and what to check.

| Page / block | When | Says |
|---|---|---|
| Home · Today card | a check failed | "Some checks didn't load — try again later." (never "All good") |
| Home · Today card | water check still loading | headline "Nothing flagged yet", "Checking water use…" |
| Home · Today card · Sensors | climate / water meter / silo radar quiet past its window | which device and how long (docs/today-card.md) |
| Live dashboard · climate tiles | no climate reading in the last hour | "No climate reading in the last hour (last around 1 Nov, 12:30). Check the climate sensor and gateway power. Charts show the last 24 h." The time is the end of the last 30-min chart block, so it is never earlier than the real reading. With no reading in the whole 24 h window: "No climate readings in the last 24 hours. Check the climate sensor and gateway power. Charts show the last 24 h." The felt-temperature tile is blank too, not the last old value. |
| Ventilation · Inside now | newest reading over 90 min old | "No inside reading since … (N h ago). Check the climate sensor and gateway power." |
| Feed tab, Events tab, Daily log | list failed to load | "Couldn't load …, so don't re-enter them yet. Try again" |

## Plain labels (2 Nov)

Farmer-facing labels avoid jargon: "Felt temperature" (was "Felt temp · THI"), "comfortable below 27.8°",
air-quality band "shaded = usual range" (was "±2σ baseline"), Home "Lay rate (hen-day)" (was "Hen-day %"),
and the house chart's "Loading lay rate…" / "Couldn't load the lay-rate chart." (was "HDEP"). The
Analytics explorer keeps the technical names.

## Analytics and noise wording (2 Nov)

Farmer story: *"I'm not a data engineer; tell me what the line is, and don't tell me my birds are stressed because a door banged."*
- Analytics series: "Air quality (TVOC)", "Dust (PM2.5/PM10)", "Felt temperature". Captions drop "InfluxDB" / "AWS silver layer" ("Last month, at N resolution", "One point per day").
- Noise: "spike anomalies" → "sudden loud sounds" / "loud spikes". The Dashboard noise badge no longer says "Stressed flock" for one spike (a tractor or door gives the same spike): it says "Loud spike: listen to the clip" (amber), "Noisier than usual" (red, louder than baseline by >4 dB) takes priority, and the calm state reads "Usual noise level". Early warning, never a cause.
- Live dashboard Production: "Hen-day %" → "Lay rate" (sub "hen-day · hen-housed N%"), matching Home and Analytics. The **Egg weight** tile hides when no eggs were weighed in the 30-day window (the daily log's last weight is 9 Aug, so it showed an empty "—"), and says "weighed D Mon" when the latest weight is older than the latest log day. Farmer story: *"Don't show me an empty tile, and don't pass off an old weight as today's."*
