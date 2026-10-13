# Automatic emergency detection: Shout · "Help" · Crying · "Bachao" (বাঁচাও)

The phone listens to its microphone and runs small AI models on the device. When it hears an emergency it starts a **15-second soft alert**. If nobody answers "I'm okay" in time, the soft alert becomes a full SOS to trusted contacts and nearby responders.

No audio is recorded, stored or uploaded. Samples stay in memory for about 2 s and are overwritten continuously.

---

## 1. Architecture

```
 microphone (16 kHz PCM16, react-native-live-audio-stream, patched)
        │  ~128 ms chunks
        ▼
 EmergencySoundDetector ──────────────────────────────────────────────┐
   ├─ KeywordSpotter          every 80 ms                             │
   │    kws_mel.tflite        1760 samples → 8×32 log-mel             │
   │    kws_embedding.tflite  76 mel frames → 96-d speech embedding   │
   │    kws_head.tflite       16 embeddings (1.28 s) → P(help),P(bachao)
   ├─ SoundEventClassifier    every 500 ms                            │
   │    yamnet.tflite         0.975 s → 521 AudioSet scores           │
   │    shout = max(Shout, Bellow, Yell, Screaming)                   │
   │    cry   = max(Crying/sobbing, Whimper, Wail/moan)               │
   └─ TriggerDecider          per trigger: ≥ k of last n scores ≥ threshold,
                              8 s refractory, per-trigger on/off + sensitivity
        │ Detection
        ▼
 SoftAlertManager ── duplicate / cooldown / active-SOS checks
   ├─ countdown 15 s (vibration + notification with "I'm safe" / "Send SOS now")
   ├─ in parallel: location fix → POST /alerts/soft (mlMetadata: trigger, confidence…)
   ├─ "I'm okay"     → PATCH /alerts/:id/soft/cancel, cooldown starts
   ├─ "I need help"  → PATCH /alerts/:id/soft/confirm  → SOS
   ├─ no answer      → same as "I need help"
   ├─ no server alert→ POST /alerts/sos
   └─ server unreachable → SMS from the SIM to trusted contacts (offline SOS)
        │ every step
        ▼
 Alert history (on the phone, 300 entries)  +  EmergencyAlert.mlMetadata (server)
```

As a backstop, the server escalates any soft alert still unanswered after 30 s. A phone that dies mid-countdown therefore still raises the alarm, provided the soft alert reached the server.

### Code map

| File | Role |
|---|---|
| `apps/mobile/src/services/emergency/constants.ts` | Model shapes, YAMNet class indices, **thresholds per sensitivity** |
| `…/KeywordSpotter.ts` | Streaming Help / Bachao pipeline |
| `…/SoundEventClassifier.ts` | YAMNet scheduling and class aggregation |
| `…/TriggerDecider.ts` | Scores → detections (k-of-n rule, refractory) |
| `…/EmergencySoundDetector.ts` | Orchestration, backlog control, live meters, pause/resume |
| `…/SoftAlertManager.ts` | The 15 s soft alert, escalation, deduplication, cooldown, offline fallback |
| `…/runtime.ts` | Wires everything to the API, location, SMS, notifications, navigation |
| `…/MicrophoneStream.ts`, `pcm.ts` | Native mic stream → Float32 |
| `…/tfliteModels.ts` | Loads the four bundled models with `react-native-fast-tflite` |
| `…/backgroundMonitor.ts` | Android foreground service (type `microphone`) |
| `…/alertNotifications.ts` | Countdown notification and its action buttons |
| `…/detectionSettings.ts`, `alertHistory.ts` | Persisted settings and history |
| `apps/mobile/src/components/EmergencyRuntime.tsx` | Decides when to listen (settings, foreground/background, SOS active, permission) |
| `apps/mobile/src/screens/main/EmergencyDetectionScreen.tsx` | Per-trigger switches and sensitivity, background, cooldown, permissions, live meters, test alert |
| `apps/mobile/src/screens/main/AlertHistoryScreen.tsx` | History with filters |
| `apps/mobile/src/screens/main/SoftAlertScreen.tsx` | Countdown UI (state comes from the manager) |
| `apps/mobile/plugins/withEmergencyListening.js` | Config plugin: microphone foreground-service type and permission |
| `patches/react-native-live-audio-stream+1.1.1.patch` | Native fixes (leak, crash, stale samples) |
| `services/ml-training/keywords/` | How the Help/Bachao head was built and evaluated (reproducible) |

