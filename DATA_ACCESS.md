# Data Access Handover — SenseAgri Dashboard

How to connect to the data sources behind this dashboard so you can pull data for
analysis / science work (Python, notebooks, etc.). Two stores feed the dashboard:

| Source | What's in it | Tech |
|--------|--------------|------|
| **InfluxDB 3 Cloud** | All sensor telemetry (temp, humidity, CO₂, water/feed pulse meters) | Time-series DB, queried with **SQL** |
| **Google Sheet** ("DailyLog") | Manual egg-production log (egg counts, mortality) | Google Sheets API |

All credentials live in **AWS SSM Parameter Store** (region `af-south-1`). You do not
need them pasted anywhere — if your AWS CLI is configured, you can pull them on demand.

---

## 0. Prerequisites

You need AWS access to the SenseAgri account. The app reads secrets from SSM using
your local `~/.aws` profile (on Vercel it uses `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`).

```bash
aws configure          # or aws sso login, depending on how the account is set up
aws sts get-caller-identity   # confirm you're authenticated
```

Secrets used by the app:

| SSM parameter | Contents |
|---------------|----------|
| `/senseagri/dev/influxdb/token` | InfluxDB 3 read/write token |
| `/senseagri/dev/google/service-account` | Google service-account JSON key |

---

## 1. InfluxDB 3 Cloud (sensor telemetry)

### Connection details

| Setting | Value |
|---------|-------|
| Host / URL | `https://us-east-1-1.aws.cloud2.influxdata.com` |
| Org ID | `a7a2592ed15637b2` |
| Bucket (database) | `senseagri-telemetry` |
| Token | from SSM `/senseagri/dev/influxdb/token` |
| Query language | **SQL** (InfluxDB 3 / FlightSQL) |

Pull the token into your shell:

```bash
export INFLUX_TOKEN=$(aws ssm get-parameter \
  --name /senseagri/dev/influxdb/token \
  --with-decryption --region af-south-1 \
  --query Parameter.Value --output text)
```

### Connect from Python

```bash
pip install influxdb3-python pandas
```

```python
import os
from influxdb_client_3 import InfluxDBClient3

client = InfluxDBClient3(
    host="https://us-east-1-1.aws.cloud2.influxdata.com",
    token=os.environ["INFLUX_TOKEN"],
    database="senseagri-telemetry",
)

# query() returns a pyarrow Table -> straight to pandas
df = client.query(
    """
    SELECT time, device_id, device_type, temperature, humidity, co2
    FROM sensors
    WHERE farm_id = 'farm_anike_001'
      AND device_type = 'AM308-1'
      AND time > now() - INTERVAL '7 days'
    ORDER BY time DESC
    """
).to_pandas()

print(df.head())
```

### Schema

Everything lives in one measurement/table: **`sensors`**.

**Tags (identity columns):**

| Tag | Notes |
|-----|-------|
| `farm_id` | Per farm, from SSM `/senseagri/farms/<slug>/config` via `getFarmForRequest` ([src/lib/farms.ts](src/lib/farms.ts)). There is no global `FARM_ID` ([src/lib/influxdb.ts](src/lib/influxdb.ts)). Example queries below use `farm_anike_001` as a filter string, not as a claim that it is the only live farm |
| `device_id` | Hardware ID, e.g. `24e124136f451854` |
| `device_type` | Sensor model — distinguishes which fields are populated |

**Device types & their fields:**

- **`AM308-1`** — environment sensor (Milesight AM308). Fields:
  `temperature`, `humidity`, `co2`, `tvoc`, `pressure`, `pm2_5`, `pm10`,
  `light_level`, `battery`
- **Pulse meters** (water & feed flow) — fields:
  `temperature`, `humidity`, `battery`, `pulse_total`, `pulse_conv`, `pulse_unit_conv`
  - `pulse_total` is a **cumulative counter** — to get consumption you take the
    **difference between consecutive readings** (see "Gotchas" below).

**Known device IDs.** Water-meter identity is canonical in
[docs/devices/water-meters.md](docs/devices/water-meters.md): two meters, one per A-frame,
10 litres per pulse. The dashboard sums both from `meters_hourly`
(`water_l_wm1` + `water_l_wm2`) in `fetchMetersDaily`
([src/lib/silverSource.ts](src/lib/silverSource.ts)). It does not read only Water Meter 1.
A **"feed meter" is a pulse counter on a feed auger**. Analytics reads
`feed_pulses_auger1` and `feed_pulses_auger2` (pulses, not kg).

