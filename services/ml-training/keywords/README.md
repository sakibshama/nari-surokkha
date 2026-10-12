# "Help" / "Bachao" keyword head: training pipeline

This folder builds `apps/mobile/assets/models/kws_head.tflite`, the small classifier that turns Google speech embeddings into P(help) and P(bachao). It is reproducible end to end. Results are in [REPORT.md](REPORT.md).

```bash
pip install -r requirements.txt
./download_models.sh                       # TTS voices, speech_embedding, test recordings
export KWS_WORK=$PWD/work KWS_MODELS=$PWD/work/models
export OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1   # two processes on 2 cores: avoid BLAS thrash

python make_mel.py                         # fixed-shape mel front-end → work/oww_mel_1760.tflite (= assets/models/kws_mel.tflite)
python gen.py                              # positives + negatives from ~1,050 TTS voices (~40 min)
python gen_neg2.py                         # random-word, pseudo-word and hard-negative utterances (~15 min)
for s in train test; do for p in help bachao neg neg2; do python build_feats.py $s $p; done; done
python build_feats.py train negiso         # negatives built exactly like positives (important, see REPORT)
python train.py 3.0                        # → work/head.keras
python finetune_hard.py                    # up-weight negatives the model still confuses
python export_head.py                      # → work/kws_head.tflite (fixed [1,16,96] input)
python eval_stream.py '{"low":[0.95,3,4],"medium":[0.9,3,4],"high":[0.8,2,4]}'
python eval_isolated.py
python eval_yamnet.py                      # shout / cry checks with YAMNet
cp work/kws_head.tflite ../../../apps/mobile/assets/models/kws_head.tflite
FIXTURES=$PWD/work/fixtures python export_test_fixtures.py
(cd ../../../apps/mobile && NS_TEST_MODELS=../../services/ml-training/keywords/work/fixtures npm test)
```

If you change the thresholds, change them in `apps/mobile/src/services/emergency/constants.ts` (`TRIGGER_RULES`).

## Adding real recordings (the most valuable next step)

Record real people (both genders, different ages and accents) saying and shouting "Help" and "বাঁচাও" on the phones you target, plus everyday speech and TV. Save them as 16 kHz mono WAV and append them to the clip lists in `gen.py` (`help_train`, `bachao_train`, `neg_train`), keeping the speakers apart between train and test. Then re-run from `build_feats.py`. Even a few hundred real utterances will move the real-world numbers more than anything else.

## Files

| File | What it does |
|---|---|
| `paths.py` | Work and model folders (environment overridable) |
| `texts.py` | Keyword phrases and negative sentences per language |
| `gen.py`, `gen_neg2.py` | TTS synthesis (sherpa-onnx VITS/Piper voices); held-out speakers are listed in `VOICES` |
| `augment.py` | Pitch, reverberation, band limits, noise types, SNR, clipping, levels |
| `feats.py` | **Reference streaming front-end**; the app's `KeywordSpotter.ts` mirrors it exactly (tested to 6e-6) |
| `build_feats.py` | Embedding windows for positives, speech-stream negatives and isolated negatives |
| `train.py`, `finetune_hard.py`, `export_head.py` | Head training and TFLite export |
| `eval_stream.py`, `eval_isolated.py`, `eval_yamnet.py` | Evaluation (REPORT.md) |
| `export_test_fixtures.py` | ONNX copies of the shipped models plus WAV cases for the mobile end-to-end test |

The older `../audio_*.py` scripts trained the previous synthetic-sine-wave MLP. The app no longer uses them.
