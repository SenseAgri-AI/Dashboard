# Flock Night-Rest Score

A nightly **sleep score** for the flock (0–100), analogous to a human sleep tracker. Restful nights
score high; nights with sustained overnight disturbance score low. It surfaces as a dashboard tile and
drives a "poor sleep several nights running" alert.

**Why it matters.** Sleep is welfare *and* production. Layers need undisturbed dark-period rest; chronic
overnight disruption (predators, light leaks, red mite, equipment) shows up as lower lay, poorer feed
conversion, and stress long before it shows up in the daily log. A single number the farmer can watch
each morning turns "the birds seem unsettled lately" into something measurable and trendable.

- **Code:** [`src/lib/sleepScore.ts`](../src/lib/sleepScore.ts) (pure scoring) · [`/api/sleep-score`](../src/app/api/sleep-score/route.ts) (farm-scoped reader) · [`DashSleepScore.tsx`](../src/components/DashSleepScore.tsx) (tile)
- **Alert:** poor-sleep decline → see [alerts-spec.md → Welfare](../alerts-spec.md)
- **Validation notebook:** [`analysis/night_rest_score.py`](../analysis/night_rest_score.py)

---

## What counts as a "night"

The **dark period 20:00–05:00 SAST** (SAST = UTC+2; the queries run in UTC and convert). A night is
**labelled by the evening it starts** — the 20:00 Fri → 05:00 Sat window is "Friday's" night.

A night needs **≥ 120 data points** (`MIN_NIGHT_POINTS`) to be scored at all. The mic reports ~1/min, so
120 points ≈ 2 h of coverage; below that we skip the night rather than score it unfairly on a fragment.

## The signal — absolute mean level, not relative

We score on the **mean** night-noise level (`noise_db_mean`), read as an **absolute** dBFS value. Two
decisions, both validated by ear on real clips:

- **Mean, not peak.** The mean tells you *how much of the flock* is vocalising. A single loud bang
  spikes the peak but barely moves the mean; the whole flock erupting moves the mean and *holds* it.
  Sleep quality is about the flock, not one startle.
- **Absolute, not relative-to-baseline.** We deliberately do **not** compare each night to its own
  rolling floor. That approach is structurally confounded: a real sustained event *suppresses its own*
  rolling baseline (so it looks smaller than it is), and a very quiet night *inflates* the relative
  jump of trivial noise. An absolute line works because real disturbances are simply **~10–15 dB louder**
  than any background — quiet room, fans, or rain alike.

A minute counts as **disrupted** when `noise_db_mean` rises above **−32 dBFS** (`DISRUPT_DB`). On this
farm: quiet-night background sits ~−38, fan/rain background a little higher, and a real flock disturbance
jumps to ~−29 and holds. **−32 sits cleanly between** the two — above steady background (which does *not*
wake birds), below real eruptions (which do).

> On the dBFS scale, *less negative = louder*. −29 is louder than −38.

## The score

Start at **100** and subtract five penalties, then clamp to **0–100**:

```
score = 100
        − 2   × disruptMin     (each disrupted minute)
        − 5   × bouts          (each separate disruption episode)
        − 2   × severity       (avg dB above the −32 line, during disruption)
        − 25  × predawn        (fraction of the pre-dawn window disrupted)
        − heatPenalty(THI)     (experienced overnight heat, capped at 25)
```

| Component | What it measures | Why it's weighted this way |
|---|---|---|
| **disruptMin** | total minutes above −32 | The bulk measure: how much of the night was noisy. −2/min. |
| **bouts** | separate episodes — a run of ≥ 2 min above the line (`BOUT_MIN`) | Repeated waking is worse than one continuous event of the same length. −5 each. |
| **severity** | average dB *above* −32 during disrupted minutes | How loud, not just how long. −2 per dB over the line. |
| **predawn** | fraction of **03:00–05:00 SAST** that was disrupted | Weighted heavily (−25 × fraction). Sustained pre-dawn restlessness is the tell-tale **red-mite** signature, and pre-dawn is the window that most damages REM sleep. |
| **heat (THI)** | mean **experienced heat** over the dark period | Heat is the single biggest sleep disruptor and suppresses sleep (esp. REM) *even when the birds are quiet* — a dimension the mic can't hear. Zero in the comfort zone; scales above THI 70; **capped at 25** so it can't dominate the acoustic signal. See *Experienced heat (THI)* below. |

A quiet, cool night with zero disrupted minutes scores a clean **100**. The penalties compound, so a
night that is loud, repeated, pre-dawn-heavy, *or* hot drops fast — which is exactly the profile that
warrants a farmer's attention.

### Experienced heat (THI)

It's **experienced heat**, not raw temperature, that disrupts sleep — a bird cools evaporatively (by
panting), so high humidity blocks that cooling and makes a given temperature feel much hotter. We fold
temperature and humidity into one **Temperature-Humidity Index** ([`src/lib/thi.ts`](../src/lib/thi.ts),
standard Thom/NRC form; T in °C, RH in %):

