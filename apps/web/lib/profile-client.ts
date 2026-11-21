'use client';

/**
 * Profile + account-security client (Phase B).
 *
 * Thin typed wrappers over the existing API surface:
 * - GET/PATCH /api/v1/users/me — the Phase B fields (profile_complete,
 *   missing_profile_fields, profile_required_sections) come from the
 *   backend; the client never recomputes completeness.
 * - POST /api/v1/users/me/avatar — multipart avatar upload; the
 *   response is the updated profile.
 * - /api/v1/auth/2fa/* — the pre-existing TOTP endpoints, mirrored
 *   exactly (setup → enable with the pending secret + code; disable and
 *   recovery regeneration require re-authentication).
 *
 * Profile completeness is defined server-side over five fields
 * (full_name, avatar_media_id, date_of_birth, gender, country_code).
 * The country is a stored column; when the user has a verified phone,
 * the API requires it to equal the phone's country, so the UI
 * preselects and locks it to the dial-code-derived country.
 */
import { useEffect, useState } from 'react';
import { authFetch, authJson, isLoggedIn } from './auth-client';
import { COUNTRIES } from './countries';
import type { Bookmark } from './quran-bookmarks';
import type { LocalizedText } from './types';

export interface MeProfile {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  locale: string;
  is_verified: boolean;
  avatar_media_id: string | null;
  date_of_birth: string | null;
  gender: string | null;
  country_code: string | null;
  profile_complete: boolean;
  missing_profile_fields: string[];
  profile_required_sections: string[];
  created_at: string;
}

export async function fetchMe(): Promise<MeProfile> {
  return authJson<MeProfile>('/api/v1/users/me');
}

export interface MySession {
  id: string;
  device_info: string | null;
  ip: string | null;
  last_active_at: string;
  revoked: boolean;
  created_at: string;
}

export async function fetchMySessions(): Promise<MySession[]> {
  return authJson<MySession[]>('/api/v1/users/me/sessions');
}

export async function revokeMySession(id: string): Promise<void> {
  await authJson(`/api/v1/users/me/sessions/${id}`, { method: 'DELETE' });
}

export async function updateMe(patch: {
  full_name?: string;
  locale?: string;
  avatar_media_id?: string;
  date_of_birth?: string;
  gender?: string;
  country_code?: string;
  /** E.164 phone; empty string clears the stored number. */
  phone?: string;
}): Promise<MeProfile> {
  return authJson<MeProfile>('/api/v1/users/me', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

/**
 * Upload a new profile picture (multipart). No explicit Content-Type:
 * the browser sets the multipart boundary. Returns the updated profile.
 */
export async function uploadAvatar(file: File): Promise<MeProfile> {
  const form = new FormData();
  form.append('file', file);
  const res = await authFetch('/api/v1/users/me/avatar', {
    method: 'POST',
    body: form,
  });
  return (await res.json()) as MeProfile;
}

/**
 * ISO country for an E.164 phone number, by longest dial-code match
 * against the same table registration uses. Null when unknown.
 */
export function countryIsoFromPhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  let best: { iso: string; len: number } | null = null;
  for (const c of COUNTRIES) {
    if (digits.startsWith(c.dial) && (!best || c.dial.length > best.len)) {
      best = { iso: c.iso, len: c.dial.length };
    }
  }
  return best?.iso ?? null;
}

/* ------------------------------------------------------------------ */
/* 2FA (TOTP) — mirrors the backend contract in modules/auth           */
/* ------------------------------------------------------------------ */

export interface TwoFAStatus {
  enabled: boolean;
  enrolled_at: string | null;
  recovery_codes_remaining: number;
}

export interface TwoFASetup {
  secret: string;
  provisioning_uri: string;
}

export async function fetch2faStatus(): Promise<TwoFAStatus> {
  return authJson<TwoFAStatus>('/api/v1/auth/2fa/status');
}

export async function setup2fa(): Promise<TwoFASetup> {
  return authJson<TwoFASetup>('/api/v1/auth/2fa/setup', { method: 'POST' });
}

export async function enable2fa(secret: string, code: string): Promise<{ recovery_codes: string[] }> {
  return authJson<{ recovery_codes: string[] }>('/api/v1/auth/2fa/enable', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret, code }),
  });
}

