# Production Installation — Maturidi Academy

Installing and operating the platform on a real Linux server with
`docker-compose.prod.yml`.

> **Status as of 2026-10-20.** This guide was written from the actual
> compose files, Dockerfiles and environment templates in the repository.
> Steps marked **«Requires live-server verification»** have **not** been
> executed by the documentation author on a real production server — the
> sandbox used for development has no Docker daemon. Treat them as a
> checklist to run and confirm on your first real deployment, not as
> already-proven results.

---

## 1. Architecture you are deploying

`docker-compose.prod.yml` defines exactly these services — nothing else is
part of the current production architecture:

| Group | Services | Role |
|---|---|---|
| Data | `postgres`, `redis`, `minio` | database, cache/queues/rate-limit, S3-compatible object storage |
| Migration | `migrate` | **one-shot** Alembic job; `api` and workers start only after it completes successfully |
| API | `api` | FastAPI (async), WebSocket gateway |
| Workers | `worker-critical`, `worker-ai`, `worker-media`, `worker-telegram`, `worker-notifications`, `worker-analytics` | ARQ background workers by queue class |
| Frontends | `web`, `crm` | Next.js site, React/Vite admin CRM |
| Analytics | `metabase-db`, `metabase` | Metabase on its own Postgres |
| Observability | `prometheus`, `grafana`, `loki` | metrics, dashboards, log aggregation |

Persistent data lives in named volumes (`pgdata`, `redisdata`, `miniodata`,
`promdata`, `grafanadata`, `metabase-pgdata`). Back them up — containers are
disposable, volumes are not.

## 2. Server prerequisites

### 2.1 Operating system

Use a Linux distribution **supported by Docker Engine** — in practice a
current Ubuntu LTS (22.04 / 24.04) or Debian stable. The requirement comes
from Docker Engine and the `python:3.14-slim`-based images, not from the
application code itself.

### 2.2 Resources — **initial estimates, not measured capacity**

No production load has been measured yet. Treat the following as a starting
point for a small launch, to be revised after real monitoring data exists:

| Resource | Minimum (estimate) | Notes |
|---|---|---|
| CPU | 4 vCPU | API + 6 workers + frontends share the host |
| RAM | 8 GB | PostgreSQL, Redis, MinIO, Metabase and Grafana are all resident |
| Disk | 60 GB SSD | images + volumes; **plus separate backup space at least equal to the data volumes** |

### 2.3 Software

- Docker Engine + the **Compose plugin** (`docker compose`, v2 syntax).
- `git`, `curl`, `openssl`.
- A domain name with DNS control, and a TLS termination point (see §4).

Install Docker Engine on Debian/Ubuntu (official Docker apt repository —
**«Requires live-server verification»**):

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git openssl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
docker --version && docker compose version
```

(Use `linux/debian` instead of `linux/ubuntu` in the two URLs on Debian.)

## 3. Network, ports, firewall, SSH

- **Public**: only the reverse proxy (80/443) — and SSH (22), restricted.
- **Internal only** (never publish to the internet): PostgreSQL 5432,
  Redis 6379, MinIO 9000/9001, the API and workers, Prometheus 9090,
  Grafana, Loki, Metabase. Keep them on the compose network / bind to
  localhost, and reach admin UIs through SSH tunnels or the proxy with
  authentication.
- Firewall: default-deny inbound; allow 80/443 from anywhere, 22 only from
  your admin IP(s).
- SSH policy: key-only login (`PasswordAuthentication no`), no direct root
  login, a non-root deploy user in the `docker` group or with sudo.

Example (UFW) — **«Requires live-server verification»**:

```bash
sudo ufw default deny incoming
sudo ufw allow from <your-admin-ip> to any port 22 proto tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

## 4. Domain, DNS, TLS, reverse proxy

1. Point your domain(s) at the server (A/AAAA records): one host for the
   public web, one for the CRM/admin, and the API reachable by both
   frontends (directly or via the proxy).
