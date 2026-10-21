# Railway deployment — prepared, NOT deployed

> **وضعیت صادقانه (2026-10-21):** کانفیگ‌های Railway در ریپو آماده و
> اعتبارسنجی ایستا شده‌اند، اما **هیچ استقراری روی Railway انجام نشده
> است** — حساب Railway وجود ندارد. وضعیت کلی این مسیر: **BLOCKED**
> (نیازمند ساخت حساب و پروژه توسط مالک). مسیر اصلی و پشتیبانی‌شدهٔ
> production همچنان `docker-compose.prod.yml` است
> (`production-installation.md`).

## What is prepared in the repo

| Service | Root directory | Config file | Start |
|---|---|---|---|
| `api` | `apps/api` | `apps/api/railway.toml` | uvicorn on `$PORT`, healthcheck `/health` |
| `worker-critical` | `apps/api` | `apps/api/railway.worker-critical.toml` | `python -m app.worker critical` |
| `worker-ai` | `apps/api` | `apps/api/railway.worker-ai.toml` | `python -m app.worker ai` |
| `worker-media` | `apps/api` | `apps/api/railway.worker-media.toml` | `python -m app.worker media` |
| `worker-telegram` | `apps/api` | `apps/api/railway.worker-telegram.toml` | `python -m app.worker telegram` |
| `worker-notifications` | `apps/api` | `apps/api/railway.worker-notifications.toml` | `python -m app.worker notifications` |
| `worker-analytics` | `apps/api` | `apps/api/railway.worker-analytics.toml` | `python -m app.worker analytics` (also runs the build-status sync cron) |
| `web` | `apps/web` | `apps/web/railway.toml` | `npm start` (Next.js binds `$PORT`) |
| `crm` | `apps/crm` | `apps/crm/railway.toml` | nginx from the Dockerfile |

All services build from their existing Dockerfiles
(`builder = "DOCKERFILE"`). Worker services share the api image; in the
Railway dashboard, set each worker service's **config file path**
(Settings → Config as code) to its `railway.worker-<queue>.toml`, or keep
`railway.toml` and override the start command in the service settings.

## Managed data services

- **PostgreSQL** — Railway plugin (New → Database → PostgreSQL). Injects
  `DATABASE_URL` into services that reference it. The API expects an
  async SQLAlchemy URL; set the api/worker variable explicitly as
  `DATABASE_URL=postgresql+asyncpg://…` built from the plugin's
  `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE` values if the injected URL
  lacks the `+asyncpg` driver suffix.
- **Redis** — Railway plugin (New → Database → Redis); set `REDIS_URL`
  from the plugin's connection string on api + all workers.
- **Object storage** — Railway has **no MinIO/S3 plugin**. Use an external
  S3-compatible bucket (e.g. Cloudflare R2 / AWS S3 / a self-hosted MinIO)
  and set `STORAGE_PROVIDER=s3` plus the `S3_*` variables below.
  `S3_ENDPOINT_PUBLIC` must be the browser-reachable endpoint — production
  boot **fails closed** if it resolves to an internal host.

## Environment variables (names only — set values in the Railway dashboard)

**api + all workers:** `APP_ENV=production`, `DATABASE_URL`, `REDIS_URL`,
`ENCRYPTION_KEY`, `ENCRYPTION_KEY_VERSION`, `JWT_SECRET`,
`APP_BASE_URL` (public api origin), `CORS_ALLOW_ORIGINS` (web + crm
origins), `TRUSTED_PROXIES`, `STORAGE_PROVIDER`, `S3_ENDPOINT`,
`S3_ENDPOINT_PUBLIC`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`,
`S3_REGION`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`,
`SMTP_FROM`, `SMS_PROVIDER`, `SMS_API_KEY`, `SENTRY_DSN`,
`OTEL_EXPORTER_OTLP_ENDPOINT`, `LOG_FORMAT=json`, and — only if CRM
build dispatch should work from this deployment — `GITHUB_DISPATCH_TOKEN`,
`GITHUB_REPO` (see `APK_BUILD_GUIDE.md`).

**web:** `API_URL` (server-side origin of the api service — the private
Railway hostname or the public api domain), plus the public `NEXT_PUBLIC_*`
values baked at build time (set them *before* the first build).

**crm:** `VITE_API_URL` — build-time value; the CRM image must be rebuilt
after changing it (the build fails without it by design).

## Exact steps (owner, once a Railway account exists)

1. Create a Railway project from the GitHub repo
   (`nasnih123-web/maturidi-academy`), branch `main`.
2. Add PostgreSQL and Redis plugins; note their connection variables.
3. Create service `api` with root directory `apps/api`; confirm it picks
   up `apps/api/railway.toml`. Set the env vars above (values from the
   production secret store — never commit them).
4. Run migrations once before first traffic:
   `railway run --service api alembic upgrade head`
   (from a local CLI login), or add a one-off service with start command
   `alembic upgrade head` and delete it after it exits 0.
5. Create the six worker services from root directory `apps/api`, each
   with its `railway.worker-<queue>.toml` as the config file path and the
   same env vars as `api`.
6. Create services `web` (`apps/web`) and `crm` (`apps/crm`) with their
   env vars; attach public domains to `api`, `web`, `crm`.
7. **CRM port adaptation (required before public networking):** the CRM
   Dockerfile's nginx listens on port 80, but Railway injects `$PORT`.
   Change the generated nginx config in `apps/crm/Dockerfile` from
   `listen 80;` to `listen $PORT;` via the official nginx image's
   envsubst template mechanism (`/etc/nginx/templates/*.template`), or
   set the service's networking to target port 80 if your plan allows a
   fixed target port. Until one of these is done, the crm service will
   build but not receive traffic — this is a known, documented gap, not
   a hidden one.
8. Verify: `GET https://<api-domain>/health` returns 200; web loads and
   can reach the api (`CORS_ALLOW_ORIGINS` includes the web origin);
   CRM loads; trigger a notification and confirm a worker picks it up
   (worker logs).
9. Point DNS / the production domains at the Railway services and set
   `MATURIDI_WEB_URL` in the desktop shell bundles to the web domain
   (ADR-0023) and the real `EXPO_PUBLIC_API_URL` for mobile builds
   (`APK_BUILD_GUIDE.md`).

## Verified vs blocked

- ✅ Config files exist, parse as TOML, and use the documented Railway
  config-as-code schema keys (`build.builder`, `build.dockerfilePath`,
  `deploy.startCommand`, `deploy.healthcheckPath`,
  `deploy.restartPolicyType`, …).
- ✅ Every referenced Dockerfile and start command exists in the repo;
  queue names match `app.worker` (`critical ai media telegram
  notifications analytics`).
- ⛔ **Deployment itself: BLOCKED** — no Railway account/project; nothing
  here has run on Railway. First deploy must follow the steps above and
  be verified with the step-8 checks before being called live.