export async function disable2fa(payload: {
  password: string;
  code?: string;
  recovery_code?: string;
}): Promise<void> {
  await authJson('/api/v1/auth/2fa/disable', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function regenerateRecoveryCodes(payload: {
  password: string;
  code?: string;
  recovery_code?: string;
}): Promise<{ recovery_codes: string[] }> {
  return authJson<{ recovery_codes: string[] }>('/api/v1/auth/2fa/recovery/regenerate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

/* ------------------------------------------------------------------ */
/* Gate hook                                                           */
/* ------------------------------------------------------------------ */

export type ProfileGateState =
  | { kind: 'open' }
  | { kind: 'blocked'; me: MeProfile }
  | { kind: 'loading' };

/**
 * Section gate for client components (fatwa question box, advanced
 * hifz tabs). `required` comes from the server-rendered public settings
 * (props), completeness from /users/me. Any failure (signed out, fetch
 * error) resolves to "open" — the API guard is the real backstop and
 * the UI must never lock a user out over a failed status fetch.
 */
export function useProfileGate(required: boolean): ProfileGateState {
  const [state, setState] = useState<ProfileGateState>({ kind: 'loading' });

  useEffect(() => {
    if (!required || !isLoggedIn()) {
      setState({ kind: 'open' });
      return;
    }
    let cancelled = false;
    fetchMe()
      .then((me) => {
        if (cancelled) return;
        setState(me.profile_complete ? { kind: 'open' } : { kind: 'blocked', me });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: 'open' });
      });
    return () => {
      cancelled = true;
    };
  }, [required]);

  return state;
}

// ---------------------------------------------------------------------------
// ذخیره‌شده‌ها (تب پروفایل) — ویدیو/درس/صوت از endpoint ذخیرهٔ کتابخانه،
// فتواها از /fatwas/saved و نشان‌های قرآن از reading-state خوانده می‌شوند.
// ---------------------------------------------------------------------------

/** آیتم ذخیره‌شدهٔ کتابخانه — همان شکل VideoItemOut؛ kind هر مقدار
 * کتابخانه‌ای می‌تواند باشد (video|video_360|audio|pdf|mindmap). */
export interface SavedLibraryItem {
  id: string;
  kind: string;
  title: LocalizedText | null;
  cover_url: string | null;
  duration_seconds: number | null;
  scholar_name: string | null;
  published_at: string | null;
  created_at: string;
}

export async function fetchSavedItems(): Promise<SavedLibraryItem[]> {
  const out = await authJson<{ items: SavedLibraryItem[] }>('/api/v1/videos/saved');
  return Array.isArray(out?.items) ? out.items : [];
}

export async function unsaveLibraryItem(id: string): Promise<void> {
  await authJson(`/api/v1/videos/${encodeURIComponent(id)}/saved`, {
    method: 'DELETE',
  });
}

/** فتوای ذخیره‌شده — همان شکل ردیف فهرست عمومی فتوا (PublicTopicOut). */
export interface SavedFatwa {
  id: string;
  title: LocalizedText | null;
  description: LocalizedText | null;
  category: { slug: string; title: LocalizedText | null } | null;
  author_name: string | null;
  featured_image_url: string | null;
  published_at: string | null;
}

export async function fetchSavedFatwas(): Promise<SavedFatwa[]> {
  const out = await authJson<{ items: SavedFatwa[] }>('/api/v1/fatwas/saved');
  return Array.isArray(out?.items) ? out.items : [];
}

export async function unsaveFatwa(id: string): Promise<void> {
  await authJson(`/api/v1/fatwas/${encodeURIComponent(id)}/saved`, {
    method: 'DELETE',
  });
}

/** نشان‌های قرآن کاربر از reading-state حساب (فقط‌خواندنی این‌جا). */
export async function fetchQuranBookmarks(): Promise<Bookmark[]> {
  const out = await authJson<{ bookmarks: Bookmark[] }>(
    '/api/v1/quran/reading-state',
  );
  return Array.isArray(out?.bookmarks) ? out.bookmarks : [];
}
