# Ventilation page

Status: on branch `jack/today-card-freshness`. All thresholds are PROVISIONAL until a farmer or vet confirms them; each one can be overridden per farm (`ventilation` in the farm config).

Route `/ventilation` (nav: Ventilation). Data: `/api/ventilation` = inside climate (AM308-1, 30-min averages, last 8 days, read-only) + outside forecast from Open-Meteo (free, no key; hourly temperature, RH, rain chance, wind; sunrise/sunset; 8 days back, 4 ahead; cached 30 min).
Rules: `src/lib/ventilation.ts`, tested in `tests/ventilation.test.mjs`. UI: `src/components/VentilationView.tsx`.

**Farm location is required for the forecast**: `"location": { "lat": …, "lon": … }` in `/senseagri/farms/<slug>/config`. Without it the page shows a "location not set" note and inside readings only.

**Privacy:** the farm's coordinates (rounded as configured) are sent to Open-Meteo, a third-party weather API, with each forecast request (at most every 30 min per server). No other farm data leaves the dashboard.

## What's on the page and why

| Block | User story |
|---|---|
| **Suggestions** (top, "Today" before "Plan") | As a farmer, I want one or two plain suggestions about curtains and fans for today and tonight, so I don't have to read charts to decide. |
| Hot afternoon: "Hot afternoon forecast (33 °C around 14:00): consider opening up and fans on before 11:00". Day max ≥ `hotDayC` 30 °C; "before" = first hour ≥ `heatStartC` 27 °C minus `fansLeadHours` 1; "now" when that's past. Today, else tomorrow, by the farm's local date (before sunrise it is still "today"). | As a farmer, when a hot afternoon is coming, I want to know by when to open up, so heat doesn't build before I react. |
| Cold night: "Cold night ahead (min 8 °C): consider closing curtains and reducing fans by dusk (18:40)". Tonight's outside min ≤ `coldNightC` 10 °C; mentions last night inside vs the flock's usual when ≥ 3 °C colder. | As a farmer, when a cold night is coming, I want a reminder before dusk, so the birds don't spend the night cold. |
| High CO₂ + cold outside: "consider minimum ventilation, don't close fully". Inside CO₂ ≥ 1400 ppm for 60 min (same as the Today card; needs one more reading than the dwell spans, so never a lone reading after a gap) and outside now ≤ 15 °C. | As a farmer closing up for the cold, I want to be told when the air is getting bad, so I keep minimum ventilation instead of sealing the house. |
| Damp when closed up: last night's inside RH max ≥ 80 %, or ≥ 10 pts above the usual night, and a cold night ahead. No ammonia sensor, so RH is the proxy. | As a farmer, I want to know when closing up risks damp litter and ammonia, so I keep some air moving and check litter. |
| Cooler outside now: inside feels ≥ 27.8 °C and outside is ≥ 3 °C cooler. | As a farmer on a hot evening, I want to know when outside air would cool the house, so I open up at the right moment. |
| Best time to air out today: the warmest ≤ 4 h of remaining daylight with outside 16–28 °C and rain chance < 50 %, shown only when the house will be closed (cold night, high CO₂ or damp). | As a farmer in cold weather, I want the best window to air the house, so I flush CO₂ and moisture without chilling the birds. |
| **Inside now**: temperature (with outside now), felt temperature (Marai THI, as on Home), **chill estimate = min(actual, felt) − 3 °C** (Dylan's rough estimate, labelled as such). "Felt" is never shown above the actual temperature: the Marai THI reads warmer than the air below ~14.4 °C (10 °C at 60 % RH → 10.5), so in the cold felt = actual, CO₂. If the newest reading is over 90 min old the block says when it was ("No inside reading since 30 Oct 14:10 (2 days ago). Check the climate sensor and gateway power.") instead of showing old numbers as now. | As a farmer, I want the current inside conditions next to outside, so I can judge the suggestions myself. |
| **Today & tonight**: outside forecast min–max for daylight and for the night (sunrise/sunset), next to inside today so far and inside last night (measured), with the flock's usual (median of the last 7 days/nights). | As a farmer, I want day vs night outside compared with what my house actually did, so I know how much the curtains need to do. |
| **Next 3 days**: outside day max / night min, hot and cold nights highlighted. | As a farmer, I want to see the next few days at a glance, so I can plan curtain and fan work. |
| **Chart**: last 24 h inside + outside, next 72 h outside, nights shaded. | As a farmer, I want to see how inside follows outside, so I can trust (or question) the suggestions. |

Every prompt is worded as a suggestion ("consider …") with a one-line "why"; none claims a cause.

## Cut (not shown)

- Wind and rain as their own prompts: the forecast has them but not wind direction relative to the curtains; rain only limits the airing window.
- Inside forecast or "predicted inside temperature": no validated model yet.
- Dew point, pressure, PM: not decision-relevant for curtains and fans here.

## After sunset

The Day box always shows the next daylight period. After sunset that is tomorrow, which has no inside
readings yet, so the page used to show "inside so far –" every evening. Now the Day box shows the range from the day that
just ended (measured), the same way the Night box uses last night. Labels follow farm-local calendar
dates: from sunset to midnight the heading reads "Tomorrow · outside vs inside" and the range is "inside
today (measured)"; from midnight to sunrise the heading is "Today & tonight" and the range is "inside
yesterday (measured)". If an inside figure is still blank it says why:
"No inside reading since 1 Nov, 12:41" (sensor quiet over 90 min), "Day just started", or "No inside
readings in this period".
