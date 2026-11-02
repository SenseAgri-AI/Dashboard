# Data findings (farm_anike_001, house1)

Last updated: 2026-11-02. Read-only analysis of the silver tables (`aligned_hourly`: inside climate and the
DailyLog values; `meters_hourly`: water) and Open-Meteo history for outside temperatures. Days are
farm-local (SAST). Inside climate starts 20 Feb 2026, water meters 14 Apr 2026. Correlations are
Spearman (rho). These are observations, not causes.

**Data caveat:** the silver copy of the DailyLog ends on **11 Oct 2026** (eggs, deaths). Either the log
hasn't been filled since then or the silver import stopped. Worth checking; the October hot spell
therefore has almost no egg data yet.

## 1. The house runs hotter than outside in the afternoon, and that is predictable (used)

| | Value |
|---|---|
| Inside daily max − outside daily max (204 days) | median **+2.7 °C** (IQR 2.1–3.2) |
| Same, on days with outside max 27–30 °C (18 days) | median **+3.6 °C** |
| Days inside reached ≥ 32 °C since Feb | **12**, all from 9 Oct onwards |
| Predicting inside max = outside max + median gain of the previous 7 warm days (30 warm days testable) | mean error **1.0 °C**, 90 % within 2 °C |
| That prediction flagging inside ≥ 32 °C | **8 of 11** caught, **0** false |
| Outside-only rule (outside ≥ 30 °C) | **2 of 12** caught |

Turned into the Ventilation "Hot inside likely" prompt (docs/ventilation.md). The live prompt computes
the gain from the forecast API's own past days (consistent with the forecast it is applied to), which
reads a little higher (about +5 °C last week) than the reanalysis used here.

## 2. At night the house is as cold as outside

Inside daily min − outside daily min: median **−0.8 °C** (IQR −2.6 to +1.4). Monthly mean inside minimum
was **3.9 °C in June, 1.2 °C in July, 3.9 °C in August**. The house gives no night-time insulation, so
the outside forecast minimum is a fair guide to the inside minimum (this is what the cold-night prompt
uses). No dashboard change.

## 3. Water meters under-read most of the year (explains odd water levels)

| Month | Mean L/day (both meters) | Hours with Meter 1 flow ≥ 50 L/h (its reliable range) |
|---|---|---|
| May | 255 | 4 % |
| Jul | 360 | 2 % |
| Aug | 533 | 6 % |
| Sep | 1 646 | 37 % |
| Oct | 1 115 | 20 % |

255–533 L/day is 55–120 ml per hen for 4 479 hens; layers need roughly 200–250 ml. With two meters each
carrying about half the flow, most hours sit below the ~50 L/h reliable threshold, so the meters likely
under-read badly in cool months. The level jumps (≈430 → ≈1 800 → ≈840 L/day around 9 Sep and 9 Oct) are
far larger than temperature explains: within each period water rises only **29 L/day per °C** of inside
max (rho 0.41, Apr–Sep) or **61 L/°C** (rho 0.50, since 9 Oct). So treat absolute litres with caution;
relative day-to-day changes (the Today card's water check) are more useful. Worth asking the installer
about meter size vs flow, and the farm about anything changed around 9 Sep and 9 Oct.

## 4. Relationships we looked for and did not find (no alerts built)

| Question | Result |
|---|---|
| Hot day → fewer eggs the next 0–3 days | rho −0.09 to +0.05, p > 0.2 (n ≈ 180). Only 2 logged days had inside ≥ 30 °C, so not testable yet. |
| Cold night (inside min) → fewer eggs | rho 0.00–0.04, p > 0.6 |
| Night temperature swing or min/max → deaths | rho −0.04 to +0.02, p > 0.6 |
| Water change → egg change (same day, +1, +2) | rho −0.11 to +0.02, p > 0.17 |
| Egg weight vs heat | only 21 logged weights |

Lay is very steady: in 2026 the daily count sits within a median **2.1 %** of the previous week (SD 4.9 %),
about 3 990 eggs/day. Of 46 days ≥ 5 % below the week, only **14** were followed by another low day, so
most single low days are counting or collection noise. This supports the Today card's 2-day lay-drop rule.
Deaths average **0.36/day** (101 in 2026 to 11 Oct), too few for temperature links to show.

Re-run once the October–November logs are in the silver table: the hot spell is the first real test of
heat vs lay and water vs lay.

## Egg camera vs daily-log hand count (2 Nov)

- Only 8 days overlap (4–11 Oct 2026; the silver daily log ends 11 Oct). Camera total (both cameras) / logged eggs: median **0.48**, range 0.33–0.78. Since 12 Oct the camera reads 1 200–3 100 a day while the log usually shows about 3 900.
- So the camera is not "about 20 % low" on this data; it is roughly half and swings a lot. The Egg counting banner now says the counts read below the hand count and vary, so use them to compare days and A-frames, not as the day's total. It gives no fixed percentage. Still no alerts on the egg counter.
- Needs Dylan: is the 20 % figure from a newer validation (e.g. a single collector)? If so, which cameras/period?