---

## 2. Models

| Model | Source | Size | Licence |
|---|---|---|---|
| `yamnet.tflite` | Google YAMNet (AudioSet, 521 classes), the official TF-Lite classification export | 4.1 MB | Apache-2.0 |
| `kws_mel.tflite` | Google speech_embedding mel front-end as packaged by openWakeWord v0.5.1, re-exported with a **fixed 1760-sample input** (fast-tflite cannot resize inputs). Parity with the original ≤ 2e-6. | 1.1 MB | Apache-2.0 |
| `kws_embedding.tflite` | Google speech_embedding (openWakeWord v0.5.1, unmodified) | 1.3 MB | Apache-2.0 |
| `kws_head.tflite` | **Trained for this app**: 16×96 → 128 → 64 → 2 (sigmoid) | 0.8 MB | yours |

### Why not an existing keyword spotter?

These were benchmarked on the same speech before writing any code:

| Option | "Help" | "Bachao" |
|---|---|---|
| sherpa-onnx open-vocabulary KWS (gigaspeech 3.3M) | 36 % | 0 % |
| Whisper-tiny (multilingual) + text matching | 71 % | 15 % |
| **This head** (held-out voices, 20 dB SNR, Medium) | **see §4** | **see §4** |

Neither off-the-shelf option handles Bangla, and Whisper is 100 MB and too slow to run continuously.

### How the head was trained (summary)

- **Voices:** about 1,050 synthetic speakers. English: LibriTTS-R (904), VCTK (109), Arctic, HFC and others. Bangla: mimic3 bn (16 speakers) and Coqui bn. Hindi (2) and Nepali (19), because বাঁচাও / बचाओ / बचाऊ are the same word.
- **Phrases:** "Help!", "Help me!", "Somebody help!", "হেল্প" …; "বাঁচাও", "আমাকে বাঁচাও", "বাঁচাও বাঁচাও!", "बचाओ", "Bachao!" …
- **Negatives:** about 6,000 utterances. Ordinary sentences, random English words, Bangla/Hindi pseudo-words built from real syllables, and **hard negatives** chosen to sound close: hello, hell no, held, yelp, kelp; বাজাও, বাচ্চা, বাঁচা, বাঁচবো, চাও; बजाओ, बच्चा …
- **Augmentation:** pitch ±3 semitones, reverberation (RT60 0.1–0.7 s), telephone band limits, white, pink, brown and hum noise, environmental sounds, babble, SNR 0–25 dB, clipping (shouting into the mic), and levels from −35 to −8 dBFS.
- **Held out:** 104 LibriTTS speakers, 9 VCTK speakers and 1 each from Arctic, Southern English, Ryan and Amy; 2 Bangla, 2 Nepali and 1 Hindi voice. None of these were used in training.

---

## 3. Settings and their defaults

| Setting | Default | Notes |
|---|---|---|
| Listen for emergencies (master) | On | Asks for microphone and notification permission on first launch, with an explanation |
| Keep listening in the background | On | Android shows a permanent "Nari Surokkha is listening" notification, as Android requires |
| Shout / "Help" / Crying / "Bachao" | All on, Medium | Each can be switched off or set to Low, Medium or High |
| Ignore automatic detections after "I'm okay" | 1 min | 30 s, 1 min or 5 min. Manual silent alerts are never blocked. |

Thresholds (`constants.ts → TRIGGER_RULES`):