2. Terminate TLS at a reverse proxy (nginx or Caddy) in front of `web`,
   `crm` and `api`; obtain certificates with Let's Encrypt.
3. Set the public URLs in `.env.prod` to match exactly (§5):
   `APP_BASE_URL`, `WEB_API_URL`, `CRM_API_URL`, and
   `CORS_ALLOW_ORIGINS` limited to your real origins.
4. MinIO file URLs: keep `STORAGE_PROVIDER=s3` and make sure presigned URLs
   are generated against the public endpoint browsers can reach (see
   [Storage notes](storage.md)).

Detailed proxy snippets are deployment-specific; the exact vhost is
**«Requires live-server verification»** on your chosen proxy.

## 5. Configuration and secrets (`.env.prod`)

### 5.1 Create the file

```bash
git clone https://github.com/nasnih123-web/maturidi-academy.git
cd maturidi-academy
cp .env.prod.example .env.prod
chmod 600 .env.prod
```

`.env.prod` is **never** committed. Only `.env.prod.example` lives in Git.

### 5.2 Generate strong secrets

Every placeholder in the example must be replaced. Generate each value
independently:

```bash
openssl rand -hex 32    # JWT_SECRET
openssl rand -hex 32    # ENCRYPTION_KEY (keep ENCRYPTION_KEY_VERSION in sync when rotating)
openssl rand -hex 24    # POSTGRES_PASSWORD
openssl rand -hex 24    # REDIS_PASSWORD
openssl rand -hex 24    # MINIO_ROOT_PASSWORD
openssl rand -hex 24    # GRAFANA_PASSWORD, MB_APP_DB_PASS, ...
```

### 5.3 Mandatory variables

| Variable | Notes |
|---|---|
| `JWT_SECRET` | strong random, unique per environment |
| `ENCRYPTION_KEY` + `ENCRYPTION_KEY_VERSION` | field-encryption key; losing it means losing encrypted data — store a copy in your password manager |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | must match the credentials inside `DATABASE_URL` |
| `REDIS_PASSWORD` | must match `REDIS_URL` |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | object-storage root credentials |
| `DATABASE_URL`, `REDIS_URL` | connection strings assembled from the values above — keep them consistent |
| `APP_BASE_URL`, `WEB_API_URL`, `CRM_API_URL`, `CORS_ALLOW_ORIGINS` | your real public URLs/origins only |
| `STORAGE_PROVIDER` | `s3` in production (MinIO) |
| `GRAFANA_PASSWORD`, `MB_*` | monitoring / Metabase credentials |

Optional integrations (features degrade gracefully when unset):
`SMTP_*` (email), `SMS_*` (SMS), `ANTHROPIC_API_KEY` (AI fatwa/assistant —
without it those features return an honest "unavailable" instead of
fabricated answers), `SENTRY_DSN`, `OTEL_EXPORTER_OTLP_ENDPOINT`.

The application **fails fast at boot on placeholder or too-short secrets**
in production mode — if the API refuses to start, check this section first.

### 5.4 GitHub Secrets (for CI / platform builds)

CI on GitHub needs no production secrets. Code-signing certificates and
store credentials for future native builds belong in GitHub Secrets /
your CI secret store — never in the repo, never in Drive shares.

> ⚠️ **Never put a real `.env.prod`, a token, a private signing key, a
> database dump of real users, or any password into GitHub or a shared
> Google Drive folder.** Only templates and redacted reports belong there.

## 6. First installation — **«Requires live-server verification»**

### 6.1 Preflight

```bash
docker compose -f docker-compose.prod.yml config > /dev/null && echo "compose config OK"
```

This validates the merged configuration with your `.env.prod` values
without printing secrets.

### 6.2 Build and start

```bash
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml ps
```

### 6.3 Migrations — the one-shot pattern

