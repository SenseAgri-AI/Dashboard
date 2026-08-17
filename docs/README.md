# Dashboard docs

Reference documentation for the SenseAgri dashboard's welfare/alerting features — the **logic** behind
each one, not just a handover. Each doc is the source of truth for how a feature decides what it decides;
the code links back to it.

## Alerts

- **[alerts-spec.md](../alerts-spec.md)** — the full alert catalogue. Each alert's fire condition, the
  message the farmer gets, and its detection logic. Built (v1) so far: **power/connectivity**,
  **daily-log overdue**, **night disturbance**, **poor flock sleep**. Climate/ventilation/production
  rules are specced but not yet built.

  The alerts run in [`src/lib/alerts.ts`](../src/lib/alerts.ts) (pure rule functions) and
  [`/api/alerts`](../src/app/api/alerts/route.ts) (farm-scoped data fetch + evaluation). Rules are pure
  so they're easy to reason about and to hand to the platform, which owns the WhatsApp/Twilio send.

## Features

- **[flock-night-rest-score.md](flock-night-rest-score.md)** — the flock **sleep score** (0–100): the
  dark-period window, the −32 dBFS disruption line, the four-component formula, the score bands, the
  dashboard tile, the poor-sleep alert, and the validation.

## Conventions

- **Farm-scoped:** every reader resolves the farm server-side (Clerk org → `getFarmForRequest`); the
  client never supplies a farm id or a raw storage key.
- **Times:** stored/queried in UTC; shown to the farmer in **SAST (UTC+2)**.
- **Graceful degradation:** each data source is fetched independently (`Promise.allSettled`) so one
  failing feed never blocks — or false-fires — another rule.
