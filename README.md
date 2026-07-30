# SenseAgri Farm Portal

A multi-tenant client portal (laptop + mobile) for SenseAgri poultry-farm clients. Each client
signs in with their own email account, has 2FA, and sees only their own farm's data. Sections:

- **Dashboard** — live environmental + production KPIs.
- **Farm Logs** — daily egg/mortality logging (writes to the farm's Google Sheet).
- **Schedule & Events** — two tabs, both saved to the farm's sheet:
  - *Schedule* (`Schedule` tab): recurring actions (lighting/feed/cleaning/blinds/manure) with
    **effective-dated changes** — each row is a dated version, so a change (past or future) keeps
    full history you can go back through. Recurrence: daily / weekly / every N days / biweekly / monthly.
  - *Events* (`Events` tab): one-off interventions with **type presets** (vaccination, medication,
    feed change, silo delivery, water treatment, health observation, equipment, other) — each type
    shows only its relevant detail fields. Deliberately does not duplicate the Daily Log
    (mortality, egg data, daily feed type / water additive live there).
- **Analytics** — deeper charts (Hen-Day % vs breed standard, telemetry over time).
- **Admin** — super-admin-only onboarding of new farm clients.

## Stack

- **Next.js 16** (App Router) + React 19 + Tailwind v4
- **Clerk** — auth (email + password + TOTP 2FA) and **Organizations** (one org per farm)
- **InfluxDB 3 Cloud** — telemetry (shared bucket, partitioned by `farm_id` tag)
- **Google Sheets** — per-farm production log
- **AWS SSM Parameter Store** — all secrets + per-farm config

## Local development

Prerequisites: Node 20+, AWS credentials that can read (and, for `/admin`, write) SSM in
`af-south-1` — locally via your `~/.aws` profile.

1. `npm install`
2. Create `.env.local` with your Clerk keys (see [.env.example](.env.example)). The Clerk CLI
   (`clerk init`) writes these for you.
3. `npm run dev` → http://localhost:3000

For pulling data directly (Python / analysis), see [DATA_ACCESS.md](DATA_ACCESS.md).

## Auth & multi-tenancy

- **Clerk Organizations = farms.** A user's active org resolves to a farm config, and every query
  is scoped to that farm. Users are invited into their org; they never self-serve.
- **Super-admin** = a Clerk user with `publicMetadata.role = "superadmin"`. Gates the `/admin`
  section and the onboarding API.
- **Farm config** lives in **AWS SSM** at `/senseagri/farms/<org-slug>/config` (one JSON blob per
  farm). Resolved per request from the logged-in user's org slug — see
  [src/lib/farms.ts](src/lib/farms.ts). New client = new SSM parameter + a Clerk org; no deploy.

There is **no per-tenant AWS role**. Farmers never touch AWS. The app holds one set of AWS
credentials and reads every farm's config/secrets centrally; isolation is enforced at the app
layer (Clerk org → `farmId` → scoped queries).

## Onboarding a new farm client

Do it from the **Admin** section (super-admin only), which in one step: creates the Clerk org,
writes the SSM farm config, invites the client's admin as `org:admin`, and adds you (super-admin)
as an admin of the org. Then **share their Google Sheet** with the service account
(`poultry-log-bot@poultry-egg-log.iam.gserviceaccount.com`) as **Editor**.

### Farm config JSON reference

```jsonc
{
  "farmId": "farm_greenvalley_001",   // InfluxDB farm_id tag — the ONLY "Influx detail" needed
  "spreadsheetId": "<google sheet id>",// their sheet (share it with the service account)
  "sheetRange": "DailyLog!A:R",        // default; change only if the tab differs
  "waterDeviceId": "<pulse meter id>", // water meter (individually referenced)
  "feedDeviceId": "<pulse meter id>",  // feed meter (individually referenced)
  "houseHens": { "house1": 5000 },     // hens per house — drives HDEP / mortality
  "priceTiers": [                      // egg prices by effective date, NEWEST FIRST
    { "from": "2025-01-01", "small": 1.0, "medium": 1.3, "large": 1.6, "xl": 1.8, "jumbo": 2.0 }
  ],
  "waterLitresPerPulse": 10,           // usually 10
  "timezoneOffset": 2                  // SA farms = UTC+2
}
```

### What you need vs. what you don't

**Need:** `farmId`, `spreadsheetId` (+ share the sheet), the water + feed **meter** device IDs,
hens per house, and egg prices.

**Do NOT need:**
- **InfluxDB connection details** — all farms share one bucket/token; only the `farmId` tag differs.
  (Their devices must already be *ingesting* into InfluxDB with that `farm_id` — that's the AWS
  ingest pipeline, separate from this dashboard, which only reads.)
- **Google credentials** — one shared service account reads/writes every farm's sheet (once shared).
- **Every device ID** — environment sensors (`AM308-1`) are auto-discovered by `farm_id` +
  `device_type`. Only the water + feed **meters** are referenced individually (they need pulse→
  consumption math). Current assumption: one water + one feed meter per farm.
- **A per-org AWS role** — see multi-tenancy above.

> Production note: the `/admin` SSM write needs the app's AWS IAM user to have `ssm:PutParameter`
> on `/senseagri/farms/*`. Your local `~/.aws` profile already has it.

## Repo layout

- `src/app/(app)/` — authenticated sections (dashboard, logs, analytics, admin) behind the shell.
- `src/app/api/` — farm-scoped API routes (telemetry, production, logs, houses, admin).
- `src/lib/farms.ts` — per-farm config loader/writer (SSM). `src/lib/admin.ts` — super-admin gate.
- `src/lib/influxdb.ts`, `src/lib/sheets.ts`, `src/lib/logService.ts` — data access.
- `src/proxy.ts` — Clerk middleware (route protection).
- `poultry-layer-log-/` — reference clone the Farm Logs section was ported from (not part of the build).

## Not yet built (future)

- Farmer-editable settings (e.g. egg-size **weight thresholds** — sizes are currently hand-entered
  counts, not weight-derived).
- Long-horizon analytics from the AWS **gold bucket** (Influx retains ~1 month; the analytics
  data-source seam is in [src/lib/timeseriesSource.ts](src/lib/timeseriesSource.ts)).
- WhatsApp config + notifications, Help requests, logo swap.
- Locking down self-serve org creation so only `/admin` can create orgs.