| Trigger | Low | **Medium** | High |
|---|---|---|---|
| Help / Bachao (score every 80 ms) | ≥0.95 in 3 of 4 | **≥0.90 in 3 of 4** | ≥0.80 in 2 of 4 |
| Shout (score every 0.5 s) | ≥0.60 in 2 of 3 | **≥0.40 in 2 of 3** | ≥0.30 once |
| Cry (score every 0.5 s) | ≥0.60 in 4 of 5 | **≥0.45 in 3 of 5** | ≥0.30 in 2 of 4 |

---

## 4. Measured accuracy

Measured in the build sandbox with the exact pipeline the phone runs. A Python reference was trained against, and the TypeScript test compares the app's own code with that reference (§6).

### "Help" and "Bachao": held-out voices, streaming, with the app's decision rule

Recall is the share of held-out utterances that started an alert. There are 307 per keyword, from 104+ voices the model never heard. Each word was placed in a 4 s stream at −20 dBFS.

| Background | "Help" Low / **Medium** / High | "Bachao" Low / **Medium** / High |
|---|---|---|
| Quiet room | 88 % / **93 %** / 98 % | 90 % / **94 %** / 98 % |
| Noise at 20 dB SNR | 83 % / **89 %** / 94 % | 89 % / **91 %** / 96 % |
| Noise at 10 dB SNR | 73 % / **79 %** / 88 % | 83 % / **87 %** / 93 % |
| Noise at 5 dB SNR (loud street or crowd) | 65 % / **75 %** / 86 % | 76 % / **82 %** / 92 % |

| False alerts | Low | **Medium** | High |
|---|---|---|---|
| Per hour of continuous held-out speech in noise (0.63 h) | 0 | **≤ 1.6** (1 event) | ≈ 11 |
| Isolated held-out utterances that raised an alert (1,096 utterances, ⅓ deliberately confusable) | 0.6 % | **0.9 %** | 2.5 % |
| "Help" heard as "Bachao", or the reverse | 0 % | **≤ 0.7 %** | ≤ 1.6 % |

The utterances that still slip through at Medium are near-homophones: "Kelp", "Hell, no!", "Butch, ow!", and Nepali बजाऊ ("play").

The negative test set is deliberately hard. It is about one third confusable words (hello, hell no, held, kelp, বাজাও, বাচ্চা, बजाओ …), so ordinary conversation should do better than this. Each false alert costs the user one "I'm okay" tap, followed by the cooldown.

**What these numbers do not cover:** the voices are synthetic, from the same TTS families as training, though different speakers. Real frightened, shouted, accented or whispered speech will score lower. See §8.

### Shout and crying (YAMNet)

| Audio | Result |
|---|---|
| Real crying recording (sherpa-onnx test set) | Detected at every sensitivity |
| 12 other real recordings: cat, whistling, a cappella singing, **laughter**, finger snaps, smoke alarm, siren ×2, water, dog/rooster, pig | No shout or cry alert at any sensitivity. In the full-pipeline test, the dog/rooster recording **did** trigger "Help" at Medium (1 of 12). |
| 0.27 h of held-out speech at normal (−25 dBFS) and loud (−10 dBFS) levels | 0 shout and 0 cry alerts per hour at every sensitivity |
| **Real shouting or screaming** | **Not measured.** No such recordings were reachable from this sandbox. |

---

## 5. Background behaviour

| Platform | What happens |
|---|---|
| Android 8–15 | While the app is open, a foreground service of type `microphone` is started (Android 14 forbids starting it from the background). The microphone then keeps working when the app is backgrounded or the screen is off. The countdown, server calls and SMS fallback all run in the background, and the notification buttons work from the lock screen. |
| Android, killed app | If the user swipes the app away, the system may kill the service; the app has to be reopened. There is no start-on-boot. |
| Android battery savers (Xiaomi, Oppo, Vivo, Samsung "deep sleep") | These can still kill the service. Users should set Nari Surokkha to "No restrictions" or "Unrestricted" battery use. The app cannot do that for them. |
| iOS | The `audio` background mode keeps the recording session alive after the app is backgrounded. iOS stops it if another app takes the audio session, for example a phone call. **Not tested.** |
| During an active SOS | Detection pauses so the SOS screen can use the microphone for the live call, and resumes afterwards |
| Web | Not available; the screen says so |

