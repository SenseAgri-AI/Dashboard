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
| `farm_id` | Currently only `farm_anike_001` (the one live farm — see `FARM_ID` in [src/lib/influxdb.ts](src/lib/influxdb.ts)) |
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

**Known device IDs** (hard-coded in the API routes):

| Device | `device_id` | Notes |
|--------|-------------|-------|
| Water meter | `24e124136f451854` | 1 pulse = **10 litres** (`WATER_LITRES_PER_PULSE`) |
| Feed meter | `24e124136f452271` | pulses → kg of feed (conversion TBD) |

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
hand-entered into a Google Sheet and read read-only via a service account.

| Setting | Value |
|---------|-------|
| Spreadsheet ID | `1KjAr1wjfptYbE0n3qCWY_7gTVnR-XMTRy8xzRgCDpkA` |
| Range used | `DailyLog!A:J` |
| Auth | Service-account JSON in SSM `/senseagri/dev/google/service-account` |
| Scope | `spreadsheets.readonly` |

### Column layout (`DailyLog` sheet)

Parsed by 0-based index in [src/app/api/production/route.ts](src/app/api/production/route.ts):

| Col | Index | Meaning |
|-----|-------|---------|
| A | 0 | Date (`DD/MM/YYYY` or `YYYY-MM-DD` — both handled) |
| B | 1 | (unused by dashboard) |
| C | 2 | Small eggs |
| D | 3 | Medium eggs |
| E | 4 | Large eggs |
| F | 5 | XL eggs |
| G | 6 | Jumbo eggs |
| H | 7 | Damaged eggs |
| I | 8 | Mortality (birds died that day) |
| J | 9 | (within range, unused) |

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

ws = gc.open_by_key("1KjAr1wjfptYbE0n3qCWY_7gTVnR-XMTRy8xzRgCDpkA").worksheet("DailyLog")
rows = ws.get("A:J")   # list of lists, same shape the dashboard reads
```

> The service account only has whatever sheets are **shared with its email**. If you get
> a 403, share the spreadsheet with the `client_email` in the service-account JSON.

---

## 3. Domain constants worth knowing

Hard-coded in [src/app/api/production/route.ts](src/app/api/production/route.ts) — useful for reproducing the dashboard's KPIs:

- **Flock size:** house1 = **4479 hens** (`HOUSE_HENS` / `TOTAL_HENS`).
- **Live hens** = `TOTAL_HENS − cumulative mortality`.
- **HDEP (Hen-Day Egg %)** = `total eggs / live hens × 100`.
- **FCR (Feed Conversion Ratio)** = `feed consumed Day N-1 / eggs collected Day N`.
- **Egg prices** are tiered by date (`PRICE_TIERS`); revenue = per-size count × tier price.
- **Feed-day attribution:** the *first* meter fill of each UTC calendar day is treated as
  the previous evening's top-up and attributed to the **previous** day.
- **Timezone:** the farm is **SAST (UTC+2)**; some dashboard aggregations offset for this
  (`SAST_OFFSET_MS`). InfluxDB stores everything in **UTC** — convert when bucketing by farm-day.

---

## 4. Gotchas / notes for analysis

- **InfluxDB times are UTC.** Convert to SAST (UTC+2) before grouping into "farm days".
- **`pulse_total` is cumulative**, not per-interval. Always diff consecutive readings and
  clip negatives (handles counter resets / device swaps).
- **Water conversion:** 10 litres per pulse. **Feed conversion** to kg is not yet pinned
  down in the code — confirm the per-pulse weight before reporting absolute feed mass.
- **Token TTL:** the app caches the InfluxDB token for 1h; for ad-hoc scripts just re-pull
  from SSM each run.
- **One farm today:** `farm_id = 'farm_anike_001'` is the only live farm. Keep the filter
  in queries so things still work when more farms are added.
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
