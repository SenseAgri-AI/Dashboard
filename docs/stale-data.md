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

Farmer-facing labels avoid jargon: "Felt temperature" (was "Felt temp · THI"), "comfortable below 27.8°" (since 2 Nov "watch from 28.9°", see docs/today-card.md),
air-quality band "shaded = usual range" (was "±2σ baseline"), Home "Lay rate (hen-day)" (was "Hen-day %"),
and the house chart's "Loading lay rate…" / "Couldn't load the lay-rate chart." (was "HDEP"). The
Analytics explorer keeps the technical names.

## Analytics and noise wording (2 Nov)

Farmer story: *"I'm not a data engineer; tell me what the line is, and don't tell me my birds are stressed because a door banged."*
- Analytics series: "Air quality (TVOC)", "Dust (PM2.5/PM10)", "Felt temperature". Captions drop "InfluxDB" / "AWS silver layer" ("Last month, at N resolution", "One point per day").
- Noise: "spike anomalies" → "sudden loud sounds" / "loud spikes". The Dashboard noise badge no longer says "Stressed flock" for one spike (a tractor or door gives the same spike): it says "Loud spike: listen to the clip" (amber), "Noisier than usual" (red, louder than baseline by >4 dB) takes priority, and the calm state reads "Usual noise level". Early warning, never a cause.
- Noise badge spike rule (2 Nov, `src/lib/spikeBadge.ts`): by day a single loud spike is routine (people, feeding, machinery), so amber needs **2+ spikes in the last hour** ("Loud spikes: listen to the clips"); at night (20:00–05:00 farm-local) **one** is enough ("Loud sound at night: listen to the clip"). Red dots on the chart still mark every spike. Story: *amber should mean something unusual, not a normal working day.* A two-week replay cut the time the badge sat amber from about a fifth of the day to under a tenth.
- Live dashboard Production: "Hen-day %" → "Lay rate" (sub "hen-day · hen-housed N%"), matching Home and Analytics. The **Egg weight** tile hides when no eggs were weighed in the 30-day window (the daily log's last weight is 9 Aug, so it showed an empty "—"), and says "weighed D Mon" when the latest weight is older than the latest log day. Farmer story: *"Don't show me an empty tile, and don't pass off an old weight as today's."*

## Analytics daily-log notice (2 Nov)

Farmer story: *"If the egg or deaths chart in Analytics just stops, tell me the copy is behind, so I don't think I stopped laying or forgot to log."*
- Analytics daily-log metrics (eggs, sizes, weight, broken eggs, deaths, lay rate, cumulative mortality, breakage) come from the analytics copy of the log (silver), which can fall behind; Home and the Live dashboard read the live log.
- `/api/analytics/series` returns `logLastDay` (latest day with an egg count) when a daily-log metric is shown. Analytics shows "Daily-log figures here last updated D Mon (N days ago). Home shows the latest log." above the chart when it is more than 2 days old (`src/lib/logFreshness.ts`). Climate, water and feed charts don't trigger it.
- The assistant's history tool already reports the last egg-log date.
- Live dashboard temperature status messages (`/api/dashboard/summary`) no longer state causes ("birds diverting energy… expect increased feed intake"); they read e.g. "Cold night: N°C inside. Early warning: check curtains and draughts." The Light tile's hint "photoperiod" now reads "shows lights on/off".
- Analytics noise caption: "Sound level in the house (higher = louder; includes fans, not calibrated). Red dots are sudden loud sounds… tap one to hear the ~30 s clip." (dropped "relative dBFS" and the "POC: house1 / mic_001" note).
- Egg counting: the big "Total today" card is now "Camera count today" (sub "both A-frames · not the log total"), so it isn't read as the day's egg total.

## One house climate sensor silent (2 Nov)

Story: the house has more than one climate sensor; if one stops, the house numbers quietly become the other
one's, so "Climate" still looks fresh. I want to know so I check that sensor.

- `/api/freshness` returns `climateSensors` (last reading per AM308-1 sensor over 30 days, named "House sensor 1, 2…"
  in device-id order), only when the house has two or more.
- Today card **Sensors** line, amber: "House sensor 2: no data for 4 h; house numbers are from the other sensor only",
  using the climate stale window (`staleMinutes.climate`). "no data this month" when it has not reported in 30 days.
- Only while the Climate stream itself is fresh; when every sensor is silent the usual Climate item shows instead.
- A sensor removed on purpose keeps showing for up to 30 days (until it drops out of the 30-day window).
