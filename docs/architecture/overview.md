# Nari Surokkha — Architecture Overview

## System Components

```
┌─────────────────────────────────────────────────────────────┐
│                        CLIENTS                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  Mobile App  │                    │  Admin Portal    │  │
│  │ (React Native│                    │  (React +        │  │
│  │  TypeScript) │                    │  Material UI)    │  │
│  └──────┬───────┘                    └────────┬─────────┘  │
└─────────┼─────────────────────────────────────┼────────────┘
          │                                      │
          ▼                                      ▼
┌─────────────────────────────────────────────────────────────┐
│                      NGINX (Reverse Proxy)                  │
│                   Rate Limiting | SSL/TLS                   │
└─────────────────────────────┬───────────────────────────────┘
                               │
          ┌────────────────────┴─────┐
          ▼                          ▼
┌──────────────────┐ ┌──────────────────┐ ┌─────────────────────┐
│ Fastify API      │ │ Worker (BullMQ)  │ │ coturn (TURN relay) │
│ HTTP + Socket.IO │ │ SMS/push fan-out,│ │ WebRTC media across │
│ Port 3001        │ │ dispatch, escal- │ │ NAT; short-lived    │
│ (N replicas)     │ │ ation, retention │ │ HMAC credentials    │
└────────┬─────────┘ └────────┬─────────┘ └─────────────────────┘
         └──────────┬─────────┘
    ┌───────────────┼──────────────┬──────────────┐
    ▼               ▼              ▼              ▼
┌──────────┐  ┌─────────┐  ┌──────────────┐  ┌──────────┐
│PgBouncer │  │  Redis  │  │ R2/S3 (prod) │  │  OSRM    │
│→ Postgres│  │ (Queue, │  │ MinIO (dev)  │  │(optional)│
│ +PostGIS │  │ pub/sub)│  │  evidence    │  │  routing │
└──────────┘  └─────────┘  └──────────────┘  └──────────┘
```

Emergency detection (keywords, shout/cry, motion) runs **on the phone**
(TFLite). There is no server-side ML service (`services/ml-service` is
deprecated and not deployed).

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
       ├── Queue nearby-responder dispatch (PostGIS)
       │
       ├── Queue SMS notification (BullMQ → Redis)
       │
       ├── Queue push notification (BullMQ → Redis)
       │
       ├── Emit WebSocket event → Admin Portal
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
       via WebSocket to admins & responders
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
`trusted_contacts`, `responders`, `audit_logs`
