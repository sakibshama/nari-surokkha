"""
Tests that the ML service does REAL inference (not the old random mock).

These are the guardrails that stop the service from silently regressing to
random numbers: the models must load, probabilities must be a valid
distribution, inference must be deterministic, and a crafted high-impact motion
window must be classified as an emergency.
"""

import numpy as np
import pytest

import inference


def test_models_load():
    for kind in ("motion", "audio"):
        m = inference.load_model(kind)
        assert m["layers"] and m["standardize"]
        assert isinstance(m["version"], int)


def test_motion_probs_are_a_distribution_and_deterministic():
    rng = np.random.default_rng(0)
    acc = rng.normal(0, 0.02, (100, 3)).tolist()
    gyr = rng.normal(0, 0.02, (100, 3)).tolist()
    r1 = inference.analyze_motion(acc, gyr)
    r2 = inference.analyze_motion(acc, gyr)
    assert abs(sum(r1["probs"].values()) - 1.0) < 1e-6
    # deterministic — the mock returned random numbers, this must not
    assert r1 == r2


def test_motion_detects_fall_impact():
    # free-fall (~0g) then a hard multi-g impact spike → should be an emergency
    acc = np.tile([0.0, 0.0, 1.0], (100, 1))
    acc[30:40] = 0.0                      # free fall
    acc[40:45] = [5.0, 4.0, 6.0]          # impact
    gyr = np.zeros((100, 3))
    gyr[40:45] = [4.0, 3.0, 5.0]
    r = inference.analyze_motion(acc.tolist(), gyr.tolist())
    assert r["is_emergency"] is True
    assert r["label"] in ("fall", "struggle")


def test_audio_probs_are_a_distribution():
    wave = (0.02 * np.random.default_rng(1).normal(0, 1, 48000)).tolist()
    r = inference.analyze_audio(samples=wave)
    assert abs(sum(r["probs"].values()) - 1.0) < 1e-6
    assert r["label"] in ("background", "speech", "scream", "distress_keyword")


def test_audio_base64_path():
    wave = (0.05 * np.random.default_rng(2).normal(0, 1, 48000))
    import base64
    pcm = (np.clip(wave, -1, 1) * 32767).astype("<i2").tobytes()
    r = inference.analyze_audio(audio_base64=base64.b64encode(pcm).decode())
    assert "label" in r and 0.0 <= r["confidence"] <= 1.0


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
