# Testing Documentation

This directory contains test plans, checklists, and testing guidelines.

## Testing Strategy

| Level | Tool | When |
|-------|------|------|
| Unit Tests | Vitest (API), Jest (Mobile) | Every module |
| Integration Tests | Vitest + real DB | Every API module |
| Component Tests | React Testing Library | Police Portal |
| E2E Manual | Checklist below | Before each release |
| Security Testing | Manual + OWASP checklist | Phase 20 |
| Performance Testing | Artillery / k6 | Phase 19 |

## Critical E2E Test Scenarios (Phase 19)

### 1. Manual SOS Full Flow
1. User registers and logs in
2. User creates profile
3. User adds trusted contact
4. User presses SOS button
5. Verify: Alert created in DB
6. Verify: SMS notification job queued
7. Verify: Push notification job queued
8. Verify: Police portal receives WebSocket event
9. User sends location update
10. Verify: Police portal shows location on map
11. Officer acknowledges alert
12. Officer closes case
13. Verify: Audit logs created for all steps

### 2. Sensor Soft Alert (Cancel Path)
1. Trigger soft alert via test endpoint
2. Verify: Countdown screen appears (15s)
3. User cancels before countdown
4. Verify: No police notification sent
5. Verify: Cancelled event stored in DB

### 3. Evidence Upload
1. Active SOS alert exists
2. Upload photo evidence from mobile
3. Verify: File stored in private S3 bucket
4. Police officer requests evidence
5. Verify: Signed URL generated with 5-min expiry
6. Verify: Access audit logged

### 4. Role-Based Access
1. Citizen tries to access police endpoint → 403
2. Police tries to access admin endpoint → 403
3. Officer from Station A tries to see Station B case → 403
4. Responder tries to see victim details before acceptance → 403

## Test Commands

```bash
# Backend
cd services/api
npm test                  # All tests
npm run test:unit         # Unit only
npm run test:integration  # Integration only
npm run test:coverage     # With coverage report

# Police Portal
cd apps/police-portal
npm test                  # Component tests
```
