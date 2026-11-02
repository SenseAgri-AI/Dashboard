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
| Hot afternoon: "Hot afternoon forecast (33 °C around 14:00): consider opening up and fans on before 10:00". Day max ≥ `hotDayC` 30 °C; "before" = first hour ≥ `heatStartC` 27 °C minus `fansLeadHours` 2 (provisional, 2 Nov: on recent hot days the house was already at about 28 °C by the time outside reached 27 °C, so one hour was often too late); "now" when that's past. Today, else tomorrow, by the farm's local date (before sunrise it is still "today"). | As a farmer, when a hot afternoon is coming, I want to know by when to open up, so heat doesn't build before I react. |
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

## Hot inside likely (house's own afternoon gain)

*As a farmer, when a warm (not hot) day will still make my house hot, I want to be told in the morning, so I
open up and start fans before the heat builds.*

On 2 Nov the forecast peak was 28 °C, below the 30 °C "hot afternoon" trigger, yet the house reached
32–34 °C on most of the previous 8 days (about 3–6 °C above outside at peak). The hot-day prompt now also
fires when:

- the outside forecast peak is at least `heatStartC` (27 °C), and
- that peak plus the house's usual gain reaches `insideHotC` (32 °C, the Today card's dry-bulb amber).

The gain is the median of (inside daily max − outside daily max) over the last 7 complete days with an
outside max of at least `gainMinOutsideC` (24 °C; cool days overstate it because of the birds' own heat),
needing at least `minGainDays` (4). Fans are suggested `fansLeadHours` before outside reaches
`insideHotC − gain`.

Example (real data, 2 Nov 08:00): "Hot inside likely this afternoon (about 33 °C): consider opening up and
fans on before 12:00" / "Forecast 28 °C outside around 15:00, and on 7 warm days this past week the house
peaked about 5 °C above outside." Replay of the last 8 days: it would have fired on the 30 Oct – 2 Nov hot
spell (inside reached 32–34 °C) and stayed quiet on 28 Oct (24 °C outside, inside 30 °C). All thresholds
PROVISIONAL and per-farm.

## Cooler outside now: dry-heat backstop

The flush-heat prompt needed inside to *feel* 27.8 °C+. In dry heat the felt index reads low: on 1 Nov at
17:00 the house was 29.1 °C at 33 % RH ("feels" 26 °C) with 25.6 °C outside, and no prompt showed. It now
also fires when inside air is at least `warmInsideC` (29 °C, PROVISIONAL) and outside is 3 °C+ cooler; the
"why" says the air is dry but the heat is still there.

## Next 3 days: likely inside peak

Farmer story: *"Looking at the next three days, I want to know which afternoons the house itself will get hot, not just the weather, so I can plan fans, water and work around them."*

- Each outlook day shows **inside ~N °C** = outside forecast high + this house's usual warm-day gain (the same median gain as "Hot inside likely": past complete days with outside max ≥ `gainMinOutsideC`, at least `minGainDays` of them). It turns red and bold at `insideHotC` (32 °C).
- Hidden on days whose outside high is below `gainMinOutsideC` (the gain isn't valid there) and when there isn't enough history. A one-line legend says the inside figure is a likely peak from recent warm days.
- Both hot-afternoon prompts end their "why" with *"Birds drink more in the heat: check drinkers are flowing."* Farmer story: *"On a hot afternoon, remind me of the one check that matters most besides fans."*

## Home heads-up

Farmer story: *"When I open Home in the morning, warn me about a hot afternoon or a cold night ahead without having to open Ventilation."*
- `WeatherHeadsUp` (Home, under the Today card) runs the same `buildVentilation` rules on `/api/ventilation` and shows one line only for an **act-level** prompt (`headsUpPrompt`), linking to Ventilation. When several are act-level the most urgent wins: storm passing now → storm due within 3 h → hot day → cold night (☂ for rain, ☀ heat, ☾ cold). On Ventilation, act-level suggestions are tagged "Soon" (not "Today": in the evening an act prompt can be for tomorrow morning), and the storm-passing line is listed first. The heads-up re-checks every 10 minutes, so a phone left on Home picks up a storm without a reload. Plan-level and other prompts (air out, CO₂, damp) stay on the Ventilation page.
- Silent when nothing needs doing or the forecast can't load; the Ventilation page shows those states.
- The "Hot inside likely" trigger compares the **rounded** estimate (the "about N °C" shown) with `insideHotC`, so the prompt and the outlook's red "inside ~32 °C" always agree. A backtest on the pilot house caught one more hot day this way with no extra false alarms (numbers kept out of the public repo).

## Rain likely: be ready to close curtains

Farmer story: *"On a hot day the house is wide open. When a storm is coming I want time to close up before wind and rain blow in and the house chills fast."*

- The first daylight hour, for the rest of today or tomorrow, with forecast rain chance ≥ `stormRainPct` (70 %, provisional) gives "Rain likely today|tomorrow around HH:00 (N% chance): be ready to close curtains". It is **act** (and then also shows as the Home heads-up) only within 3 h *and* with a storm sign: a forecast outside drop ≥ `stormDropC` (6 °C) or gusts ≥ `stormGustKmh` (50 km/h). Plain rain stays a **plan** note on Ventilation, so summer afternoons with a routine rain chance don't nag on Home.
- The why line gives the forecast outside drop around then when it is ≥ 4 °C. Night rain doesn't trigger it.
- Open-Meteo's storm timing can be an hour or two out, so the wording is "around" and "be ready", never a time to close.
- **Storm already came:** when the house has just dropped ≥ 4 °C in about 2 h *and* sits ≥ `forecastOffC` (5 °C) below the forecast outside temperature, today's forecast is treated as out of date: no "Hot … fans on now" and no "Rain likely today" for today (tomorrow's prompts still show). It also needs a rain signal: rain forecast ≥ `stormRainPct` within ±2 h of now, or inside humidity up ≥ `stormRhRise` (15) points on the last ~2 h (provisional: about the 95th percentile of ordinary daytime 2-hour rises; storms give clearly more) **with** at least `stormRhRainPct` (40 %, provisional) rain chance forecast within ±3 h. Evaporative pads also raise humidity while they cool, so a humidity jump never counts on its own (Code Reviewer, 2 Nov). So fans or pads pulling a hot house down sharply, with the outside peak still ahead, keep the hot-day prompt, and a house that simply runs below outside keeps it too. - **Rest of the day after a storm (2 Nov replay):** once any 30-min reading today met the storm-cooled check, today's hot-day and "Rain likely today" prompts stay off for the rest of the farm-local day (tomorrow's still show). The "below the forecast" part compares with the warmest forecast hour within ±1 h, because the forecast can put the storm's drop in the next hour. Farmer story: *"The storm came at 14:30; at 17:00 don't tell me rain is likely around 16:00."*
- **Storm passing now (`storm-now`, act):** when that storm-cooled check holds (sharp drop + well below forecast + rain signal), Ventilation and Home show "House cooled fast (A → B °C in about 2 h): if a storm is passing, check curtains", worded as an early warning. It clears by itself once the drop is more than ~2 h old. Ordinary evening cooling has no rain signal, so it stays quiet. Farmer story: *"If a storm hits while I'm away from the house, tell me while closing up still helps."*