| Device | `device_id` | Role | Notes |
|--------|-------------|------|-------|
| Water meter 1 | `24e124136f451854` | `water_meter` | Silver column `water_l_wm1`. 1 pulse = **10 litres**. [docs/devices/water-meters.md](docs/devices/water-meters.md) |
| Water meter 2 | `24e124136f456303` | `water_meter` | Silver column `water_l_wm2`. Included in the dashboard total. |
| Feed meter | `24e124136f458449` | `feed_meter` | Listed in the September 2026 notes as one auger. This file does not bind it to `feed_pulses_auger1` or `auger2` |
| Feed meter | `24e124136f452271` | `feed_meter` | Listed in the same notes as the other auger. Same caveat |
| Unassigned id | `24e124136f455672` | — | Seen in an early-September 2026 Influx window. Not a confirmed install |

> **Status snapshot, not current health.** Hour-of-day profiles, the "frozen at 864,891"
> note, and the 3 Sep 2026 single burst were an Influx window of about 6 Aug–5 Sep 2026
> (Influx keeps roughly a month). They are not a live device status. Re-run the discovery
> query below before saying a meter has stopped or that an id is a phantom. The platform
> device registry and the meter mapping still disagree on some EM300 roles; do not guess
> ([docs/DATA_SOURCES.md](docs/DATA_SOURCES.md)).

To discover everything that's actually reporting:

```sql
SELECT device_id, device_type, COUNT(*) AS n, MAX(time) AS last_seen
FROM sensors
WHERE farm_id = 'farm_anike_001'
GROUP BY device_id, device_type
ORDER BY device_type, device_id;
```

### Useful SQL patterns

These mirror what the dashboard does — handy starting points.

**Time-bucketed averages** (downsampling) with `date_bin`:

```sql
SELECT
  date_bin(INTERVAL '1 hour', time, TIMESTAMP '1970-01-01 00:00:00') AS bucket,
  AVG(temperature) AS temperature,
  AVG(humidity)    AS humidity,
  AVG(co2)         AS co2
FROM sensors
WHERE farm_id = 'farm_anike_001'
  AND device_type = 'AM308-1'
  AND time > now() - INTERVAL '24 hours'
GROUP BY bucket
ORDER BY bucket ASC;
```

**Cumulative meter → per-bucket consumption.** The meter reports a running total, so
query `MAX(pulse_total)` per bucket, then diff consecutive buckets in your code:

```sql
SELECT
  date_bin(INTERVAL '1 hour', time, TIMESTAMP '1970-01-01 00:00:00') AS bucket,
  MAX(pulse_total) AS cumulative
FROM sensors
WHERE farm_id = 'farm_anike_001'
  AND device_id = '24e124136f451854'   -- water meter
  AND time > now() - INTERVAL '7 days'
GROUP BY bucket
ORDER BY bucket ASC;
```

```python
# consumption per bucket, in litres (water = 10 L/pulse)
df = df.sort_values("bucket")
df["pulses"] = df["cumulative"].diff().clip(lower=0)   # clip resets/negatives
df["litres"] = df["pulses"] * 10
```

---

## 2. Google Sheet (egg-production daily log)

The egg counts, sizes, damaged and mortality figures are **not** in InfluxDB — they're
hand-entered into a Google Sheet. The app **reads and writes** that sheet with the full
`spreadsheets` scope ([src/lib/sheets.ts](src/lib/sheets.ts),
[src/lib/logService.ts](src/lib/logService.ts)). An analyst pulling a copy should use
`spreadsheets.readonly` instead.

| Setting | Value |
|---------|-------|
| Spreadsheet ID | Per farm: `spreadsheetId` in SSM `/senseagri/farms/<slug>/config`. Do not hard-code one |
| Range used | Per farm: `sheetRange`. The admin template default is `DailyLog!A:R` ([src/components/AdminClient.tsx](src/components/AdminClient.tsx)). The logger writes columns A–Q ([src/lib/logService.ts](src/lib/logService.ts)) |
| Auth | Service-account JSON in SSM `/senseagri/dev/google/service-account` |
| App scope | `https://www.googleapis.com/auth/spreadsheets` (read-write) |
| Analyst scope | `https://www.googleapis.com/auth/spreadsheets.readonly` |

### Column layout (`DailyLog` sheet)

Written by `entryToRow` in [src/lib/logService.ts](src/lib/logService.ts). The production
route still sums by these indexes ([src/app/api/production/route.ts](src/app/api/production/route.ts)):
date `r[0]`, sizes `r[2]`–`r[6]`, damaged `r[7]`, mortality `r[8]`, average egg weight `r[10]`.

