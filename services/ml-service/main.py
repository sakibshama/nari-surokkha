import os
import random
from typing import List
from fastapi import FastAPI, HTTPException, Header, Depends
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
import time

app = FastAPI(title="Nari Surokkha ML Service")

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


class Location(BaseModel):
    latitude: float
    longitude: float

class AudioData(BaseModel):
    audio_base64: str
    sample_rate: int

class MotionData(BaseModel):
    accelerometer: List[List[float]]  # [x,y,z] over time
    gyroscope: List[List[float]]
    timestamp: int

class SafeRouteRequest(BaseModel):
    start: Location
    destination: Location
    time_of_day: str  # "day", "night"

@app.get("/health")
def health_check():
    return {"status": "healthy", "version": "0.1.0"}

@app.post("/api/v1/analyze-audio", dependencies=[Depends(require_api_key)])
def analyze_audio(data: AudioData):
    """Mock endpoint to analyze audio for distress signals (screams, trigger words)."""
    time.sleep(0.5)
    prob = random.uniform(0.1, 0.9)
    if len(data.audio_base64) > 1000:
        prob = 0.85
    is_distress = prob > 0.7
    return {
        "is_distress": is_distress,
        "confidence": round(prob, 2),
        "detected_type": "distress_audio" if is_distress else "none",
    }

@app.post("/api/v1/analyze-motion", dependencies=[Depends(require_api_key)])
def analyze_motion(data: MotionData):
    """Mock endpoint to analyze accelerometer/gyroscope data for falls or struggles."""
    time.sleep(0.3)
    prob = random.uniform(0.05, 0.95)
    is_fall = prob > 0.75
    is_struggle = prob > 0.6 and not is_fall
    detection = "none"
    if is_fall:
        detection = "fall"
    elif is_struggle:
        detection = "struggle_motion"
    return {
        "detected_type": detection,
        "confidence": round(prob, 2),
        "is_emergency": detection != "none",
    }

@app.post("/api/v1/safe-route", dependencies=[Depends(require_api_key)])
def get_safe_route(data: SafeRouteRequest):
    """Mock endpoint returning a safe route over safety scores."""
    mid_lat = (data.start.latitude + data.destination.latitude) / 2
    mid_lng = (data.start.longitude + data.destination.longitude) / 2
    offset = 0.005
    path = [
        {"latitude": data.start.latitude, "longitude": data.start.longitude},
        {"latitude": mid_lat + offset, "longitude": mid_lng + offset},
        {"latitude": data.destination.latitude, "longitude": data.destination.longitude},
    ]
    return {"route": path, "estimated_time_mins": 15, "safety_score_avg": 85.5}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