Today's card shows the measured peak "(peak)" only while the inside sensor is still reporting; if it goes quiet the card falls back to the estimate. Farmer story: *"After the storm the house is cool; don't tell me to put the fans on."*
- The 3-day outlook shows "☂ N%" (blue) on days whose highest daytime rain chance is ≥ `stormRainPct`, with a legend note.
- **Today, after the peak:** once the forecast peak hour has passed (or a storm has cooled the house), the Today card shows the **measured** inside maximum so far as "inside N °C (peak)" instead of the estimate. Farmer story: *"In the evening, show me how hot it actually got, not the morning guess."*
- The why line adds "Gusts up to about N km/h." when forecast gusts (Open-Meteo `wind_gusts_10m`, now fetched) reach `stormGustKmh` (50, provisional) between an hour before and two hours after the rain hour.
- **Cold night ahead** why line adds "Inside likely about N °C, going by recent nights." = forecast outside minimum + the median (inside night low − outside night low) over recent nights (at least `minGainDays` of them). Farmer story: *"Tell me how cold the house itself will get, not just the weather."* Houses here track outside closely at night (details in the private findings).
- **Outlook, cold nights (2 Nov):** in the 3-day outlook a night is blue (cold) by the same rule, and when the likely inside low is ≤ `coldNightC` a blue "inside ~N°C" sits under ☾. Each day now reads ☀ high → inside peak → ☾ low → inside low → ☂, so each inside figure sits under its own outside figure.
- **Cold night by the house (2 Nov):** the prompt also fires when that likely inside low is ≤ `coldNightC`, even if the outside forecast is milder: "Cold night inside likely (about N °C): consider closing curtains and reducing fans by dusk (HH:MM)", why "Forecast outside minimum N °C, and on recent nights the house ran about N °C below outside." Farmer story: *"In the warm season the house is left open and can run colder than outside at night; warn me by the house, not only the forecast."* A replay over recent weeks caught most nights the house actually went to 10 °C or below, which the outside-only rule mostly missed (figures in the private findings).

### Threshold calls (2 Nov)

Dylan asked for these to be decided, not left provisional:
- `stormRainPct` 70 %: "likely" in plain words; 50–60 % chances are common on summer afternoons.
- `stormDropC` 6 °C: routine evening cooling is 4–5 °C an hour, so 6 °C+ around a rain hour points to a storm front.
- `stormGustKmh` 50 km/h: strong enough to drive rain through open curtains.
- `forecastOffC` 5 °C: by day these houses run at or above outside, so 5 °C below plus a sharp drop means the forecast is stale.
- `stormRhRise` 15 points: about the 95th percentile of ordinary daytime 2-hour humidity rises; storms gave clearly more.
- `stormRhRainPct` 40 %: a humidity jump only counts with at least this rain chance within ±3 h (pads raise humidity too).
- `fansLeadHours` 2 h: on recent hot days the house was already warm by the time outside reached `heatStartC`.
- `coldNightC` 10 °C now also applies to the likely inside low, not only the outside forecast.
- Kept `forecastOffC` at 5 °C after a 4-week replay: 4 °C added night-time "cooled fast" lines without catching more storms.
All are per-farm overridable via `ventilation` in the farm config.
- Home placement (2 Nov): the heads-up sits inside the status band, right under the Today card and above the health dial on a phone (full width under both on a wide screen). Phone order: Today card → heads-up → health dial → This week → Farm overview → Houses.
