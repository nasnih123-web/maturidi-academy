import React from "react";
import {
  ApiError,
  TokenPair,
  apiFetch,
  clearTokens,
  getAccessToken,
  setTokens,
} from "./api";

/** Backend shape: POST /api/v1/auth/login {identifier, password, totp_code?} */
interface LoginRequest {
  identifier: string;
  password: string;
  totp_code?: string;
}

/** GET /api/v1/users/me → UserOut (Phase 1 + Phase 2 RBAC fields). */
export interface AuthUser {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  locale: string;
  is_active: boolean;
  is_verified: boolean;
  /** Real role names from user_roles (contract §2, exposed by the API in Phase 2). */
  roles: string[];
  /** Real permission keys from role_permissions (contract §2, Phase 2). */
  permissions: string[];
}

/** Thrown by login() when the backend demands a TOTP code (error code requires_2fa, contract §2). */
export class Needs2FAError extends Error {
  constructor() {
    super("requires_2fa");
    this.name = "Needs2FAError";
  }
}

function isEnrollmentError(err: unknown): boolean {
  return err instanceof ApiError && err.code === "requires_2fa";
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  /** True while the session holds a restricted `2fa_setup`-scope token:
   *  the operator must complete TOTP enrollment before anything else. */
  mustEnroll2fa: boolean;
  login: (identifier: string, password: string, totpCode?: string) => Promise<void>;
  logout: () => Promise<void>;
  /** After successful enrollment: rotate to a full-scope pair and load /me. */
  completeEnrollment: () => Promise<void>;
  /** Re-sync session state with the server (e.g. after 2FA disable, when a
   *  privileged operator falls back into mandatory enrollment). */
  recheckSession: () => Promise<void>;
  hasPermission: (key: string) => boolean;
  isSuperAdmin: boolean;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

async function fetchMe(): Promise<AuthUser> {
  const raw = await apiFetch<AuthUser>("/api/v1/users/me");
  return {
    ...raw,
    roles: Array.isArray(raw.roles) ? raw.roles : [],
    permissions: Array.isArray(raw.permissions) ? raw.permissions : [],
  };
}

export function AuthProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const [user, setUser] = React.useState<AuthUser | null>(null);
  const [mustEnroll2fa, setMustEnroll2fa] = React.useState(false);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    if (!getAccessToken()) {
      setLoading(false);
      return;
    }
    fetchMe()
      .then(setUser)
      .catch((err: unknown) => {
        if (isEnrollmentError(err)) {
          // Restricted enrollment token — keep it; App routes to the
          // Security page where the 2FA flow endpoints are reachable.
          setMustEnroll2fa(true);
          setUser(null);
        } else {
          clearTokens();
          setUser(null);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const login = React.useCallback(
    async (identifier: string, password: string, totpCode?: string) => {
      const payload: LoginRequest = { identifier, password };
      if (totpCode) payload.totp_code = totpCode;
      let pair: TokenPair;
      try {
        pair = await apiFetch<TokenPair>("/api/v1/auth/login", {
          method: "POST",
          body: payload,
          noAutoRefresh: true,
        });
      } catch (err) {
        if (err instanceof ApiError && err.code === "requires_2fa") {
          throw new Needs2FAError();
        }
        throw err;
      }
      setTokens(pair);
      if (pair.must_enroll_2fa) {
        // Restricted-scope pair: /users/me would 403 by design. The only
        // way forward is the enrollment flow on the Security page.
        setMustEnroll2fa(true);
        setUser(null);
        return;
      }
      try {
        setUser(await fetchMe());
      } catch (err) {
        if (isEnrollmentError(err)) {
          setMustEnroll2fa(true);
          setUser(null);
          return;
        }
        throw err;
      }
    },
    [],
  );

  const completeEnrollment = React.useCallback(async () => {
    const refresh = localStorage.getItem("crm.refresh_token");
    if (refresh) {
      const pair = await apiFetch<TokenPair>("/api/v1/auth/refresh", {
        method: "POST",
        body: { refresh_token: refresh },
        noAutoRefresh: true,
      });
      setTokens(pair);
    }
    setMustEnroll2fa(false);
    setUser(await fetchMe());
  }, []);

  const recheckSession = React.useCallback(async () => {
    try {
      setUser(await fetchMe());
      setMustEnroll2fa(false);
    } catch (err) {
      if (isEnrollmentError(err)) {
        setUser(null);
        setMustEnroll2fa(true);
      }
      // Other errors (network etc.) leave the current state untouched.
    }
  }, []);

  const logout = React.useCallback(async () => {
    // Best effort: revoke the server-side session, then drop local tokens regardless.
    try {
      const refresh = localStorage.getItem("crm.refresh_token");
      await apiFetch("/api/v1/auth/logout", {
        method: "POST",
        body: { refresh_token: refresh },
        noAutoRefresh: true,
      });
    } catch {
      // ignore — local logout still proceeds
    }
    clearTokens();
    setUser(null);
    setMustEnroll2fa(false);
  }, []);

  const hasPermission = React.useCallback(
    (key: string): boolean => {
      // Real RBAC gating (Phase 2): the API exposes the operator's actual
      // permission keys on /users/me; the server remains the enforcer.
      return user?.permissions.includes(key) ?? false;
    },
    [user],
  );

  const isSuperAdmin = user?.roles.includes("super_admin") ?? false;

  const value = React.useMemo(
    () => ({
      user,
      loading,
      mustEnroll2fa,
      login,
      logout,
      completeEnrollment,
      recheckSession,
      hasPermission,
      isSuperAdmin,
    }),
    [
      user,
      loading,
      mustEnroll2fa,
      login,
      logout,
      completeEnrollment,
      recheckSession,
      hasPermission,
      isSuperAdmin,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
