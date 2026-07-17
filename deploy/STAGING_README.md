# Staging Deployment Guide

This guide details the steps to launch the Nari Surokkha platform in a staging environment.

## Prerequisites
- Docker and Docker Compose installed.
- Node.js installed (for running initial Prisma migrations/seeds).

## 1. Configure Environment
Copy the example environment file and customize it if needed:
```bash
cp deploy/staging/.env.example deploy/staging/.env
```

## 2. Build Frontend Portals
Before starting the cluster, ensure both React portals are statically built so Nginx can serve them:
```bash
# Build Police Portal
cd apps/police-portal
npm install
npm run build

# Build Admin Portal
cd ../admin-portal
npm install
npm run build
```

## 3. Start the Cluster
Launch the PostgreSQL, Redis, API Backend, and Nginx containers:
```bash
cd deploy/staging
docker-compose -f docker-compose.staging.yml up -d --build
```

## 4. Run Migrations & Seeding
Once the database container (`nari_surokkha_db_staging`) is healthy, apply the Prisma schema and seed test users:
```bash
cd services/api
npm install
npx prisma migrate deploy
npm run prisma:seed
```

## 5. Verify Health
Run the bash health check script to ensure the API is responding:
```bash
bash deploy/scripts/healthcheck.sh
```

## 6. Accessing the Staging Environment
- **Police Portal**: `http://localhost/police/`
- **Admin Portal**: `http://localhost/admin/`
- **API Health**: `http://localhost/api/v1/health`

### Staging Credentials
- **Admin**: `superadmin@nari.test` / `Test@1234`
- **Police**: `rahim.dhaka@police.test` / `Test@1234`
- **Responder**: `+8801912345699` / `Test@1234`
- **Citizen**: `+8801912345678` / `Test@1234`