```
THI = (1.8·T + 32) − (0.55 − 0.0055·RH)·(1.8·T − 26)
```

Laying-hen stress zones (hens stress **earlier** than broilers; onset ~72): **comfort < 70 · alert
70–75 · danger 76–81 · emergency > 81**. The night's THI is the **mean** over the 20:00–05:00 window
(from the `sensors` temp + humidity feed). The heat penalty is `0` in the comfort zone and grows `2.5`
points per THI unit above 70, **capped at 25** (`HEAT_CAP`) — so a dangerously hot night removes a big
chunk, but heat never swamps the acoustic disruption measure. If there's no climate coverage for a
night, the heat factor is simply `0` (the score falls back to acoustics only).

### Score bands (the tile)

| Score | Band | Colour |
|---|---|---|
| **≥ 85** | Restful | 🟢 green |
| **60–85** | Some disruption | 🟠 amber |
| **< 60** | Disturbed | 🔴 red |

## The tile

[`DashSleepScore`](../src/components/DashSleepScore.tsx) on the Dashboard (below the flock-noise card)
shows, for the most recent scored night:

- the score, large and band-coloured, with a ▲/▼ change vs the night before
- the band label and the night's date (SAST)
- a plain-language reason line — disrupt-minutes, bouts, pre-dawn unrest, and elevated-heat notes
- an **interactive** sparkline of the last 12 nights (restful line marked at 85) — hover (mouse) or
  tap/drag (touch) any night and the whole tile updates to that night; a "latest" link resets to the
  most recent
- a **"Why this score" breakdown** for the night on show — the five factors (Noise, Bouts, Loudness,
  Pre-dawn, Heat) with a proportional bar and the points each removed; a factor that took nothing off
  shows a green "✓ ok". The Heat row shows the night's THI and is coloured by its stress zone (green
  comfort / amber alert / red danger–emergency)

It reads [`/api/sleep-score`](../src/app/api/sleep-score/route.ts) (farm-scoped, 15-day window). Empty
mic data renders a quiet "no night acoustic data yet" state, never an error.

## The alert — poor sleep several nights running

A single bad night is a one-off; **several in a row** is a recurring problem worth a WhatsApp. The
`sleepDeclineAlert` rule ([`src/lib/alerts.ts`](../src/lib/alerts.ts)) fires when the score is below
**70** (`SLEEP_POOR_SCORE`) for **2 consecutive nights** (`SLEEP_BAD_RUN`) — both tunable. It's evaluated
in [`/api/alerts`](../src/app/api/alerts/route.ts) over the same night series and lists the offending
scores. **Cause attribution:** if those poor nights all ran in the THI danger/emergency zone, the message
names **overnight heat** as the likely cause ("improve night ventilation / cooling") — the research puts
heat first; otherwise it points at the generic recurring causes (predator, light leak, red mite, equipment).

Full alert entry: [alerts-spec.md → Welfare → Poor flock sleep](../alerts-spec.md).

## Validation

Tuned and checked on real farm audio (see the notebook). Behaviour on the backtest window:

- **~15 quiet nights → 100.** The quiet baseline correctly scores clean; fans and rain do *not* drag it
  down (the −32 line sits above them).
- **The 08 Aug night → 72** (its real ~8-min disturbance lands in the early hours of 09 Aug). This is the
  worst night in the window and the score reflects it.
- **09 Aug / 12 Aug → 84** — genuine but milder disturbance.

This mirrors the night-disturbance alert's own backtest (09 Aug mean −29.7 for ~8 min; 10 Aug mean −29.9)
— the same events that trip the instantaneous alert are the ones that pull the nightly score down.

## Constants (all tunable, in `src/lib/sleepScore.ts`)

| Constant | Value | Meaning |
|---|---|---|
| `NIGHT_START_SAST` / `NIGHT_END_SAST` | 20 / 5 | dark-period bounds (SAST) |
| `DISRUPT_DB` | −32 | mean above this = a disruption |
| `BOUT_MIN` | 2 | minutes to count as one bout |
| `MIN_NIGHT_POINTS` | 120 | minimum coverage to score a night |
| `SLEEP_POOR_SCORE` | 70 | a night below this = poor rest *(alert)* |
| `SLEEP_BAD_RUN` | 2 | consecutive poor nights before we flag *(alert)* |
| `THI_COMFORT` | 70 | THI at/above this starts penalising heat *(`thi.ts`)* |
| `HEAT_K` | 2.5 | penalty points per THI unit above comfort *(`thi.ts`)* |
| `HEAT_CAP` | 25 | max points heat can remove *(`thi.ts`)* |

## Research basis

