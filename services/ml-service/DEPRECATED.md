# services/ml-service — deprecated, not deployed

This FastAPI service is **not used by anything** and is no longer deployed:

- Emergency detection (keywords, shout/cry, motion) runs **on the phone**
  with TFLite models (`apps/mobile`, see `docs/EMERGENCY_DETECTION.md`).
- The API's `ml` module is a model registry and a consented training-sample
  collector (`/api/v1/ml/samples`); it never calls this service.
- `ML_SERVICE_URL` / `ML_SERVICE_API_KEY` were declared in the API's env
  schema but referenced nowhere else.

As of 12 Oct 2026 it has been removed from `docker-compose.prod.yml`, the CI
workflow (lint/test job and image build), the deploy workflow and
`.env.production.example`. The code is kept for reference. Training code for
the on-device models lives in `services/ml-training`.

If server-side inference is ever needed again, wire an actual caller in the
API first, then restore a compose service, a CI job and an API key.