| Col | Index | Meaning |
|-----|-------|---------|
| A | 0 | Date (`DD/MM/YYYY` or `YYYY-MM-DD` — both handled) |
| B | 1 | House id |
| C | 2 | Small eggs |
| D | 3 | Medium eggs |
| E | 4 | Large eggs |
| F | 5 | XL eggs |
| G | 6 | Jumbo eggs |
| H | 7 | Damaged eggs |
| I | 8 | Mortality (birds died that day) |
| J | 9 | Notes |
| K | 10 | Average egg weight (g) |
| L–Q | 11–16 | Optional water pH, yolk colour, hen weight, water intake, feed type, water additives |

There can be **multiple rows per date** (e.g. per collection) — the dashboard sums them
per day. Dates can repeat and arrive unsorted.

### Connect from Python

```bash
pip install gspread google-auth pandas
```

```python
import json, subprocess
import gspread
from google.oauth2.service_account import Credentials

# Pull the service-account key out of SSM
key_json = subprocess.check_output([
    "aws", "ssm", "get-parameter",
    "--name", "/senseagri/dev/google/service-account",
    "--with-decryption", "--region", "af-south-1",
    "--query", "Parameter.Value", "--output", "text",
]).decode()

creds = Credentials.from_service_account_info(
    json.loads(key_json),
    scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"],
)
gc = gspread.authorize(creds)

# spreadsheetId from /senseagri/farms/<slug>/config — do not paste a farm's id into the repo
SPREADSHEET_ID = "<spreadsheetId>"
ws = gc.open_by_key(SPREADSHEET_ID).worksheet("DailyLog")
rows = ws.get("A:R")
```

> The service account only has whatever sheets are **shared with its email**. If you get
> a 403, share the spreadsheet with the `client_email` in the service-account JSON.

---

## 3. Domain constants worth knowing

From [src/app/api/production/route.ts](src/app/api/production/route.ts) and
[src/lib/farms.ts](src/lib/farms.ts) — there is no `HOUSE_HENS`, `TOTAL_HENS`, or `PRICE_TIERS` constant:

- **Flock size** is the sum of `farm.houseHens` from the per-farm SSM config.
- **Price tiers** are `farm.priceTiers` in that same config (newest first).
- **Live hens** = that sum − cumulative mortality (floor 1 in the route).
- **HDEP (Hen-Day Egg %)** = `total eggs / live hens × 100`.
- **Production-route `fcr`** = previous UTC day's feed **pulses** from the single `feedDeviceId`
  ÷ eggs collected that day. It is not kilograms, and it is not the silo FCR in
  [docs/calculations/feed-conversion-ratio.md](docs/calculations/feed-conversion-ratio.md).
- **Feed-day attribution** in that route: the *first* fill of each UTC calendar day is treated as
  the previous evening's top-up and attributed to the **previous** day.
- **Timezone:** farm-facing times are **SAST (UTC+2)** unless a feature says otherwise.
  InfluxDB stores **UTC**. The config field is `timezoneOffset` (template value 2).

---

## 4. Gotchas / notes for analysis

- **InfluxDB times are UTC.** Convert to SAST (UTC+2) before grouping into "farm days".
- **`pulse_total` is cumulative**, not per-interval. Always diff consecutive readings and
  clip negatives (handles counter resets / device swaps).
- **Water conversion:** 10 litres per pulse. **Feed conversion** to kg is not yet pinned
  down in the code — confirm the per-pulse weight before reporting absolute feed mass.
- **Token TTL:** the app caches the InfluxDB token for 1h; for ad-hoc scripts just re-pull
  from SSM each run.
- **Scope every query by farm.** The app resolves `farm_id` per request. Do not assume a single live farm from this file.
- The dashboard's read paths are the source of truth for schema — see
  [src/lib/influxdb.ts](src/lib/influxdb.ts), [src/lib/sheets.ts](src/lib/sheets.ts), and the routes under
  [src/app/api/](src/app/api/).

---

## 5. Quick start checklist

1. `aws sts get-caller-identity` — confirm AWS access.
2. `export INFLUX_TOKEN=$(aws ssm get-parameter --name /senseagri/dev/influxdb/token --with-decryption --region af-south-1 --query Parameter.Value --output text)`
3. `pip install influxdb3-python pandas gspread google-auth`
4. Run the InfluxDB Python snippet above → you have telemetry in a DataFrame.
5. Run the Google Sheets snippet → you have the production log.
6. Join on date (remember UTC↔SAST) and start your analysis.
