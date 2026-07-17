# Production Deployment Runbook

**Nari Surokkha is a mission-critical emergency system. Uptime, data integrity, and strict security are paramount. Do not deploy to production until you have thoroughly tested in staging.**

## 1. Production Architecture Overview
- **Orchestration**: Managed Kubernetes (e.g., EKS/GKE) or clustered Docker Swarm for high availability.
- **Database**: Managed PostgreSQL instance (e.g., AWS RDS, GCP Cloud SQL) with PostGIS enabled and automatic multi-AZ failover.
- **Queue/Cache**: Managed Redis Cluster.
- **Object Storage**: AWS S3 or Google Cloud Storage for Video/Audio Evidence (private bucket).
- **SSL Termination**: Nginx Ingress or Cloud Load Balancer with auto-renewing Let's Encrypt certificates.

## 2. Security & Secrets Management
- **Never commit `.env` files**. Use a secrets manager (AWS Secrets Manager, HashiCorp Vault) to inject environment variables at runtime.
- Use **Argon2** for hashing passwords. Ensure all staging passwords (e.g., `Test@1234`) are strictly denied in production.
- **CORS Setup**: Enforce explicit frontend origins in the API, rejecting `*`.

## 3. SSL Configuration Guide
All production traffic **must** run over HTTPS/WSS.
If using Nginx directly (no managed load balancer), use `certbot` for Let's Encrypt:
```bash
sudo certbot --nginx -d api.yourdomain.com -d police.yourdomain.com -d admin.yourdomain.com
```
In your `nginx.conf`, ensure WebSocket upgrade headers use `wss://`:
```nginx
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```

## 4. Backup & Disaster Recovery
- **Database**: Schedule automated daily logical backups (`pg_dump`) to S3, with a 30-day retention policy, separate from automated RDS snapshotting.
- **Evidence**: Enable Cross-Region Replication (CRR) on the S3 Evidence bucket.
- **Rollback**: Every deployment must be tagged with a strict Semantic Version (e.g., `v1.0.4`). If a deployment fails, instantly revert the orchestration manifest to the previous tag.

## 5. Monitoring & Incident Response
- **Monitoring Stack**: Deploy Prometheus & Grafana to monitor:
  - Node.js API memory usage (watch for memory leaks in WebSocket connections).
  - PostgreSQL active connections and slow queries.
  - Redis memory and queue lengths.
- **Incident Response Protocol**:
  1. **Identify**: Alerts trigger via PagerDuty/Slack.
  2. **Triage**: Check API health endpoint and Grafana metrics.
  3. **Contain**: If under DDoS, adjust Web Application Firewall (WAF) rules or Cloudflare "Under Attack" mode.
  4. **Mitigate**: If it is a bad code release, immediately execute the Rollback plan.
  5. **Resolve**: Deploy fix to staging, test, then release to production.

## 6. Pre-Flight Release Checklist
- [ ] Managed Database is provisioned and PostGIS extension is enabled.
- [ ] Managed Redis is provisioned.
- [ ] `DATABASE_URL` and `REDIS_URL` are securely injected into containers.
- [ ] Real SMS Gateway API Keys are configured.
- [ ] Real Firebase Server Key is configured.
- [ ] S3 Bucket is configured for Evidence with public access strictly blocked.
- [ ] `NODE_ENV` is explicitly set to `production`.
- [ ] `JWT_SECRET` is a secure, 256-bit cryptographically random string.
- [ ] First Admin user has been securely bootstrapped (NOT using `seed.ts`).
