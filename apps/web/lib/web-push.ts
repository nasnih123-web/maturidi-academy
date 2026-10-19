/**
 * web-push.ts — VAPID web-push subscription flow (Phase 13).
 *
 * Separate from FCM/mobile push: this is the browser Push API path.
 * Backend contract (Phase 13):
 *   GET  /api/v1/notifications/web-push/vapid-key  → {vapid_public_key}
 *   POST /api/v1/notifications/web-push/subscribe  ← {endpoint, keys:{p256dh,auth},
 *                                                     user_agent, locale}
 *                                                  → {subscription_id}
 *   DELETE /api/v1/notifications/web-push/subscribe ← {endpoint}  (best effort)
 *
 * `notification_preferences` (Phase 1) are honored SERVER-side when
 * dispatching: subscribing here never opts the user into notification types
 * they disabled. Dead endpoints are pruned by the backend on 410 Gone —
 * this client does not invent retry semantics for them.
 */

const API_BASE =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_URL) || "http://localhost:8000";

const ACCESS_KEY = "ma.access_token";

export type PushState = "unsupported" | "denied" | "subscribed" | "unsubscribed" | "error";

function authHeader(): Record<string, string> {
  try {
    const token = window.localStorage.getItem(ACCESS_KEY);
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = window.atob(base64.replace(/-/g, "+").replace(/_/g, "/") + padding);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function getVapidPublicKey(): Promise<string> {
  const res = await fetch(`${API_BASE}/api/v1/notifications/web-push/vapid-key`, {
    headers: authHeader(),
  });
  if (!res.ok) throw new Error(`vapid-key HTTP ${res.status}`);
  const body = (await res.json()) as { vapid_public_key?: string };
  if (!body.vapid_public_key) throw new Error("vapid-key missing in response");
  return body.vapid_public_key;
}

/** Current subscription state — real browser state, never fabricated. */
export async function getPushState(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return sub ? "subscribed" : "unsubscribed";
  } catch {
    return "error";
  }
}

/**
 * Full subscribe flow: permission → PushManager.subscribe → server register.
 * Throws with a human-readable message on failure.
 */
export async function subscribeWebPush(locale: string): Promise<string> {
  if (!pushSupported()) throw new Error("push unsupported in this browser");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error(`notification permission ${permission}`);
  const vapidKey = await getVapidPublicKey();
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidKey),
  });
  const json = sub.toJSON();
  const res = await fetch(`${API_BASE}/api/v1/notifications/web-push/subscribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
      user_agent: navigator.userAgent,
      locale,
    }),
  });
  if (!res.ok) {
    // Roll back the local subscription — don't leave a dangling endpoint.
    await sub.unsubscribe().catch(() => undefined);
    throw new Error(`subscribe HTTP ${res.status}`);
  }
  const body = (await res.json()) as { subscription_id?: string };
  return body.subscription_id ?? "";
}

/** Unsubscribe locally + best-effort server deregistration. */
export async function unsubscribeWebPush(): Promise<void> {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  try {
    await fetch(`${API_BASE}/api/v1/notifications/web-push/subscribe`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({ endpoint }),
    });
  } catch {
    /* best effort — backend prunes dead endpoints on 410 */
  }
}
