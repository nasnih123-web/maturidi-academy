# Phase 5 web ↔ API contract (Track 2 notes for Track 1)

> Track 2 (web) built against `apps/api/app/modules/quran/{router,schemas,service}.py`
> as found in the working tree on 2026-10-19. This file records the exact
> assumptions the web makes, so the backend track can verify them.

## Endpoints consumed (all under `/api/v1`)

| Web call | Backend endpoint | Shape assumed |
|---|---|---|
| `getSurahs()` | `GET /quran/surahs` | `{ items: [{ number, name_ar, name_en, ayahs, revelation }], total }` |
| `getSurah(n, …)` | `GET /quran/surah/{n}?translation=&tafsir=` | `{ surah, name_ar, name_en, ayahs: [{ surah, ayah, editions: [{ edition, text, audio_url, juz, page }] }], edition_ids }` |
| `getQuranProviders()` | `GET /quran/providers` | `{ translations[], tafsirs[], reciters[], show_translation, show_tafsir, highlight_mode, font_size, text_edition }` — web uses `translations[0]` / `tafsirs[0]` / `reciters[0]` as defaults; `?translation=` / `?tafsir=` override per request |
| notes CRUD | `POST /quran/notes { surah, ayah, note_text, is_private }` → NoteOut; `GET /quran/notes?surah=&ayah=` → `{ items }`; `PUT /quran/notes/{id}`; `DELETE /quran/notes/{id}` | `NoteOut: { id, surah, ayah, note_text, is_private, created_at }` |
| tasbih | `POST /tasbih/sessions { dhikr_text, target_count? }` → `{ id, … }`; `POST /tasbih/sessions/{id}/count { amount, idempotency_key }`; `GET /tasbih/today` → `{ date, totals: [{ dhikr_text, total_count }] }` | auth required on all three |
| adhan | `GET /adhan/times?lat=&lng=&method=&madhab=&tz=` | `{ date, latitude, longitude, timezone_offset, method, method_label, madhab, times: { imsak, fajr, sunrise, dhuhr, asr, maghrib, isha, midnight } }` — web always sends `tz` (browser UTC offset, e.g. `3.5`) |

## Settings keys read (via `GET /api/v1/settings/public`, non-throwing defaults)

- `quran.translations`, `quran.tafsirs`, `quran.reciters` (lists — first item is the default)
- `quran.show_translation` (bool, default true), `quran.show_tafsir` (bool, default false)
- `quran.highlight_mode` (`"ayah"` | `"word"`, default `"ayah"`)
- `munajat.enabled` (bool), `munajat.window` (`{start:"02:00", end:"05:00"}` local-time)
- `adhan.method` (`isna|mwl|egypt|karachi|makkah|jafari`, default `mwl`),
  `adhan.madhab` (`shafi|hanafi`, default `hanafi`)

## Display-config precedence (surah page)

`GET /quran/providers` wins; `quran.*` settings are the fallback when the
providers endpoint is unreachable. `?translation=` / `?tafsir=` query params
override per request.

## Gap found (Track 1 follow-up suggested, NOT blocking)

The web's reciter selector passes `?reciter=<edition-id>` on the surah
request (values from `quran.reciters`), but the backend currently ignores
per-request reciter and always uses `reciters[0]`. The UI is wired for the
param; the 3-line backend change is: accept `reciter: str | None` on
`GET /quran/surah/{n}` and prefer it over `reciters[0]` in `_edition_selection`.

## Auth (web)

Web login page `POST /api/v1/auth/login { identifier, password, totp_code? }`
stores the pair in localStorage; `authFetch` injects `Authorization: Bearer`
and rotates once via `POST /api/v1/auth/refresh` on 401.
