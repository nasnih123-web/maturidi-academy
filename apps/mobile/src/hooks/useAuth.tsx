/**
 * apps/mobile — src/hooks/useAuth.tsx
 *
 * Auth state for the whole app. Owns: session restore on launch, login,
 * register, logout. Screens read `user` / `status` and call the actions —
 * all token mechanics live in services/auth.ts + lib/secureStore.ts.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ApiError, hasStoredSession } from "../lib/api";
import { currentUser, login as svcLogin, logout as svcLogout, register as svcRegister } from "../services/auth";
import type { LoginInput, RegisterInput } from "../services/auth";
import type { Locale, UserMe } from "../types";

export type AuthStatus = "loading" | "signed-in" | "signed-out";

interface AuthContextValue {
  status: AuthStatus;
  user: UserMe | null;
  /** Localised error key from the last failed action (null when clean). */
  error: string | null;
  busy: boolean;
  login: (input: LoginInput) => Promise<boolean>;
  register: (input: RegisterInput) => Promise<boolean>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<UserMe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshUser = useCallback(async () => {
    try {
      const me = await currentUser();
      setUser(me);
      setStatus("signed-in");
    } catch (e) {
      if (e instanceof ApiError && (e.code === "unauthorized" || e.code === "network_error")) {
        setUser(null);
        setStatus(e.code === "unauthorized" ? "signed-out" : "signed-out");
      } else {
        throw e;
      }
    }
  }, []);

  useEffect(() => {
    (async () => {
      const has = await hasStoredSession();
      if (!has) {
        setStatus("signed-out");
        return;
      }
      try {
        await refreshUser();
      } catch {
        setStatus("signed-out");
      }
    })();
  }, [refreshUser]);

  const login = useCallback(async (input: LoginInput): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const { user: me } = await svcLogin(input);
      setUser(me);
      setStatus("signed-in");
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? e.code : "unknown");
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const register = useCallback(async (input: RegisterInput): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const me = await svcRegister(input);
      setUser(me);
      setStatus("signed-in");
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? e.code : "unknown");
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const logout = useCallback(async () => {
    setBusy(true);
    try {
      await svcLogout();
    } finally {
      setUser(null);
      setStatus("signed-out");
      setBusy(false);
    }
  }, []);

  const value = useMemo(
    () => ({ status, user, error, busy, login, register, logout, refreshUser }),
    [status, user, error, busy, login, register, logout, refreshUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

/** Resolve the effective UI locale: user profile → stored setting → fa. */
export function useEffectiveLocale(): Locale {
  const { user } = useAuth();
  const [stored, setStored] = useState<Locale | null>(null);
  useEffect(() => {
    let alive = true;
    import("../services/settings").then(({ getLocale }) =>
      getLocale().then((l) => {
        if (alive) setStored(l);
      }),
    );
    return () => {
      alive = false;
    };
  }, [user?.locale]);
  if (user?.locale === "ar" || user?.locale === "en" || user?.locale === "fa") return user.locale;
  return stored ?? "fa";
}
