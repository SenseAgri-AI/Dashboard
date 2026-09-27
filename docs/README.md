# Dashboard docs

Reference documentation for the SenseAgri dashboard's welfare/alerting features — the **logic** behind
each one, not just a handover. Each doc is the source of truth for how a feature decides what it decides;
the code links back to it.

## Start here

- **[Project state](PROJECT_STATE.md)** — current architecture, working areas, approved research, and known conflicts.
- **[Product invariants](PRODUCT_INVARIANTS.md)** — behavior and data meanings that must survive feature work.
- **[Data sources](DATA_SOURCES.md)** — where each dataset lives, which repository owns it, and how to choose a source.
- **[Handover template](HANDOVER_TEMPLATE.md)** — required context when work moves to a fresh agent or session.

Repository agents must also follow [`AGENTS.md`](../AGENTS.md).

## Devices and calculations

- **[Water meters](devices/water-meters.md)** — physical topology, pulse conversion, low-flow limitations, and missing-data semantics.
- **[Silo radar](devices/silo-radar.md)** — distance meaning, physical estimates, and calibration limits.
- **[Water deviation alerts](calculations/water-deviation-alerts.md)** — approved 3-hour, 6-hour, and daily alert design.
- **[Silo-derived FCR](calculations/feed-conversion-ratio.md)** — provisional formula and inputs still required.

## Investigation notes

- **[September 2026 water-meter backtest](findings/2026-09-water-meter-backtest.md)**
- **[September 2026 silo readings](findings/2026-09-silo-readings.md)**

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
