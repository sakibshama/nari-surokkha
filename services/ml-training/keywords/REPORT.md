# Keyword head and YAMNet evaluation (12 Oct 2026)

## Data

| | Train | Test (held-out speakers) |
|---|---|---|
| "Help" utterances | 1,626 (×3 augmentations ×2 windows) | 307 |
| "Bachao" utterances (বাঁচাও / बचाओ / बचाऊ / "Bachao") | 1,626 (×3 ×2) | 307 |
| Negative utterances: sentences, random words, pseudo-words, hard negatives | 4,992 | 1,096 |
| Negative speech streams (unique audio) | 2.7 h | 0.63 h |

**Held-out voices:** LibriTTS-R speakers 800–903, VCTK 100–108, Arctic 17, Southern-English 5, Ryan, Amy, Bangla mimic3 14–15, Hindi Priyamvada, and Nepali Google 16–17.

## Lessons from building it

1. **Off-the-shelf options failed:** sherpa-onnx open-vocabulary KWS got 0 % on "bachao", and Whisper-tiny got 15 %.
2. **Pure digital silence leaked the label.** Positives with no added noise sat on exact zeros. The first head learned "speech after digital silence = keyword". It looked excellent on streams but fired on 23 % of isolated ordinary utterances. The fix was a microphone noise floor on every positive.
3. **Negatives must be built like positives.** Adding isolated negative utterances in the same canvases as the positives (`negiso`) cut isolated false alerts from about 23 % to 0.9 %, at a cost of about 5 points of recall.
4. **Test negatives must not contain the keyword.** "Help desk" was in the first negative list. It was removed, and the affected clips were filtered out by replaying the generator's random stream.

## Results: shipped head, the app's decision rule

**Recall** (an alert was raised for the utterance):

| Background | Help L / M / H | Bachao L / M / H |
|---|---|---|
| quiet | 0.88 / **0.93** / 0.98 | 0.90 / **0.94** / 0.98 |
| 20 dB SNR | 0.83 / **0.89** / 0.94 | 0.89 / **0.91** / 0.96 |
| 10 dB SNR | 0.73 / **0.79** / 0.88 | 0.83 / **0.87** / 0.93 |
| 5 dB SNR | 0.65 / **0.75** / 0.86 | 0.76 / **0.82** / 0.92 |

**False alerts:**

| | Low (0.95, 3/4) | **Medium (0.9, 3/4)** | High (0.8, 2/4) |
|---|---|---|---|
| Continuous speech stream, 0.63 h, alerts/h (help + bachao) | 0 | **1.6** | 11.2 |
| Isolated utterances in a quiet room | 0.6 % | **0.9 %** | 2.5 % |
| Cross-confusion (help ↔ bachao) | 0 % | ≤ 0.7 % | ≤ 1.6 % |

The remaining isolated false alerts at Medium are near-homophones: "Kelp." (2/13), "Hell, no!" (1/10), "Butch, ow!" (1/13), Nepali बजाऊ (1/4), and two random-word strings.

## End-to-end, app code (TypeScript) on WAV files

These results come from `apps/mobile/__tests__/detector.models.test.ts`, run on ONNX copies of the shipped .tflite files at Medium:

| Group | Result |
|---|---|
| Help, held-out, SNR mix | 32/40 |
| Bachao, held-out, SNR mix | 39/40 |
| Normal speech, 40 files | 0 alerts |
| Real crying | detected |
| 12 real non-emergency sounds | 11/12. The dog/rooster recording raised "Help". |
| TypeScript vs Python keyword scores | max difference 5.9e-6 |

## YAMNet (shout / cry)

| Audio | Max shout | Max cry | Alerts (L/M/H) |
|---|---|---|---|
| Real crying (infant) | 0.11 | 1.00 | cry: 3/4/4 events |
| Laughter | 0.15 | 0.33 | none |
| Cat, whistling, singing, snaps, smoke alarm, sirens, water, rooster, pig | ≤ 0.11 | ≤ 0.11 | none |
| Held-out speech at −25 and −10 dBFS (0.27 h each) | — | — | 0 per hour |

**Shout recall has not been measured:** no recordings of real shouting or screaming were reachable from the build environment. The class choice (Shout, Bellow, Yell, Screaming) and the thresholds follow YAMNet's AudioSet labels and need on-device checking. Use the live meters in the app (§7 of `docs/EMERGENCY_DETECTION.md`).
