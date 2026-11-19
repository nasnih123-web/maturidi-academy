/**
 * رهگیری فعالیت کاربر برای خط زمانی نمای ۳۶۰° در CRM.
 *
 * رویدادهای سبک (شروع پخش، پیشرفت پخش، دانلود کتابخانه) به
 * POST /api/v1/activity/events فرستاده می‌شوند — فقط برای کاربر
 * واردشده و کاملاً fire-and-forget: هیچ خطایی نباید پخش یا ناوبری
 * را مختل کند، پس همهٔ فراخوانی‌ها بی‌صدا بلعیده می‌شوند.
 */
import { authFetch, isLoggedIn } from './auth-client';

export type ActivityKind =
  | 'media_play'
  | 'media_progress'
  | 'library_download'
  | 'library_open';

export function reportActivity(
  kind: ActivityKind,
  opts: {
    title?: string;
    refId?: string;
    meta?: Record<string, string | number | boolean>;
  } = {},
): void {
  if (typeof window === 'undefined' || !isLoggedIn()) return;
  void authFetch('/api/v1/activity/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind,
      title: opts.title ?? null,
      ref_type: 'library_item',
      ref_id: opts.refId ?? null,
      meta: opts.meta ?? {},
    }),
  }).catch(() => undefined);
}
