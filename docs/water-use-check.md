# Water use check (Today card)

Last reviewed: 2026-11-01. Status: dashboard only (the platform notifier is unchanged). Thresholds PROVISIONAL.

## Farmer stories

- *When my hens drink much less than they normally do, tell me early, because a water drop often comes
  before a drop in feed intake and eggs, so I check the drinkers, the pressure and the birds that morning.*
- *When one drinker line goes quiet while the other is normal, tell me which meter, so I walk to that line
  instead of guessing.*

Both appear as the **Water** line on the Home Today card, only when something is unusual. The wording is
an early warning ("Early warning: check …"); it never names a cause.

## Data

`/api/water-use` reads daily litres per meter for the last 17 complete days from the silver table
`meters_hourly` (`water_l_wm1`, `water_l_wm2`; see [devices/water-meters.md](devices/water-meters.md)).
Read-only, farm-scoped, Athena-cached.

- A meter's day counts only with at least 22 hourly rows. A gap is never read as zero water.
- Days are UTC (02:00–02:00 SAST). Hens drink little at night, so this barely shifts the totals.
- The silver batch runs once a day, so yesterday appears in the early morning. If the newest complete day
  is more than 2 days old the check stays silent; the Sensors line covers stale meters.

## Rules (`waterUseCheck` in `src/lib/todayStatus.ts`, thresholds `today.waterDrop`)

| Rule | Fires when | Line |
|---|---|---|
| Farm drop (amber) | Each of the last 2 complete days is below 70 % of the median of the 14 days before them (at least 10 valid days, median at least 300 L) | "Down 40% on usual for 2 days: 600 L/day vs ~1 000 L" / "Early warning: check drinkers, pressure and the birds" |
| Farm drop (red) | Same, for 3 days | same wording, red |
| One line quiet (amber) | One meter's latest day is below 30 % of its own 14-day median (median at least 100 L) while the other meter is at least 70 % of its median | "Meter 1 used 0 L on 09-17 vs ~640 L usual; the other line was normal" |

A firing platform water alert still overrides the line, as before.

## Backtest (14 Apr – 31 Oct 2026, 185 evaluable days)

11 days flagged:

- 4 Jul, 14 Aug: two-day farm dips (amber).
- 9 Jul: Meter 2 at 40 L against ~140 L (low-flow winter period, lower confidence).
- **18 Sep: Meter 1 read 0 L on 17 Sep while Meter 2 was normal.** The kind of event the line rule is for.
- **11–15 Oct (amber, then red), 21 Oct, 24 Oct:** farm use fell from about 1 900 L/day to about 1 000,
  then about 550 L/day, **while the house was at 30–34 °C**. In heat, hens should drink more, not less.
  This needs checking with the farm (pressure, regulator, valves, filters, or the meters under-reading;
  see the questions in devices/water-meters.md). The baseline then adapts to the new level, so the card
  stops flagging after about two weeks of low use.

A single-day farm rule at 70 % flagged 21 days, mostly normal day-to-day swings; two days is the minimum
that stays quiet on normal weeks.

## Limits and follow-ups

- No temperature adjustment yet: a sudden cold snap can lower use. The 2-day rule absorbs most single
  cold days.
- Meter names are "Meter 1 / Meter 2" until the farm confirms which A-frame each meter serves.
- Water-to-feed ratio is not checked: the feed meters are off and deliveries are too coarse for a daily ratio.
