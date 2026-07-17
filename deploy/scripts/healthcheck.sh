#!/bin/bash
# Staging Health Check Script

API_URL="http://localhost:3000/api/v1/health"

echo "Checking Nari Surokkha API health at $API_URL..."

# Fetch the HTTP status code
STATUS_CODE=$(curl -s -o /dev/null -w "%{http_code}" $API_URL)

if [ "$STATUS_CODE" -eq 200 ]; then
  echo "✅ API is healthy (Status: 200)"
  exit 0
else
  echo "❌ API health check failed (Status: $STATUS_CODE)"
  exit 1
fi
