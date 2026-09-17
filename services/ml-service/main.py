import os
from typing import List, Optional
from fastapi import FastAPI, HTTPException, Header, Depends
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware

import inference

app = FastAPI(title="Nari Surokkha ML Service", version="1.0.0")

# ─── CORS ────────────────────────────────────────────────────
# Restrict to an explicit allow-list. Never use "*" together with
# credentials. Configure via ML_ALLOWED_ORIGINS (comma-separated).
_origins = os.getenv("ML_ALLOWED_ORIGINS", "http://localhost:3001")
ALLOWED_ORIGINS = [o.strip() for o in _origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-API-Key"],
)

# ─── API-key auth ────────────────────────────────────────────
# The backend API authenticates to this service with a shared secret.
# When ML_SERVICE_API_KEY is set, every analysis endpoint requires a
# matching X-API-Key header. (Health check stays public for probes.)
ML_API_KEY = os.getenv("ML_SERVICE_API_KEY")


def require_api_key(x_api_key: str = Header(default=None)):
    if ML_API_KEY:
        if not x_api_key or x_api_key != ML_API_KEY:
            raise HTTPException(status_code=401, detail="Invalid or missing API key")


# ─── request models ──────────────────────────────────────────
class AudioData(BaseModel):
    audio_base64: Optional[str] = None      # base64 PCM16 mono, little-endian
    samples: Optional[List[float]] = None   # or raw float samples [-1, 1]
    sample_rate: int = 16000


class MotionData(BaseModel):
    accelerometer: List[List[float]]  # [[ax,ay,az], ...] over the window
    gyroscope: List[List[float]]      # [[gx,gy,gz], ...] over the window
    timestamp: int = 0


@app.get("/health")
def health_check():
    # Report which models loaded so ops can verify the service is real.
    loaded = {}
    for kind in ("motion", "audio"):
        try:
            m = inference.load_model(kind)
            loaded[kind] = {"version": m["version"], "classes": m["classes"]}
        except Exception as e:  # pragma: no cover
            loaded[kind] = {"error": str(e)}
    return {"status": "healthy", "version": "1.0.0", "models": loaded}


@app.post("/api/v1/analyze-audio", dependencies=[Depends(require_api_key)])
def analyze_audio(data: AudioData):
    """Real audio distress inference (scream / distress keyword) using the
    shipped audio_model.json — identical weights to the on-device model."""
    try:
        r = inference.analyze_audio(audio_base64=data.audio_base64, samples=data.samples)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"audio analysis failed: {e}")
    return {
        "is_distress": r["is_emergency"],
        "confidence": r["emergency_confidence"] if r["is_emergency"] else r["confidence"],
        "detected_type": r["label"],
        "probs": r["probs"],
        "model_version": r["model_version"],
    }


@app.post("/api/v1/analyze-motion", dependencies=[Depends(require_api_key)])
def analyze_motion(data: MotionData):
    """Real motion inference (fall / struggle) using the shipped
    motion_model.json — identical weights to the on-device model."""
    try:
        r = inference.analyze_motion(data.accelerometer, data.gyroscope)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"motion analysis failed: {e}")
    return {
        "detected_type": r["label"],
        "confidence": r["confidence"],
        "is_emergency": r["is_emergency"],
        "emergency_confidence": r["emergency_confidence"],
        "probs": r["probs"],
        "model_version": r["model_version"],
    }


# NOTE: Safe Route is NOT handled here. Routing + safety scoring live in the
# backend API (services/api), which has the incident database (PostGIS) needed
# to score a route. This service only runs the trained classifiers.


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
