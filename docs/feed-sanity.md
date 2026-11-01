# Feed numbers: audit and sanity guards

Status: on branch `jack/today-card-freshness`. Thresholds marked PROVISIONAL need a farmer or nutritionist to confirm.
Audit (read-only, farm_anike_001, house1, 1 Nov 2026): Athena `meters_hourly` / `aligned_hourly`, InfluxDB EM411 radar readings.

## Where feed appears and what we found

| Place | Source | Finding | Change | User story |
|---|---|---|---|---|
| Analytics → "Feed pulses (augers)", "Feed — auger 1/2" | `meters_hourly.feed_pulses_auger*` | Unitless pulses, never calibrated to kg. Auger 2: 654 622 pulses in one April week, then nothing since June; auger 1: zero since 31 Aug. | Hidden from the metric picker until the meters are fixed. | Cut: a farmer can't act on pulses, and a broken line reads as "birds stopped eating". |
| `/api/production` `fcr`, `feedPulses` | Influx pulse meter | `fcr` was pulses ÷ eggs: not a feed conversion ratio (no kg). Not shown on any screen yet, but returned by the API. | Removed, with the feed-meter query. | Cut: a wrong FCR is worse than none. |
| Dashboard → silo gauges | EM411 radar head space | % is linear by height between 1.5 m and 3.8 m head space; the funnel isn't calibrated, so the bottom ~third of the height holds much less feed than the % suggests. One radar reports 10–12 m (beyond the silo) when nearly empty. | Shown as "≈X%" to the nearest 5, labelled "Fill by height · approx.", with one line: order on "Running low", not on the %. Out-of-range readings were already dropped. | *As a farmer, I want to know roughly how full each silo is and when to order, without a falsely precise number.* |
| Logs → Feed tab, "Weight filled" | FeedDeliveries sheet, free text | Free text, so "25000", "25 t" or "300 bags" are all possible; kg vs bags is ambiguous. Logged deliveries so far are kg (25 000 kg ×5, 16 000 kg). | Field labelled "(kg)"; a warning (not a block) when the unit is missing, in bags, unreadable, or implies < 2 or > 150 days of feed. The table shows the weight as "25 000 kg" or "… unit?". | *As a farmer logging a delivery, I want a typo or a bag count caught before it is saved.* |
| Logs → Feed tab, new "Lasted" column | Consecutive delivery dates and weights, total hens | The only reliable intake figure. History: 112, 114, 119 g/hen/day (Dec–May), 86 (May–Jul), 100 (Jul–Sep). No delivery logged since 3 Sep although silo 2's radar shows a refill around 29 Oct. | "N days · X g/hen/day", amber outside 100–125 g, "looks wrong" outside 70–160 g (usually an unlogged delivery or a typo). | *As a farmer, I want to see how long each delivery lasted per hen, so I notice birds eating less, wastage, or a delivery I forgot to log.* |
| DailyLog feed columns | DailyLog sheet | Only "Feed type" (text). No quantity, so nothing to sanity-check. | None. | n/a |
| Silver `aligned_hourly.feed_kg` (AI agent tool) | n/a | Always null. The agent sees "no data", not a number. | None. | n/a |
| `/api/dashboard/summary` `env.feed.sparkline` | Influx pulse meter | Still queried; no screen shows it. | Left as is (unrelated working code); candidate for removal. | n/a |

**"Lasted" is whole-farm**: each delivery's kg over the days until the next logged delivery to *any* silo, divided by *housed* hens from the config (not live hens). With two silos filled at different times a single row can read low or high even when the long-run average is fine; the Feed tab says so under the table. Per-silo pairing or a rolling average is a possible follow-up.

Constants (`src/lib/feedSanity.ts`, tested in `tests/feed-sanity.test.mjs`): typical layer intake 100–125 g/hen/day; plausible 70–160 g (PROVISIONAL, confirm against the breed guide once breed is recorded).