---

## 6. Tests

```bash
cd apps/mobile
npm test                                   # 19 logic tests, no models needed
NS_TEST_MODELS=/path/to/fixtures npm test  # + full pipeline on real audio (fixtures: see below)
```

- `softAlertManager.test.ts`: countdown escalation; "I'm okay" cancels and starts the cooldown; cancel before the server alert exists (no false SOS); duplicate merging; suppression during SOS; offline SMS fallback; degraded server SMS triggers phone SMS; total failure stays visible; no GPS fix.
- `triggerDecider.test.ts`, `keywordSpotter.test.ts`, `pcm.test.ts`: decision rule, buffering and timing, PCM decoding.
- `detector.models.test.ts`: the real `EmergencySoundDetector` on WAV files, using ONNX conversions of the shipped `.tflite` models. It checks the expected detections per group, and that the TypeScript keyword scores equal the Python training reference (maximum difference 6 × 10⁻⁶). Fixtures come from `services/ml-training/keywords/export_test_fixtures.py`.

Last run (Medium sensitivity, the shipped code path, ONNX copies of the shipped models):

| Group | Result | Gate |
|---|---|---|
| "Help", held-out voices, mixed noise | 32 / 40 | ≥ 75 % |
| "Bachao", held-out voices, mixed noise | 39 / 40 | ≥ 85 % |
| Normal speech, 40 files of 3 utterances | 40 / 40 with no alert | ≥ 95 % |
| Real crying recording | 1 / 1 | 100 % |
| Real non-emergency sounds | 11 / 12 (dog/rooster triggered "Help") | ≥ 90 % |
| All 21 tests | **pass** | |

---

## 7. Testing on a real phone (checklist)

1. `npm install --legacy-peer-deps` at the repo root. The postinstall step applies the native patch.
2. Build a development client: `cd apps/mobile && eas build --profile development --platform android`. Alternatively, run `npx expo prebuild --clean && npx expo run:android`. **Expo Go will not work.**
3. On first launch, accept the microphone and notification prompts. Then go to **Menu → Emergency Detection** and check that Status shows **Listening**.
4. Tap **Show live meters**. Say "Help", say "বাঁচাও", shout, and play a crying sound from another phone. Each bar should cross its mark.
5. With the app open, shout "Help!" twice. The countdown should appear. Tap **I'm okay**, and **Alert history** should show *Cancelled*.
6. Lock the phone and shout "বাঁচাও". It should vibrate and show the notification. Tap **I'm safe** on the lock screen.
7. With a test contact, let a countdown run out. The contact should receive the SOS, and history should show *SOS sent (no answer)*.
8. Turn on airplane mode (keep the SIM on) and repeat step 7. The SMS should go out from the SIM, and history should show *SMS sent offline*.
9. Leave the app in the background for 30 minutes with the screen off, then repeat step 6. Note the battery use in Android settings.

Write down every miss and every false alert, with the sensitivity setting. Those notes are the data for tuning thresholds or retraining.

---

## 8. Limitations (read before launch)

