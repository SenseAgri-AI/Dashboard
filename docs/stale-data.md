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