The `migrate` service runs Alembic once (`alembic upgrade head`) and exits;
`api` and the workers declare `depends_on: service_completed_successfully`
on it. **Never run migrations from multiple API replicas concurrently** —
the init-job pattern exists precisely to avoid that. To re-run manually:

```bash
docker compose -f docker-compose.prod.yml run --rm migrate
```

### 6.4 Health checks

```bash
docker compose -f docker-compose.prod.yml ps        # all services up/healthy
curl https://<your-api-host>/health
curl https://<your-api-host>/api/v1/health
```

### 6.5 Admin account and 2FA

The super_admin is created by the seed that runs with the API setup from
the **`ADMIN_EMAIL`** / **`ADMIN_PASSWORD`** environment values — there is
no demo account. After first login, **enable 2FA (TOTP) for the admin
account immediately**; admin/super_admin roles require it server-side.

### 6.6 Smoke tests (run every one, record results)

1. Log in to the web and the CRM with the admin account.
2. Check role-based access: a non-admin account must not see admin areas.
3. **Generate a certificate/receipt PDF** — this exercises the system fonts
   baked into the API image (`fonts-noto-core` + `fonts-dejavu-core`).
4. Upload a file and download it back through the public URL (MinIO
   presigned-URL path).
5. Trigger one background job (e.g. a notification) and confirm a worker
   processes it.

Do not announce the deployment as working until all five pass on the real
server.

## 7. Upgrade and rollback

### 7.1 Upgrade — **«Requires live-server verification»**

1. **Back up first** — database + volumes, before any migration
   (see [Disaster recovery](disaster-recovery.md) and `infra/backup.sh`).
2. `git pull` the target commit/tag on the server.
3. `docker compose -f docker-compose.prod.yml build`
4. `docker compose -f docker-compose.prod.yml up -d` — the `migrate`
   one-shot job applies schema changes before the new API starts.
5. Re-run the health checks and smoke tests (§6.4–6.6).

### 7.2 Rollback

1. Check out the previous known-good commit/tag.
2. Rebuild and `up -d` again.
3. If the failed release ran a migration, restore the pre-upgrade backup
   taken in step 7.1.1 — schema rollback by hand is not a supported path.

## 8. Backups and data retention

- Policy, RPO/RTO and the restore drill are documented in
  [Disaster recovery](disaster-recovery.md); the helper script is
  `infra/backup.sh` (produces backups with SHA-256 manifests).
- A real backup→restore drill passed in the development sandbox
  (Phase 17), but **a restore on this production server is
  «Requires live-server verification»** — schedule one before go-live.
- Keep backups off the application host; encrypt backups that contain
  user data; never share them via public links.

## 9. Logs and monitoring

```bash
docker compose -f docker-compose.prod.yml logs -f api worker-ai
docker compose -f docker-compose.prod.yml logs --tail=200 migrate
```

Prometheus scrapes the services, Grafana holds the dashboards, Loki
aggregates logs (`infra/monitoring/prometheus.yml`). Operational
procedures and alert response live in the [Runbook](runbook.md);
broader deployment notes in [Deployment](deployment.md) and
[Staging](staging.md).

## 10. What is NOT yet production-verified (honest list)

- End-to-end run of `docker-compose.prod.yml` on a real server
  (no Docker daemon was available in the development sandbox).
- Live PostgreSQL / Redis multi-process behaviour, live MinIO and ClamAV
  scanning under real traffic.
- Native mobile/desktop installers and EAS cloud builds (need the owner's
  expo.dev connection and signing certificates).
- Load capacity numbers — §2.2 is an estimate; measure before scaling
  claims. See [Scaling notes](scaling-to-100k.md).

## See also

- [Local development guide](../installation/LOCAL_DEVELOPMENT.md)
- [Deployment notes](deployment.md) · [Runbook](runbook.md) ·
  [Disaster recovery](disaster-recovery.md) · [Storage](storage.md)
- [Engineering contract](../engineering-contract.md)