1. **The keyword head was trained only on synthetic (TTS) voices.** TTS-trained wake words generalise to real speech (that is the openWakeWord method), but real shouted Bangla from frightened people is different. Expect lower recall than in §4 until it is retrained with real recordings. The pipeline in `services/ml-training/keywords/` is ready for that: add WAVs and re-run it.
2. **Shout detection has not been measured on real shouting** (see §4).
3. **"Crying" also fires on a baby crying.** YAMNet's "Crying, sobbing" class responds strongly to infants, even though the separate "Baby cry" class is excluded. Parents may want Crying off or on Low.
4. **TV, films and games** with shouting, crying or the word "help" can trigger alerts. That is why there is a 15 s cancel window, a cooldown and per-trigger switches.
5. **"Help" is English-only.** "Bachao" covers Bangla বাঁচাও and Hindi/Nepali बचाओ. Other phrases (for example "ছাড়ো", "কেউ আছো") are not recognised.
6. **Battery:** continuous inference costs roughly 10–20 % of one CPU core on a mid-range phone (estimated from desktop timings of about 2 ms per embedding and 1.6 ms per YAMNet window). This has not been measured on a phone.
7. **Android OEM battery killers** and the Android 14 rule that the microphone service must be started from the foreground (see §5).
8. **Play Store:** a permanent microphone foreground service needs a clear explanation in the Play Console's foreground-service declaration (category "user-initiated personal safety").
9. **iOS has not been built or tested.**

---

## 9. Data limitations and how to collect real data

Every detector in this app was trained or tuned **without real emergency
data**. The numbers in §4 prove the pipeline works; they are not field accuracy.

| Model | Trained on | What it needs |
|---|---|---|
| Motion (fall / struggle), `motion_model.json` | 6,000 **synthetic** IMU windows (`services/ml-training/synthetic.py`) | Real labelled 2 s windows from phones in pockets and bags |
| Keywords ("Help" / "Bachao"), `kws_head.tflite` | ~1,050 **TTS** voices | Real people saying and shouting the words, on target phones |
| Shout / cry (YAMNet) | Google AudioSet (real audio) | A measured recall on real shouting; only false alarms were measured |

### Motion: use the existing consented loop

The app already collects labelled motion windows, **only when the user has
turned on training-data sharing** (`mlDataSharingEnabled`, off by default):

- confirming a real SOS after a motion trigger uploads that window as
  `fall`/`struggle` (`source: confirmed_sos`);
- tapping "I'm okay" on a motion alert uploads it as `normal`
  (`source: false_alarm`).

Uploads go to `POST /api/v1/ml/samples` (`apps/mobile/src/services/ml/motionSampleUploader.ts`)
and store only the numeric window, the label and coarse device info. To retrain:

1. Check volume: `GET /api/v1/ml/samples/stats?kind=motion` (admin).
2. Pull: `python services/ml-training/pull_samples.py --out data/real`
   (needs `API_URL` and an admin `ADMIN_TOKEN`).
3. Train on synthetic + real: `python train.py --real data/real --out models`.
4. Publish through the model registry (`POST /api/v1/ml/models`, admin) for an
   OTA update — see `services/ml-training/TRAINING_AND_UPDATE_GUIDE.md`.

Real emergencies are rare, so positives will accumulate slowly. Speed it up
with a **staged collection session**: volunteers, with written consent, wear
the phone as users do and act out falls (onto mats) and struggles while a
facilitator records the label with the app's manual/test path. Keep each
volunteer entirely in either the training or the test set.

### Keywords and shouting: run a recording campaign

The app does **not** upload microphone audio, and should not start doing so
silently: recordings of voices are personal data and far more sensitive than
IMU windows. Collect audio in a separate, explicit campaign instead:

- written, informed consent per speaker (purpose, retention, right to delete);
  for minors, guardian consent — or exclude them;
- both genders, a spread of ages and regional accents; normal, shouted, crying
  and whispered "Help" / "বাঁচাও" plus everyday speech, TV and street noise;
- record on the phones you target, 16 kHz mono WAV, and store the files outside
  this repository (they are personal data);
- split by **speaker** into train/test, append the clips to `gen.py`
  (`help_train`, `bachao_train`, `neg_train`) and re-run the pipeline in
  `services/ml-training/keywords/` from `build_feats.py`;
- report recall on the real test speakers next to the synthetic numbers in §4
  before changing the default thresholds.

A few hundred real utterances will move real-world accuracy more than any
further synthetic data. Until then, keep the 15 s cancel window and the
per-trigger switches, and present automatic detection in the store listing and
onboarding as an aid — not a guarantee.
