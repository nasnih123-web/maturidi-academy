/**
 * apps/web — lib/api-base.ts
 *
 * تنها نقطهٔ مرجع آدرس عمومی API برای کد مرورگر (Track 2 / §۱۳).
 *
 * - مقدار از NEXT_PUBLIC_API_URL می‌آید (در زمان build داخل باندل bake می‌شود).
 * - در dev به http://localhost:8000 fallback می‌کند.
 * - در باندل production بدون مقدار صریح، بلند خطا می‌دهد — هرگز fallback
 *   خاموش به localhost (بیلد production بدون این متغیر از قبل در
 *   next.config.mjs فیل می‌کند؛ این دفاع دوم است).
 *
 * تفکیک SSR/مرورگر: این هلپر فقط برای کد کلاینت است. کد سمت‌سرور
 * (route handlerها و server componentها) از lib/api.ts استفاده می‌کند که
 * متغیر سروری API_URL را می‌خواند (در رانتایم، نه build).
 */
export function apiBaseUrl(): string {
  const base =
    typeof process !== "undefined"
      ? process.env.NEXT_PUBLIC_API_URL
      : undefined;
  if (base) return base.replace(/\/+$/, "");
  if (typeof process !== "undefined" && process.env.NODE_ENV === "production") {
    throw new Error(
      "[web] NEXT_PUBLIC_API_URL is not set in this production bundle — " +
        "refusing to silently fall back to http://localhost:8000."
    );
  }
  return "http://localhost:8000";
}