Three peer-reviewed studies underpin this score and the thermal design decisions. Each is listed with
what it found and the specific decision it justifies.

### 1. Sleep paper — the backbone of the score

**Putyora, Brocklehurst & Sandilands (2023), "The Effects of Commercially-Relevant Disturbances on Sleep
Behaviour in Laying Hens," *Animals* 13(19):3105**
([PMC10571886](https://pmc.ncbi.nlm.nih.gov/articles/PMC10571886/)) — EEG on 10 laying hens scoring
wake / SWS / REM against real farm-type disturbances.

- **Sleep is a dark-period phenomenon.** Lights-off ≈ **60% SWS, 12% REM, 28% awake**; in daylight hens
  are ~82% awake with **no REM at all**. → Scoring only the **20:00–05:00** window is correct — there is
  no meaningful sleep to protect outside it.
- **Heat is the single most disruptive factor.** At **28 °C**, REM was *nearly eliminated* and SWS
  significantly reduced (REM p < 0.001, SWS p = 0.017). REM is the fragile stage and the first thing heat
  destroys. → Justifies the **heat (THI) factor**, and 28 °C landing in our "danger" band (≈ −19 pts).
- **A single disturbance is acute and self-recovers** — no carry-over into following days. → The direct
  evidence for the **run-based alert** (fire on *consecutive* poor nights, not one): a one-off recovers;
  **chronic** disruption is where welfare damage accrues.
- **Pain/illness shifts sleep architecture**, and **24 h of feed deprivation did *not*** — night unrest
  reflects environment/health/disturbance, not hunger. → Supports treating a sustained low score as a
  welfare signal worth investigating.
- **REM only occurs in the dark and is destroyed first.** → Supports weighting late-night disruption
  heavily (the `predawn` term).

**Efficiency caveat.** This paper supports the *mechanism* (poor sleep → "less growth, increased illness,
and possible death") but **does not quantify** production — it measured EEG/behaviour, not feed
conversion or lay rate. Treat the score as a **welfare/disturbance signal**, not a validated production
predictor, until paired with our own HDEP/mortality data. Our acoustic mean is a **non-invasive proxy
for wakefulness/disturbance**, not EEG sleep staging — coarser than the paper's method, but continuous
and farm-deployable.

### 2. Production paper — sustained heat erodes output (the efficiency number)

**"Effects of Heat Stress on the Laying Performance, Egg Quality, and Physiological Response of Laying
Hens," *Animals* 2024, 14(7):1076**
([PMC11011014](https://pmc.ncbi.nlm.nih.gov/articles/PMC11011014/); [MDPI](https://www.mdpi.com/2076-2615/14/7/1076)).
**28 days of continuous heat** at THI 85 (≈ 33 °C / 66 % RH).

- **Feed intake fell ~30 %** (throughout) and **egg production ~11 %** — but the egg drop was *delayed*:
  no significant effect at day 7, significant by days 14–28. → The concrete **efficiency figure** heat
  costs, and evidence that it's **sustained, days-long** heat that erodes production. Supports scoring
  heat on the **mean over the whole night** (a brief spike barely moves it) and the run-based alert
  (persistence, not one hot evening).

### 3. Mortality paper — a fast THI *rise* kills (a separate alert)

**"An Acute, Rather Than Progressive, Increase in Temperature-Humidity Index Has Severe Effects on
Mortality in Laying Hens"** ([PMC7674306](https://pmc.ncbi.nlm.nih.gov/articles/PMC7674306/)). Compared
fast vs slow heat ramps at similar peaks.

- **Fast rise** (~32 °C within 1 h, then held) → **95 % mortality by 5 h, 100 % by 5.5 h.**
- **Slow rise** to the *same* ~31 °C over 6 h → **zero mortality.** Verbatim: *"the faster and higher the
  increase in THI, the more serious mortality."* Outcome scaled with **minutes of exposure**, not peak alone.
- → This is a **different failure mode** from the slow erosion above, and argues for a separate
  **rate-of-change heat alarm** ("THI climbing fast — act now"), distinct from the sustained-heat sleep
  penalty. Tracked as the "Heat rising fast" rule in [alerts-spec.md](../alerts-spec.md).

**Supporting sources** for the THI formula and laying-hen stress zones (not findings papers): a
[Hong Kong caged-broiler THI observational study](https://www.sciencedirect.com/science/article/abs/pii/S0306456525001810)
and a [temperature/humidity performance review](https://pmc.ncbi.nlm.nih.gov/articles/PMC7823783/).

## Deferred / next

- Validate the score against **next-day HDEP / mortality** once enough paired nights exist (does a low
  night predict a production dip? — the link the paper asserts but doesn't quantify).
- A dedicated **pre-dawn red-mite** flag (the `predawn` component is already computed per night).
- Per-farm calibration of `DISRUPT_DB` if a different site's background sits at a different absolute level.
