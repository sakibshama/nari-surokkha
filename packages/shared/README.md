# @nari-surokkha/shared

Shared TypeScript types, validation schemas, and constants for the Nari Surokkha platform.

## What's Inside

| File | Contents |
|------|----------|
| `src/types.ts` | All TypeScript interfaces and enums (User, Alert, Case, etc.) |
| `src/schemas.ts` | Zod validation schemas for all API endpoints |
| `src/constants.ts` | App-wide constants (limits, error codes, config values) |
| `src/index.ts` | Barrel export |

## Usage

```typescript
import {
  UserRole,
  AlertStatus,
  CreateSosAlertSchema,
  ERROR_CODES,
  MAX_TRUSTED_CONTACTS,
} from '@nari-surokkha/shared';
```

## Build

```bash
npm run build
```

## Notes

- This package is used by `services/api`, `apps/police-portal`, and `apps/admin-portal`
- For mobile (`apps/mobile`), copy types manually to avoid RN build complications
- Always update schemas here first, then update API routes accordingly
