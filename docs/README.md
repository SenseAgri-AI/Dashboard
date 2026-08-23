# Dashboard docs

Reference documentation for the SenseAgri dashboard's welfare/alerting features — the **logic** behind
each one, not just a handover. Each doc is the source of truth for how a feature decides what it decides;
the code links back to it.

## Alerts

- **[alerts-implemented.md](alerts-implemented.md)** — the alerts that are **live today**, with their
  real logic, thresholds and messages: **power/connectivity**, **daily-log overdue**, **night
  disturbance**, **poor flock sleep**. Start here for what's actually running.
- **[alerts-spec.md](../alerts-spec.md)** — the fuller catalogue / **roadmap**: climate, ventilation and
  production rules that are specced but not yet built.

  The alerts run in [`src/lib/alerts.ts`](../src/lib/alerts.ts) (pure rule functions) and
  [`/api/alerts`](../src/app/api/alerts/route.ts) (farm-scoped data fetch + evaluation). Rules are pure
  so they're easy to reason about and to hand to the platform, which owns the WhatsApp/Twilio send.

## Features

- **[flock-night-rest-score.md](flock-night-rest-score.md)** — the flock **sleep score** (0–100): the
  dark-period window, the −32 dBFS disruption line, the six-factor formula, the score bands, the
  dashboard tile, the poor-sleep alert, and the validation.

- **[research-disease-detection.md](research-disease-detection.md)** — *(research / proposed)* early
  disease detection incl. avian influenza, using existing data (mortality, HDEP, egg breakage/weight,
  acoustics) via an **analytical** multi-indicator approach — no trained models.

## Conventions

- **Farm-scoped:** every reader resolves the farm server-side (Clerk org → `getFarmForRequest`); the
  client never supplies a farm id or a raw storage key.
- **Times:** stored/queried in UTC; shown to the farmer in **SAST (UTC+2)**.
- **Graceful degradation:** each data source is fetched independently (`Promise.allSettled`) so one
  failing feed never blocks — or false-fires — another rule.
