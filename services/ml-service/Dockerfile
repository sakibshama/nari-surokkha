# Nari Surokkha — ML Service (FastAPI)
FROM python:3.11-slim

WORKDIR /app

# System deps kept minimal; add build tools only if a wheel needs compiling.
ENV PIP_NO_CACHE_DIR=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

COPY services/ml-service/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY services/ml-service/ ./

EXPOSE 8000

# Bind to 0.0.0.0 so the API container can reach it on the compose network.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
