# Legacy infrastructure files — NOT USED

Kept for reference only. Nothing in the repository, CI or deployment reads
these files, and they are no longer maintained. Do not deploy them.

| File | Was | Use instead |
|---|---|---|
| `docker-compose.all-in-one.yml` (was `infra/docker/docker-compose.yml`) | Early "production/staging" compose incl. the unused ML service | `docker-compose.prod.yml` (production), `deploy/staging/docker-compose.staging.yml` |
| `docker-compose.dev.yml` (was `infra/docker/docker-compose.dev.yml`) | Dev dependencies (Postgres, Redis, MinIO) | Root `docker-compose.yml` (`npm run docker:up`) |
| `github-actions-ci.yml` (was `infra/github-actions/ci.yml`) | Old copy of the CI workflow | `.github/workflows/ci.yml` |
| `nginx.conf` (was `infra/nginx/nginx.conf`) | Early edge proxy config (appended X-Forwarded-For, static upstream) | `deploy/production/nginx/nari-surokkha.conf.template` + `snippets/` |

They can be deleted once nobody needs them for reference.
