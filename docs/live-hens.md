# Live hens and deaths on Home

Farmer story: *"When I glance at Home I want to see how many birds I actually have, and how many I've lost since they were housed, so I don't have to work it out myself."*

- `houseHens` (farm config) is the flock housed when the daily log began.
- **Live hens** = `houseHens` − every death in the daily log (`/api/production` → `liveHens`). Before, the tile showed `houseHens` for ever.
- **Deaths since housed** = cumulative logged deaths and `deaths ÷ houseHens × 100`. Before, the rate was `deaths ÷ (houseHens + deaths)`, which treats `houseHens` as the *current* flock. Analytics "Cumulative mortality" and the assistant's `mortality_rate_pct` already used `÷ houseHens`, so all three now agree.
- If `houseHens` is ever changed to a mid-flock head count, deaths logged before that would be counted twice; change it only with a new flock (new daily-log start).
