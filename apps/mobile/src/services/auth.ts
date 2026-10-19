/**
 * apps/mobile — src/services/auth.ts
 *
 * Authentication orchestration against /api/v1/auth/*:
 * login (identifier + password + optional TOTP), register, logout,
 * logout-all and fetching the current user. Token persistence is owned by
 * lib/secureStore (OS keychain/keystore) — never AsyncStorage.
 *
 * Services hold the *how*; screens/hooks decide the *when* (ADR-001).
 */
import { api } from "../lib/api";
import { clearTokens, saveTokens } from "../lib/secureStore";
import type { TokenPair, UserMe } from "../types";

export interface LoginInput {
  identifier: string;
  password: string;
  totpCode?: string;
}

export interface RegisterInput {
  fullName: string;
  email?: string;
  phone?: string;
  password: string;
  locale?: string;
}

export async function login(input: LoginInput): Promise<{ user: UserMe; mustEnroll2fa: boolean }> {
  const pair = await api.post<TokenPair>(
    "/api/v1/auth/login",
    {
      identifier: input.identifier.trim(),
      password: input.password,
      ...(input.totpCode ? { totp_code: input.totpCode.trim() } : {}),
    },
    { auth: false },
  );
  await saveTokens(pair.access_token, pair.refresh_token);
  const user = await api.get<UserMe>("/api/v1/users/me");
  return { user, mustEnroll2fa: pair.must_enroll_2fa === true };
}

export async function register(input: RegisterInput): Promise<UserMe> {
  await api.post(
    "/api/v1/auth/register",
    {
      full_name: input.fullName.trim(),
      ...(input.email ? { email: input.email.trim() } : {}),
      ...(input.phone ? { phone: input.phone.trim() } : {}),
      password: input.password,
      locale: input.locale ?? "fa",
      accept_terms: true,
    },
    { auth: false },
  );
  // The backend signs the user in as part of registration when it returns
  // tokens; otherwise fall back to an explicit login.
  const pair = await api
    .post<TokenPair>(
      "/api/v1/auth/login",
      {
        identifier: (input.email ?? input.phone ?? "").trim(),
        password: input.password,
      },
      { auth: false },
    )
    .catch(() => null);
  if (pair) await saveTokens(pair.access_token, pair.refresh_token);
  return api.get<UserMe>("/api/v1/users/me");
}

export async function logout(): Promise<void> {
  try {
    await api.post("/api/v1/auth/logout", {});
  } catch {
    // Logout is best-effort: local tokens are cleared regardless so a
    // dead network cannot trap the user in a signed-in state.
  } finally {
    await clearTokens();
  }
}

export async function logoutAllDevices(): Promise<void> {
  await api.post("/api/v1/auth/logout-all", {});
  await clearTokens();
}

export async function currentUser(): Promise<UserMe> {
  return api.get<UserMe>("/api/v1/users/me");
}
