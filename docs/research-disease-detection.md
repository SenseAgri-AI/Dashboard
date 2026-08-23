# Disease detection (incl. avian influenza) — research & approach

**Status: research / proposed.** Not built. This captures the approach and the evidence for an early
disease-warning signal — including avian influenza (AI) — from the sensors and data we already have.

## The core constraint: analytical, not trained models

We have **no labelled disease training data** (no recordings/records from infected flocks on *our*
farm). So a model trained on someone else's birds, shed and microphone **won't transfer**. Every
avian-flu *acoustic ML* paper below is therefore **background, not a blueprint**.

What transfers is the **analytical / statistical** approach: learn each flock's **own normal baseline**
from its history, then flag **deviations** — the same self-calibrating style as the Flock Night-Rest
Score. This makes the **production-indicator** literature (pure statistics — ratios, CUSUM, % drops) the
real playbook, and turns acoustics into *"the flock doesn't sound like itself"* rather than *"classify
flu."*

## The reality of HPAI

Highly-pathogenic AI is often **peracute** — birds can die within a day or two with few premonitory
signs, and a hallmark is the flock going **quiet and apathetic** (reduced normal vocalisation), *not*
louder. So "early" realistically means **hours-to-days**, and no single indicator is **AI-specific**
(flu, Newcastle, IB, EDS and heat all move the same numbers). The robust play is **multi-indicator
corroboration**, each measured against the flock's own baseline.

---

## Indicators — and what we already measure

| Indicator | Analytical method (self-baselining) | Data source | We have it? |
|---|---|---|---|
| **Mortality spike** | ratio vs previous week (≈≥2.9×), fixed % threshold, or CUSUM; confirm over 2 days | daily log / silver | ✅ tracked |
| **Egg-production / HDEP drop** | weekly ratio < ≈0.94, or deviation from the flock's own curve | daily log / silver | ✅ tracked (HDEP tile) |
| **Egg breakage ↑** | breakage-rate rise above baseline | `breakage_rate` = damaged ÷ total × 100 | ✅ tracked ([analytics/series](../src/app/api/analytics/series/route.ts), "Broken eggs" tile) |
| **Egg weight ↓** | drop below age-adjusted baseline | daily-log `avgEggWeightG` | ✅ tracked ("Egg weight" tile) |
| **Acoustic deviation** | daytime flock *unlike its own normal* — **level** (quieter/apathetic) AND a **downward frequency shift** (calls drop a register) | `audio_noise` = **level only**; spectral not captured | ⚠️ have mic; needs spectral logging on the Jetson |
| **Feed drop** | ≥5%/day for 2 days vs baseline (regulator-aligned) | feed log | ⚠️ logged, quality varies |
| **Water drop** | ≥5%/day for 2 days | daily-log `waterIntakeMl` | ⚠️ noted inaccurate |

**Key point:** breakage rate, egg weight, mortality and HDEP are **already on the dashboard**
([DashMetricCol.tsx](../src/components/DashMetricCol.tsx)) — the disease signal is buildable on data we
already carry; it needs the **analytical deviation layer** on top, not new hardware.

**Data-reliability caveat:** egg weight, damaged counts and feed/water are **manual daily-log entries**,
so a deviation is only trustworthy when logging has been consistent — tie any rule to a "recent data
present" guard (this is *why* the existing "fill the daily log" alert matters, and echoes Gonzales &
Elbers, who found on-farm feed/water records too poor to use).

---

## Evidence

### Production indicators — the analytical playbook (transfers to us)

