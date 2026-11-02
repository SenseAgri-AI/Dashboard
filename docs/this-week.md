# This week (Home)

Last reviewed: 2026-11-02. Rules in `src/lib/thisWeek.ts` (`WEEK_RULES`), card `src/components/ThisWeekCard.tsx`.

*As a farmer, once a week I want to see in a few seconds how the last 7 days compare with the week before
(eggs, deaths, water, heat), so I notice a slow change that no single day shows.*

The card sits under the Today card. It compares the **last 7 complete farm-local days** (SAST midnight to
midnight, today excluded) with the 7 days before. Each line has a value and a plain change. Only clear
changes get the amber "Early warning" note, worded as something to check, never as a cause.

| Line | Value | Change | Early warning (amber) |
|---|---|---|---|
| Eggs | average per logged day, with average lay % | "↓ 8% on last week", or "about the same" when within 3 % | down 5 %+ → "Early warning: check the birds, feed and water" |
| Deaths | total in the week | "last week N" | at least 7 and at least double last week (same as the Today card's week rule) → "Early warning: check the birds" |
| Water | average litres/day over **complete** days (both meters ≥ 22 hourly rows) | as eggs | down 30 %+ (same 70 % as the Today card) → "Early warning: check drinkers, pressure and the birds" |
| Hottest inside | hottest day's max (30-min averages) and date | "last week N °C" | none; adds "N days at 32 °C+ (last week M)" |

Data states:

- A week needs **4+ days** with data to compare; otherwise the line says "3 of 7 days logged/measured, not enough to compare".
- Gap days are left out of the average, never counted as zero; "5 of 7 days measured" is shown.
- A failed source shows "couldn't load" on its own line; slow sources show "Loading water and temperature…" while the rest renders.
- A meter with no readings all fortnight is treated as not installed.

Sources (all read-only): eggs and deaths from the DailyLog rows Home already loads (`/api/production`);
water from `/api/water-use` (silver `meters_hourly`, now farm-local days, shared with the Today card's
water check); inside daily max from `/api/this-week` (InfluxDB, 16-day lookback).

Left out on purpose:

- **Feed:** deliveries come every couple of weeks, so a week-on-week comparison is mostly noise. The Feed tab's "lasted" figure covers it.
- **Count of early warnings shown:** Today-card warnings aren't stored, so there is nothing reliable to count yet.

Also on Home: the "Houses" tile only shows on farms with more than one house (one house is listed in the
Houses panel below), and the egg-count date reads "1 Nov".

- Days use the farm's fixed `timezoneOffset` (whole hours, −12..+14; otherwise SAST). A fixed offset doesn't follow daylight saving, so a DST farm's day boundary would be an hour off for part of the year.
