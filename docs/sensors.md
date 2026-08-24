# Barn sensors — reference

Hard-won operational knowledge about what the InfluxDB `sensors` measurement actually contains, so new
queries don't misread it. **Read this before writing a new query against `sensors`.**

## Device topology

The `sensors` measurement mixes device types under one farm — filter by `device_type`:

| `device_type` | What it is | Fields to trust |
|---|---|---|
| **`AM308-1`** | The **climate sensor** | `temperature`, `humidity`, `co2`, `tvoc`, `pressure`, `pm2_5`, `pm10`, `light_level`, `battery` |
| **`EM300-1`** | **Water meters (2) + feeders** (some not working) — pulse/tacho devices | `pulse_total`, `pulse_conv`, `pulse_unit_conv` (via `device_id` = the farm's water/feed device) |

⚠️ **The EM300 `temperature`/`humidity` fields are junk** — the temperature sits at the 6553.5 °C
(0xFFFF ÷ 10) placeholder. **All climate queries must filter `device_type = 'AM308-1'`**, exactly like
the dashboard/analytics/telemetry routes. A raw `FROM sensors WHERE farm_id = …` sweeps in the meters
and produces garbage.

## `light_level` — a 0–5 index, NOT lux

The AM308 reports light as a **discrete level 0–5**, each mapping to a lux band:

| Level | Lux band |
|---|---|
| **0** | 0–5 lux |
| **1** | 6–50 lux |
| **2** | 51–100 lux |
| **3** | 101–500 lux |
| **4** | 501–2000 lux |
| **5** | > 2000 lux |

So the value is **coarse** — good for "how bright, roughly," not precise lux. Observed on this farm:
night (18:00–06:00 SAST) reads a clean **Level 0** (effectively dark), daytime shed lighting reads
**Level 1–3** (dim-to-moderate artificial light).

**For sleep / light-leak detection:** the dark period should sit at **Level 0**. Any **Level ≥ 1 during
the 20:00–05:00 dark window is a light leak** — a door/light left on — which keeps the birds from
resting (see [flock-night-rest-score.md](flock-night-rest-score.md); light at night is a direct sleep
disruptor). Level 0 vs ≥1 is the reliable distinction; finer brightness is not.

## `tvoc` — also a 0–5 index

Total volatile organic compounds (air-quality proxy) are likewise reported as a **discrete level 0–5**,
not a raw concentration:

| Level | Value band |
|---|---|
| **0** | ≤ 1.99 |
| **1** | 2.00–2.50 |
| **2** | 2.51–2.99 |
| **3** | 3.00–3.99 |
| **4** | 4.00–4.99 |
| **5** | ≥ 5.00 |

Same caveat as light: the value is a **coarse index**, good for "how bad, roughly," not a precise
concentration. Higher = worse air quality; useful alongside CO₂ as a ventilation/air-exchange signal.