- **Gonzales & Elbers (2018), "Effective thresholds for reporting suspicions and improving early
  detection of avian influenza outbreaks in layer chickens," *Scientific Reports*.**
  [PMC5986775](https://pmc.ncbi.nlm.nih.gov/articles/PMC5986775/) — mortality ratio **≥2.9×** the
  previous week / fixed **0.08%–0.13%** / CUSUM; egg-production weekly ratio **<0.94**; alarm confirmed
  over **2 consecutive days**. Signalled HPAI **2–6 days earlier** (LPAI **5–7 days**) than existing
  thresholds. *Feed/water records were too poor-quality to use* — a real-world warning.
- **"Mortality Levels and Production Indicators for Suspicion of HPAI in Commercially Farmed Ducks"
  (2021).** [PMC8620262](https://pmc.ncbi.nlm.nih.gov/articles/PMC8620262/) — daily **feed drop >7 g /
  water drop >14 mL** as sensitive indicators.
- **"Detection of mortality clusters associated with HPAI in poultry: a theoretical analysis."**
  [PMC2607352](https://pmc.ncbi.nlm.nih.gov/articles/PMC2607352/) — mortality-clustering method.
- **Netherlands H5 broiler outbreaks — clinical signs, transmission & reporting thresholds (2023).**
  [bioRxiv](https://www.biorxiv.org/content/10.1101/2023.01.05.522008.full.pdf)
- **Regulatory benchmark:** ≥**5% drop in feed or water for 2 consecutive days**, or ≥5% egg-production
  drop, triggers vet consultation (EU/USDA case definitions).

### Egg quality — grounds the breakage / weight signal

- **"Deterioration of eggshell quality in laying hens experimentally infected with H9N2 avian influenza
  virus," *Veterinary Research* (2016).**
  [PMC4766683](https://pmc.ncbi.nlm.nih.gov/articles/PMC4766683/) — shell thickness **decreased** and
  eggshell **calcium tracked viral load from days 1–7** post-infection; shell degrades within *days*.
  Egg-drop syndrome, Newcastle and IB do the same (thin/soft/misshapen shells). *(Caveat: not every
  disease hits egg quality, but production almost always drops.)*

### Acoustic — spectral / "register drop" (analytical, transferable — but needs spectral capture)

The one acoustic angle that *is* analytical and would transfer: **sick/respiratory-infected birds shift
their vocalisations to a LOWER frequency** — they "drop a register." This is measurable as a spectral
statistic (peak frequency, spectral centroid, low-band energy) against the flock's **own** baseline, so
it needs **no training data** — unlike the CNN classifiers below.

- Infected birds put **more energy in the low-frequency range**; healthy calls are higher, more uniform.
  Peak frequency of an infectious cough is far lower than a non-infectious one (a widely-cited figure is
  ~600 Hz vs ~1600 Hz, and infectious sounds run longer). *(Caveat: that exact 1600/600 Hz figure
  originates in **pig**-cough acoustics — verify chicken-specific numbers before quoting them.)*
- **"Acoustic features of vocalization signal in poultry health monitoring," *Applied Acoustics* (2021).**
  [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0003682X20308616) — the direct
  reference on frequency/acoustic features for health.
- **"Detection of Respiratory Diseases Based on Poultry Vocalizations Using Deep Learning"** (2024).
  [MDPI](https://www.mdpi.com/2673-9976/54/1/18)
- **"Relationships Between Chicken Vocalizations and Health, Behavior, and Welfare" (FS-1177),** Univ. of
  Maryland Extension. [link](https://extension.umd.edu/resource/relationships-between-chicken-vocalizations-and-health-behavior-and-welfare-fs-1177)
- **Patent** — identifying AI-infected birds via a frequency-peak-detect technique.
  [USPTO](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/10403305)

**The gap:** our `audio_noise` stores **loudness only** (`noise_db_mean/max/min`, `baseline_db`) — **no
frequency content.** To use the register-drop signal we'd need to extract **spectral features on the
Jetson** (peak frequency / spectral centroid / low-band energy) and log them alongside the dB levels.
**Caveats:** the frequency findings are mostly **respiratory-disease / cough-specific** and often measured
on **individual birds**, so flock-level (mixed-bird) detection is unproven; and it is **not AI-specific**.

### Acoustic ML — background only (does NOT transfer without our own training data)

- **"Detection of avian influenza-infected chickens based on a chicken sound CNN," *Computers and
  Electronics in Agriculture* (2020).**
  [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0168169920306621) — ~82–98.5%
  accuracy within 4 days post-infection (MFCC features + CNN).
- **"Method for detecting avian influenza disease of chickens based on sound analysis," *Biosystems
  Engineering* (2019).**
  [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S1537511018307128) — 87% (day 3),
  94% (day 4) post-infection.
- **"Advances in Audio-Based AI for Respiratory Health & Welfare Monitoring in Broiler Chickens,"
  *AI* (2025).** [DOI](https://doi.org/10.3390/ai7020058) — recent field review.
- **"Can We Reliably Detect Respiratory Diseases through Precision Farming? A Systematic Review,"
  *Animals* (2023).** [MDPI](https://www.mdpi.com/2076-2615/13/7/1273) — the sober reliability check.
- **"Development of a sound-based poultry health monitoring tool for automated sneeze detection,"
  *Computers and Electronics in Agriculture* (2019).**
  [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0168169918316661) — sneeze
  detection 66.7% sensitivity / 88.4% precision (shows how hard subtle respiratory sounds are).

---

## Proposed direction (not a commitment)

A **multi-indicator "suspected illness" anomaly signal**: watch each of the above against the flock's own
recent baseline and raise a corroborated flag when several move together in the disease direction
(mortality ↑, HDEP ↓, breakage ↑, egg weight ↓, feed/water ↓), worded as *"suspected illness —
investigate; possible causes include disease"* rather than a definitive AI test. The acoustic
"flock-doesn't-sound-like-itself" model is a longer R&D track that needs its own baseline, not a
transferred classifier.

**Deferred/needed:** **spectral acoustic features from the Jetson** (peak frequency / spectral centroid /
low-band energy) to capture the "register drop" — the highest-value acoustic add; a reliable water-intake
feed; consistent manual logging (or automated capture) of egg weight and damaged counts; per-flock
baselining that accounts for age and heat.
