# Research & methods — papers behind each feature

The canonical list of peer-reviewed sources our welfare features are built on, grouped by feature, with
what each one actually contributes. When a feature uses a finding, cite it here (and link back from the
feature doc). Keep this list honest — note what a paper does *not* establish, too.

Legend: 🟢 built on it · 🔵 supporting/reference · ⚪ to read next.

---

## Flock Night-Rest Score (sleep) — [docs/flock-night-rest-score.md](flock-night-rest-score.md)

**Sleep papers**

1. 🟢 **Putyora, Brocklehurst & Sandilands (2023). "The Effects of Commercially-Relevant Disturbances on
   Sleep Behaviour in Laying Hens." *Animals* 13(19):3105.**
   [PMC10571886](https://pmc.ncbi.nlm.nih.gov/articles/PMC10571886/)
   — EEG on 10 hens. Gives us: sleep is a dark-period phenomenon (≈60% SWS / 12% REM, no REM in
   daylight); **heat nearly eliminates REM at ~28 °C**; a single disturbance is acute & self-recovers
   (→ the run-based alert). Does **not** quantify production.

2. 🟢 **Putyora et al. (2023). "The Effects of Mild Disturbances on Sleep Behaviour in Laying Hens."
   *Animals*.** [PMC10093027](https://pmc.ncbi.nlm.nih.gov/articles/PMC10093027/)
   — Tested wind, 90 dB noise, and **light (20 lux)** during 21:00–01:00. Gives us: mild night
   disturbances increase wakefulness (p<0.001) and cut deep SWS; **REM unaffected** (p=0.540). Crucially,
   **hens compensate for short disruptions the same night — no lasting welfare effect.** → So we do **not**
   penalise brief light; what matters is total darkness (below). Caveat: light was bundled with wind +
   noise, so light-alone effect isn't isolated.

**Lighting / dark-period (darkness factor)**

3. 🔵 Industry & welfare guidance (Hendrix/HN light programmes; layer management): layers need **enough
   darkness to rest — ~8 h target, ~4–6 h welfare floor**; near-continuous light raises fear and hurts
   eggshell quality; operating light is **5–20 lux**. → Justifies a **one-sided "hours of darkness"
   factor** (penalise too little, not too much). (Trade/technical sources — treat as reference.)

4. ⚪ **Separate, not in the sleep score:** *too much* darkness = too little **light**, and layers need
   ~14–16 h light for peak **egg production**. A photoperiod/production check — parked for later.

**Experienced-heat factor** — shares the climate papers below.

---

## Climate / heat (heat factor + upcoming climate alerts)

4. 🟢 **"Effects of Heat Stress on the Laying Performance, Egg Quality, and Physiological Response of
   Laying Hens." *Animals* 2024, 14(7):1076.**
   [PMC11011014](https://pmc.ncbi.nlm.nih.gov/articles/PMC11011014/)
   — 28-day dose-response across 5 THI levels (21→32.7 °C). Gives us: the temperature gradient of harm —
   water intake ↑ at ~28.5 °C, feed/weight/eggshell/yolk degrade at ~28.9 °C, **egg count only drops at
   32.7 °C (−11%, −30% feed)**. Caveat: **constant-temperature chamber**, not a fluctuating shed — likely
   overstates real-world effect.

5. 🟢 **"An Acute, Rather Than Progressive, Increase in Temperature-Humidity Index Has Severe Effects on
   Mortality in Laying Hens."** [PMC7674306](https://pmc.ncbi.nlm.nih.gov/articles/PMC7674306/)
   — Fast heat rise (~32 °C in 1 h) → 95% mortality in 5 h; same peak reached slowly → 0 deaths. Gives
   us: **rate of rise matters as much as peak** → argues for a separate fast-rise heat alarm.

6. 🔵 THI formula & zones — Marai et al. poultry index (Celsius "feels-like" temperature) +
   laying-hen stress zones. See [thi.ts](../src/lib/thi.ts) and [docs/sensors.md](sensors.md).

7. ⚪ **To read next:** a **cyclic / diurnal** heat-stress study (hot daytime peak + cool night) — matches
   a real fluctuating shed far better than the constant-temperature production paper (#4).

---

## Red mite (Dermanyssus gallinae) — night activity

8. 🟢 **Willems, Nijs, Sleeckx & Norton (2025). "Monitoring Night-Time Activity Patterns of Laying Hens
   in Response to Poultry Red Mite Infestations Using Night-Vision Cameras." *Animals* 15(19):2928.**
   [PMC12524107](https://pmc.ncbi.nlm.nih.gov/articles/PMC12524107/)
   — Night-vision cameras + AI over the dark period. Gives us: infestation **~doubled night activity**
   (wakefulness ~24% → ~67%; most-active state 43 → 120 min/night, +192%), **~23× head-shaking/scratching**,
   heaviest **20:00–01:00**. **Corrects an earlier assumption:** mites do **not** cause a *pre-dawn*
   restlessness spike — they **suppress** the normal 02:00–03:00 spike; the signature is *sustained*
   whole-night restlessness. Caveats: **visual** (camera) measure, not acoustic; compared negligible vs
   heavy infestation a month apart, so early-detection lead time is unestablished.

## Disease detection (incl. avian influenza) — [research-disease-detection.md](research-disease-detection.md)

*Approach is analytical (self-baselining deviation), not trained ML — see the doc for why. Legend as
above, plus ⬜ = background only (trained model, does NOT transfer without our own labelled data).*

**Production indicators — the analytical playbook (transfers to us)**

9. 🟢 **Gonzales & Elbers (2018). "Effective thresholds for reporting suspicions and improving early
   detection of avian influenza outbreaks in layer chickens." *Scientific Reports*.**
   [PMC5986775](https://pmc.ncbi.nlm.nih.gov/articles/PMC5986775/) — mortality ratio ≥2.9×/week or fixed
   0.08–0.13%, egg ratio <0.94, CUSUM, confirm over 2 days → HPAI 2–6 days (LPAI 5–7) earlier. Feed/water
   records were too poor-quality to use (caveat).

10. 🟢 **"Mortality Levels and Production Indicators for Suspicion of HPAI in Commercially Farmed Ducks"
    (2021).** [PMC8620262](https://pmc.ncbi.nlm.nih.gov/articles/PMC8620262/) — feed drop >7 g / water
    drop >14 mL per day as sensitive indicators.

11. 🔵 **"Detection of mortality clusters associated with HPAI in poultry: a theoretical analysis."**
    [PMC2607352](https://pmc.ncbi.nlm.nih.gov/articles/PMC2607352/) — mortality-clustering method.

12. 🔵 **Netherlands H5 broiler outbreaks — clinical signs, transmission & reporting thresholds (2023).**
    [bioRxiv](https://www.biorxiv.org/content/10.1101/2023.01.05.522008.full.pdf)

**Egg quality — grounds the breakage / weight signal**

13. 🟢 **"Deterioration of eggshell quality in laying hens experimentally infected with H9N2 avian
    influenza virus." *Veterinary Research* (2016).**
    [PMC4766683](https://pmc.ncbi.nlm.nih.gov/articles/PMC4766683/) — shell thickness ↓, eggshell calcium
    tracks viral load days 1–7; shell degrades within days. (EDS/Newcastle/IB do likewise.)

**Acoustic — spectral / "register drop" (analytical, transferable — needs spectral capture on the Jetson)**

Sick/respiratory-infected birds shift vocalisations to **lower frequency** — measurable as a spectral
statistic vs the flock's own baseline, no training data needed. Our `audio_noise` stores loudness only,
so this needs spectral features added on the mic device. Findings are mostly respiratory/cough-specific
and often individual-bird; not AI-specific.

19. 🟢 **"Acoustic features of vocalization signal in poultry health monitoring." *Applied Acoustics*
    (2021).** [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0003682X20308616)
    — frequency/acoustic features for health; sick birds show more low-frequency energy.

20. 🔵 **"Detection of Respiratory Diseases Based on Poultry Vocalizations Using Deep Learning" (2024).**
    [MDPI](https://www.mdpi.com/2673-9976/54/1/18)

21. 🔵 **"Relationships Between Chicken Vocalizations and Health, Behavior, and Welfare" (FS-1177),** Univ.
    of Maryland Extension. [link](https://extension.umd.edu/resource/relationships-between-chicken-vocalizations-and-health-behavior-and-welfare-fs-1177) — plain-language overview.

22. 🔵 **Patent — identifying AI-infected birds via a frequency-peak-detect technique.**
    [USPTO](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/10403305)
    *(Note: the widely-cited ~600 Hz vs ~1600 Hz infectious/non-infectious cough figure originates in
    pig-cough acoustics — verify chicken-specific numbers before quoting.)*

**Acoustic ML — background only (does NOT transfer without our own training data)**

14. ⬜ **"Detection of avian influenza-infected chickens based on a chicken sound CNN." *Computers and
    Electronics in Agriculture* (2020).**
    [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0168169920306621) — ~82–98.5%
    within 4 days (MFCC + CNN).

15. ⬜ **"Method for detecting avian influenza disease of chickens based on sound analysis." *Biosystems
    Engineering* (2019).**
    [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S1537511018307128) — 87% (day 3),
    94% (day 4).

16. ⬜ **"Advances in Audio-Based AI for Respiratory Health & Welfare Monitoring in Broiler Chickens."
    *AI* (2025).** [DOI](https://doi.org/10.3390/ai7020058) — field review.

17. ⬜ **"Can We Reliably Detect Respiratory Diseases through Precision Farming? A Systematic Review."
    *Animals* (2023).** [MDPI](https://www.mdpi.com/2076-2615/13/7/1273) — reliability check.

18. ⬜ **"Development of a sound-based poultry health monitoring tool for automated sneeze detection."
    *Computers and Electronics in Agriculture* (2019).**
    [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0168169918316661) — sneeze
    detection 66.7% sensitivity / 88.4% precision.

## Not yet backed by papers (parked)
- Distress/discomfort call classification (acoustic) — using our own validation for now.
