# Feature Status Matrix — Maturidi Academy (Phase-0 Audit, 2026-10-21)

Tree: `release/v1.1.0-remediation` @ `5bcdde87`. Status key: **Works** = end-to-end path exists in code (UI → API → service → DB) with auth; **Partial** = real path exists but an external dependency, missing sub-flow, or honest-degradation limits it; **UI-only** = surface exists but the operative backend flow does not complete; **Missing** = no implementation. Evidence = primary file paths. Backend test files are under `apps/api/tests/` (582 collected, live-verified).

## A. API modules (apps/api/app/modules)

| Feature | API endpoint(s) | Service / logic | DB model(s) | Authorization | External dep | Tests | Status |
|---|---|---|---|---|---|---|---|
| Auth (register/login/refresh/logout) | `POST /auth/register|login|refresh|logout` | `auth/service.py` (Argon2id, rotation+reuse detection) | User, Session, RefreshToken | public / session | — | test_auth.py, test_hardening*.py | **Works** |
| Password reset + phone verify | `POST /auth/password-reset/*`, phone codes | `auth/service.py` | PasswordResetToken, PhoneVerificationCode | public, one-time tokens | SMTP/SMS (degrade) | test_remediation2_track1_lifecycle.py | **Works** |
| MFA / TOTP | `POST /auth/2fa/setup|enable|recover` | `auth/service.py:764/771/808`, replay claim `:101` | RecoveryCode, User(totp fields) | session; setup-scope token for unenrolled admins | authenticator app | test_remediation2_track1_2fa.py | **Partial** — no status/disable/regenerate endpoints (F-02); no client UI (F-01) |
| WS tickets + realtime | `POST /auth/ws-ticket`, WS `/ws` | `auth/service.py`, `core/realtime.py` | WsTicket, Session | full-scope session only | Redis (pub/sub + outbox) | test_realtime.py, …track1_ws.py, …track_a_ws.py | **Works** |
| Users & profile | `GET/PATCH /users/me`, sessions, consent, devices | `users/router.py` (14 routes) | User, Session, UserConsent, UserDevice | self | — | test_auth.py | **Works** (but UserOut lacks roles/permissions → F-07) |
| Admin core (settings/themes/audit) | `/admin/*` (part of 45 admin routes) | `admin/service.py`, `core/platform_settings.py`, `core/audit.py` | PlatformSetting, Theme, AuditLog | require_permission | — | test_admin_phase14*.py | **Works** |
| Admin content center | `/admin/content/*` | `admin/content_center_service.py` | Page, NavItem, Banner, Announcement, HomeSection, IslamicEvent, ScholarQuote | require_permission | — | test_admin_phase14.py, test_cms.py | **Works** |
| Admin connections | `/admin/connections/*` | `admin/connections_service.py` | PlatformSetting | require_permission | Telegram/LLM providers | test_admin_phase14.py | **Works** |
| Admin builds | `GET/POST /admin/builds/releases|prereqs|requests|rebuild` | `admin/builds_service.py` | BuildRelease, BuildRequest | require_permission | **GitHub Actions — NOT connected** | test_admin_phase14.py (records) | **UI-only flow** — record-only queue (F-05) |
| Admin notifications / broadcast | `/admin/notifications/*` | `admin/notify_service.py` | NotificationBroadcast, NotificationDelivery, Notification | require_permission | email/SMS/push providers | test_me_notifications_phase16.py | **Works** |
| Admin users-360 / roles | `/admin/users/*`, `/admin/roles/*` | `admin/users360_service.py`, `admin/roles_service.py` | User, Role, Permission, RolePermission, UserRole | require_permission (roles mgmt: super_admin) | — | test_admin_phase14.py | **Works** |
| CMS + Islamic calendar | `/content/*`, `/api/v1` cms router (16) | `content/cms_service.py`, `content/service.py`, `core/hijri.py`, `content/calendar_tasks.py` | Page, IslamicEvent | public read / admin write | hijri-converter | test_cms.py | **Works** |
| Home sections | `GET /api/v1/home/sections` (2) | `home/service.py` | HomeSection | public | — | test_home.py | **Works** |
| Quran + tasbih + adhan | `/quran/*`, `/tasbih/*`, `/adhan/*` (13) | `quran/` module, `core/hijri.py` | UserAyahNote, DhikrSession, DhikrDailyCount | public / self | **alquran.cloud API** (hermetic stub in tests) | test_quran_phase5.py | **Works** (external text provider) |
| Fatwa (RAG ask + sessions) | `/fatwa/*` (35 incl. verify, submissions, clusters) | `fatwa/service.py`, `providers.py`, `ingestion.py`, `embeddings.py` | FiqhKnowledgeChunk, FiqhTopic, MadhabPosition, FatwaSession, FatwaMessage, AIUsageLog | user / scholar roles | **Claude API key** (setting `ai.claude_api_key`); degrades to `llm_unavailable` | test_fatwa_phase6.py, test_phase17_rag_eval.py | **Partial** — real pipeline, answers require owner's API key |
| Fatwa scholar panel + submissions + clusters | `/admin/fatwa/*`, `/fatwa/submissions/*`, clusters router | `fatwa/cluster_service.py`, `submissions_service.py` | FatwaSubmission, QuestionCluster, ClusterMember, VerificationCheck | scholar / scholar_author | LLM (clustering assist) | test_social_phase10.py | **Works** |
| Calculators (inheritance/zakat) | `/calculators/*`, `/admin/calculators/*` (13) | `calculators/engine.py`, `prices.py`, `service.py` | InheritanceRuleConfig, InheritanceCase, ZakatRuleConfig, ZakatCalculation, NisabPriceCache | public calc / admin config | nisab price source | test_calculators_phase7.py, test_phase17_fiqh_golden.py | **Partial** — engine works; rule configs seeded draft/empty pending scholar approval (by design, contract §15.5) |
| LMS | `/lms/*`, `/certificates/*`, `/admin/lms/*` (37) | `lms/service.py`, `lms/certificates.py` (reportlab PDF) | Curriculum, Course, Lesson, UserProgress, Certificate, CourseCohort, CohortEnrollment, CoursePrerequisite | user / admin | system fonts (in Docker image) | test_lms_phase8.py | **Works** |
| Library DMS | `/library/*`, `/admin/library/*` (16) | `library/service.py`, `tasks.py` | LibraryItem, LibraryItemVersion, MediaAsset | scholars_only via signed URLs | S3/MinIO storage, ClamAV (scan path) | test_library_phase9.py | **Works** (scan/infra verification on live infra pending) |
| Social + moderation | `/social/*`, `/moderation/*` (24) | `social/` module | SocialGroup, GroupMembership, SocialPost, PostLike, SocialComment, SocialFollow, SocialReport, ModerationBannedWord | user / moderator | — | test_social_phase10.py | **Works** |
| Places | `/places/*`, `/admin/places/*` (8) | `places/` module | ReligiousPlace | public / admin | — | test_phase11_telegram_widgets.py | **Works** |
| Telegram (bot + Telethon + distribution) | `/telegram/*` (15) | `telegram/bot_service.py`, `connect_service.py`, `distribute_service.py`, `import_service.py`, `jobs.py` | TelegramDistributionPolicy, TelegramPublished, TelegramCallback | `telegram.manage` | **Telegram** (bot token / user session — owner's) | test_phase11_telegram_widgets.py | **Partial** — code complete; live posting needs owner's bot token/account |
| API keys + widgets | `/api-keys/*` (7), `/widgets/*` (4) | `api_keys/service.py`, `widgets/` module | ApiKey | user (scoped keys) | — | test_security_phase17.py, test_phase11… | **Works** |
| Voice assistant | `/voice/*`, `/admin/voice/*` (5) | `voice/service.py`, `stt.py`, `tts.py` | VoiceSession, VoiceUsageLog | user | **faster-whisper / TTS engine** — honest `stt_unavailable`/`tts_unavailable` degradation; Quran never synthesized | test_voice_phase12.py | **Partial** — pipeline real, engines not installed in this environment |
| Finance (donations/payments) | `/finance/*`, `/admin/finance/*` (14) | `finance/service.py`, `gateways.py`, `receipts.py` (PDF) | DonationCampaign, PaymentIntent, Donation, LedgerEntry, PaymentWebhookLog, RecurringDonation | user / admin; Idempotency-Key on writes | **ZarinPal/IDPay gateways** (owner keys in settings) | test_finance_phase15.py, test_phase17_webhook_replay.py | **Works** (live gateway needs owner keys) |
| Projects / PMS + staff | `/projects/*`, `/staff/*` (17) | `projects/` module | Project, Task, StaffMember | staff roles | — | test_pms_phase16.py, test_me_notifications_phase16.py | **Works** |
| Offline sync engine | `/sync/*` (7) | `sync/` module | DeviceCursor, SyncOperation, SyncTombstone, ConflictRecord, SyncChangeLog, WebPushSubscription | user + device | WebPush VAPID | test_sync_phase13.py, test_phase17_sync_conflicts.py | **Works** |
| Meta (settings/public, health) | `/api/v1` meta router (3) + `/health` | `meta/router.py` | PlatformSetting | public subset | — | test_settings_polish.py | **Works** |
| Domain events / outbox / audit | internal | `core/dispatcher.py`, `core/events.py`, `core/audit.py` | DomainEvent, AuditLog | internal | Redis | test_infra_track_b.py | **Works** |
| Storage abstraction | internal | `core/storage.py` (local + S3 providers) | MediaAsset | internal | MinIO/S3 | test_remediation2_track1_storage.py | **Works** |

## B. CRM pages (apps/crm/src/pages → src/App.tsx routes)

All pages delegate data to `src/lib/*` hooks/services (ADR-001). Direct evidence per page = its lib module.

| Page / route | Backing lib → API | Status |
|---|---|---|
| Login `/login` | `lib/auth.tsx` → `/auth/login` (TOTP 2nd step) | **Works** for enrolled users; **dead end for unenrolled admins** (F-01) |
| Dashboard `/` | `lib/events` (WS feed), `lib/ops14` | **Works** |
| Events `/events` | `lib/events` → WS + `/admin/notifications` log | **Works** |
| ContentControl `/content` | `lib/contentApi` → `/admin/content/*` + managers/ (GrapesJS editor) | **Works** |
| — (orphan) `Content.tsx` | not routed, imported nowhere | **Dead code** (F-16) |
| Fatwa `/fatwa` | `lib` fatwa modules → `/admin/fatwa/*` | **Works** |
| FatwaSubmissions `/fatwa-submissions` | → `/fatwa/submissions/*` | **Works** |
| Clusters `/clusters` | → clusters router | **Works** |
| Calculators `/calculators` | `lib/calculators.ts` → `/admin/calculators/*` | **Works** (rule data stays draft until scholar-approved) |
| Finance `/finance` | `lib/events`, `lib/ops14` → `/admin/finance/*` | **Works** |
| Moderation `/moderation` | `lib/moderation.ts` → `/moderation/*`, `/admin/social/*` | **Works** |
| User360 `/users` | `lib/admin14Hooks` → `/admin/users/*` | **Works** |
| Notifications `/notifications` | `lib/admin14` + `admin14Hooks` → `/admin/notifications/*` | **Works** |
| MyNotifications `/my-notifications` | → `/admin/notifications` inbox | **Works** |
| Roles `/roles` | → `/admin/roles/*` | **Works** (page-level permission display limited by F-07) |
| LMS `/lms` | → `/admin/lms/*` | **Works** |
| MediaManager `/media` | → `/admin/library/*`, `/admin/content` media | **Works** (picker copy stale, F-17) |
| Quran `/quran` | `lib/quran.ts` → `/admin/content` quran tools | **Works** |
| Telegram `/telegram` | `lib/telegram.ts` → `/telegram/*` | **Partial** — needs owner's Telegram account/bot connected |
| Places `/places` | `lib/places.ts` → `/admin/places/*` | **Works** |
| Voice `/voice` | `lib/voice.ts` → `/admin/voice/*` | **Partial** — usage/admin real; engines external (see API voice) |
| Projects `/projects` | `lib/projects16.ts` → `/projects/*` | **Works** |
| Staff `/staff` | `lib/projects16.ts`, `admin14Hooks` → `/staff/*` | **Works** |
| Sync `/sync` | `lib/sync.ts` → `/sync/*` (`sync.manage`) | **Works** |
| ApiKeys `/api-keys` | `lib/apikeys.ts` → `/api-keys/*` | **Works** (widget preview block at ApiKeys.tsx:303 is a labeled static demo rendering) |
| Connections `/connections` | `lib/ops14` → `/admin/connections/*` | **Works** (fallback copy stale, F-17) |
| Builds `/builds` | `lib/ops14` → `/admin/builds/*` | **UI-only flow** (F-05) |
| Analytics `/analytics` | `lib/ops14` (`bi.metabase_url` setting) → external Metabase iframe | **Partial** — shell only until Metabase deployed (7 dashboards defined in `infra/metabase/seed-dashboards.md`) |
| Settings `/settings` | `lib` settings → `/admin` platform settings (AI/Telegram/Payments/Comms sections) | **Works** — but **no Security/MFA section** (F-01) |
| Appearance `/appearance` | → `/admin` themes/settings | **Works** |
| Branding `/branding` | → `/admin` settings + fonts upload | **Works** |
| **MFA / Security page** | — | **Missing** (F-01) |

## C. Web pages (apps/web/app/[locale])

All routes are `page.tsx` under `app/[locale]`; data via `lib/*` server/client service modules; API failure → error/empty states (no fabricated content, sampled: home, quran, donate, learn).

| Route | Backing | Status |
|---|---|---|
| `/` (home) | `/home/sections`, banners, announcements | **Works** |
| `/quran`, `/quran/[surah]` | `/quran/*` (alquran.cloud via API) | **Works** |
| `/adhan`, `/tasbih` | `/adhan/*`, `/tasbih/*` | **Works** |
| `/fatwa`, `/fatwa/question`, `/fatwa/compare/[topicId]`, `/scholar/submit-fatwa` | `/fatwa/*` | **Partial** — answers need Claude key (else honest `llm_unavailable`) |
| `/quiz` | fatwa/content quiz endpoints | **Works** |
| `/learn`, `/learn/courses/[id]`, `/learn/lessons/[lessonId]`, `/learn/certificate/[code]` | `/lms/*`, `/certificates/*` | **Works** |
| `/library`, `/library/[id]` | `/library/*` (PDF/audio/video viewers) | **Works** |
| `/community`, `/community/[groupId]`, `/community/post/[id]`, `/feed` | `/social/*` via `lib/social.ts` | **Works** — env-gated fixture demo mode ships in bundle (F-15) |
| `/guidelines` | CMS page; demo fallback only under demo flag | **Works** |
| `/places`, `/places/[id]` | `/places/*` | **Works** |
| `/donate`, `/donate/[campaignId]`, `/donate/result` | `/finance/*` | **Partial** — live payment needs owner gateway keys |
| `/inheritance`, `/zakat` | `/calculators/*` | **Partial** — public calc gated until scholar-approved rule configs publish |
| `/voice` | `/voice/*` + `app/api/voice/ask` route handler | **Partial** — STT/TTS engines external |
| `/search` | `app/api/search/route.ts` → `/api/v1/search` | **Works** |
| `/verify` | `/verify/*` (certificate/fatwa verification) | **Works** |
| `/login` | `/auth/*` (web user login) | **Works** |
| `/pages/[slug]`, `/terms`, `/privacy` | CMS legal pages (seeded fa/ar/en) | **Works** |
| `/offline`, `/offline-settings` | Phase-13 sync client (`lib/offline-db.ts`, `sync-runner.ts`) | **Works** |
| `/demo/lms`, `/demo/sections` | `lib/demo-fixtures.ts` | **UI-only by design** — dev showcase, 404 in production builds (F-15) |
| Route handlers `app/api/search`, `app/api/voice/ask` | server-side proxies | **Works** — and they block static export (F-06) |

## D. Mobile (apps/mobile)

| Feature | Evidence | Status |
|---|---|---|
| App shell + navigation | `src/App.tsx`, `src/navigation/RootNavigator.tsx` | **Works** (dev/Expo) |
| Screens: Home, Quran, Adhan, Tasbih, Fatwa, Library, LMS, Social, Auth, Settings (+hooks `src/hooks/*`, services `src/services/*`) | API-backed via `src/lib/api.ts` + config resolution `src/lib/config.ts` | **Works** in dev; release builds risk localhost API (F-09) |
| Offline DB + sync | `src/lib/db.ts` (expo-sqlite), `src/lib/sync.ts` → `/sync/*` | **Works** |
| Push notifications | `src/services/push.ts`, expo-notifications; needs EAS project ID for tokens | **Partial** — `extra.easProjectId: ""` (F-04) |
| Branding assets (icon/adaptive/splash/notification) | referenced in `app.json`; **no `assets/` dir on disk** | **Missing** (F-03) |
| EAS cloud builds | `.github/workflows/mobile.yml`; **no `eas.json`** | **Missing** (F-04) |

## E. Desktop (apps/desktop)

| Feature | Evidence | Status |
|---|---|---|
| Tauri 2 shell (window, tray, notification plugin) | `src-tauri/src/main.rs`, `capabilities/default.json`, Cargo.toml | **Partial** — code exists; never built |
| Production bundle | README + `tauri.conf.json` `frontendDist: ../web/out` | **Missing** — web produces no static export (F-06a) |
| Bundle/tray icon | `src-tauri/icons/` = only `.gitkeep` | **Missing** (F-06b) |
| Updater | `tauri.conf.json` updater block `active: false`, placeholder endpoint | **Missing (honestly disabled)** |
| CI builds | `.github/workflows/desktop.yml` (3-OS matrix) | **UI-only** — cannot succeed until F-06 is resolved |
| Config hygiene | duplicate stale `apps/desktop/tauri.conf.json` | **Debt** (F-12) |

## F. Workers & infrastructure

| Item | Evidence | Status |
|---|---|---|
| ARQ queues: critical / ai / media / telegram / notifications / analytics | `apps/api/app/core/queues.py`, `app/worker.py`; prod compose runs all six as separate services | **Works** |
| Outbox dispatcher + dead-letter | `app/core/dispatcher.py`, DomainEvent model | **Works** |
| Dev compose | postgres/redis/minio/api + prometheus/grafana/loki | **Works** |
| Prod compose | + migrate init-job, 6 workers, web, crm, metabase(-db), monitoring | **Works** (as definitions; live-infra run is an ops task, out of audit scope) |
| Metabase BI | `infra/metabase/docker-compose.metabase.yml`, `seed-dashboards.md` (7 dashboards) | **Partial** — definitions only; instance not provisioned by repo |
| Monitoring configs | `infra/monitoring/prometheus.yml`; Grafana/Loki via compose | **Partial** — config-level |
| Backup script | `infra/backup.sh`; DR policy in `docs/ops/disaster-recovery.md` (RPO 24h / RTO 4h) | **Works** (as script/policy) |
| Load test | `tests/load/k6-smoke.js` | **Works** (smoke-level) |
| CI (ci.yml) | 4 jobs, blocking scans, ruff ratchet 160, migration check | **Works** — except mypy non-blocking (F-10) |
| Mobile/Desktop workflows | mobile.yml / desktop.yml | **UI-only** until F-03/F-04/F-06 close |
