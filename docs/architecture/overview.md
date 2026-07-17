# Nari Surokkha — Architecture Overview

## System Components

```
┌─────────────────────────────────────────────────────────────┐
│                        CLIENTS                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  Mobile App  │  │Police Portal │  │  Admin Portal    │  │
│  │ (React Native│  │  (React +    │  │  (React +        │  │
│  │  TypeScript) │  │  Material UI)│  │  Material UI)    │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘  │
└─────────┼─────────────────┼──────────────────-┼────────────┘
          │                 │                    │
          ▼                 ▼                    ▼
┌─────────────────────────────────────────────────────────────┐
│                      NGINX (Reverse Proxy)                  │
│                   Rate Limiting | SSL/TLS                   │
└─────────────────────────────┬───────────────────────────────┘
                               │
          ┌────────────────────┴────────────────────┐
          ▼                                         ▼
┌──────────────────────┐                ┌─────────────────────┐
│   Fastify API        │                │  FastAPI ML Service  │
│   (Node.js/TS)       │◄──────────────►│  (Python)           │
│   Port: 3001         │                │  Port: 8000         │
└──────────┬───────────┘                └─────────────────────┘
           │
    ┌──────┴──────┬──────────────┐
    ▼             ▼              ▼
┌────────┐  ┌─────────┐  ┌──────────┐
│PostgreS│  │  Redis  │  │  MinIO   │
│+PostGIS│  │ (Cache/ │  │  (S3     │
│        │  │  Queue) │  │ Storage) │
└────────┘  └─────────┘  └──────────┘
```

## Data Flow — SOS Alert

```
User presses SOS
       │
       ▼
Mobile App → POST /api/v1/alerts/sos
       │
       ▼
API validates request & user
       │
       ├── Save alert to PostgreSQL
       │
       ├── Find nearest police station (PostGIS)
       │
       ├── Queue SMS notification (BullMQ → Redis)
       │
       ├── Queue push notification (BullMQ → Redis)
       │
       ├── Emit WebSocket event → Police Portal
       │
       └── Return alertId to mobile app
              │
              ▼
       Mobile app starts
       live location updates
       every 5 seconds
              │
              ▼
       API broadcasts location
       via WebSocket to police
```

## Key Architectural Decisions

### Why Fastify over Express?
- 2-3x faster JSON serialization
- Built-in TypeScript support
- Schema-based validation with Ajv
- Better plugin ecosystem for our needs

### Why BullMQ over direct SMS/push calls?
- SOS API must respond instantly (< 500ms)
- SMS/push delivery can be async with retries
- Job failure handling with exponential backoff
- Queue visibility for debugging

### Why PostGIS for location?
- Native geospatial queries (nearest station, radius search)
- Much faster than application-level distance calculation
- Handles millions of location points efficiently

### Why Prisma ORM?
- Type-safe database queries
- Auto-generated TypeScript types from schema
- Built-in migration system
- Easy relationship management

## Security Architecture

- JWT access tokens (15 min) + refresh tokens (30 days)
- All routes require authentication except: /health, /auth/login, /auth/register
- Row-level security enforced in service layer (not just middleware)
- Evidence files stored in private S3 bucket, accessed via signed URLs only
- All sensitive actions create immutable audit log entries
- WebSocket connections require valid JWT on handshake

## Database Schema Overview

See [Phase 3 — Database Schema](../../README_Antigravity_Nari_Surokkha.md) for full table list.

Core tables: `users`, `user_profiles`, `emergency_alerts`, `alert_locations`,
`cases`, `trusted_contacts`, `police_stations`, `responders`, `audit_logs`
