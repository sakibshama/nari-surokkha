# API Documentation

This directory contains API endpoint documentation for Nari Surokkha.

## Format

Each module has its own documentation file:

| File | Module |
|------|--------|
| `auth.md` | Authentication (Phase 4) |
| `users.md` | User profiles (Phase 5) |
| `contacts.md` | Trusted contacts (Phase 6) |
| `alerts.md` | SOS alerts (Phase 7) |
| `location.md` | Live location (Phase 8) |
| `notifications.md` | Notifications (Phase 9) |
| `evidence.md` | Evidence upload (Phase 12) |
| `responders.md` | Responder system (Phase 13) |
| `cases.md` | Case management (Phase 14) |
| `incidents.md` | Incident reports (Phase 17) |

## Base URL

```
Development: http://localhost:3001/api/v1
Staging:     https://api.staging.narisurokkha.example.com/api/v1
Production:  https://api.narisurokkha.example.com/api/v1
```

## Authentication

All protected endpoints require:
```
Authorization: Bearer <access_token>
```

## Standard Response Format

```json
// Success
{
  "success": true,
  "data": { ... },
  "message": "Optional message"
}

// Error
{
  "success": false,
  "error": {
    "code": "AUTH_001",
    "message": "Unauthorized",
    "details": {}
  }
}
```
