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

/** GET /api/v1/users/me → UserOut (Phase 1). Roles come via user_roles later. */
export interface AuthUser {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  locale: string;
  is_active: boolean;
  is_verified: boolean;
  /** STUB: backend does not expose roles on /users/me yet (RBAC via user_roles, contract §2).
   *  Present when the API starts returning them; gates below fall back to permissive. */
  roles?: string[];
}

/** Thrown by login() when the backend demands a TOTP code (error code requires_2fa, contract §2). */
export class Needs2FAError extends Error {
  constructor() {
    super("requires_2fa");
    this.name = "Needs2FAError";
  }
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (identifier: string, password: string, totpCode?: string) => Promise<void>;
  logout: () => Promise<void>;
  /** STUB: full RBAC UI lands in a later phase; currently reads /users/me only. */
  hasPermission: (key: string) => boolean;
  isSuperAdmin: boolean;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

async function fetchMe(): Promise<AuthUser> {
  return apiFetch<AuthUser>("/api/v1/users/me");
}

export function AuthProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const [user, setUser] = React.useState<AuthUser | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    if (!getAccessToken()) {
      setLoading(false);
      return;
    }
    fetchMe()
      .then(setUser)
      .catch(() => {
        clearTokens();
        setUser(null);
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
      setUser(await fetchMe());
    },
    [],
  );

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
  }, []);

  const hasPermission = React.useCallback((_key: string): boolean => {
    // STUB — contract §2 RBAC (role_permissions) UI arrives in a later phase.
    // Until the API exposes permissions on /users/me, the shell is permissive
    // for any authenticated operator; sensitive pages additionally check isSuperAdmin.
    void _key;
    return user !== null;
  }, [user]);

  // STUB — falls back to permissive until roles are exposed by the backend.
  const isSuperAdmin = user?.roles ? user.roles.includes("super_admin") : user !== null;

  const value = React.useMemo(
    () => ({ user, loading, login, logout, hasPermission, isSuperAdmin }),
    [user, loading, login, logout, hasPermission, isSuperAdmin],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
