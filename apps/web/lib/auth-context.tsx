"use client";

/**
 * AuthProvider — presentation glue only (ADR-001: no business logic here).
 * Token lifecycle lives in lib/auth-client.ts; this module only mirrors
 * "logged in / logged out" into React state for components.
 */
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  emitAuthChange,
  isLoggedIn,
  login as doLogin,
  logout as doLogout,
} from './auth-client';

interface AuthState {
  loggedIn: boolean;
  /** Sign in; resolves true on success. Throws the API error message on failure. */
  login: (identifier: string, password: string, totpCode?: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  loggedIn: false,
  login: async () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    setLoggedIn(isLoggedIn());
    const onChange = () => setLoggedIn(isLoggedIn());
    window.addEventListener('ma:auth-change', onChange);
    window.addEventListener('storage', onChange);
    return () => {
      window.removeEventListener('ma:auth-change', onChange);
      window.removeEventListener('storage', onChange);
    };
  }, []);

  const login = useCallback(async (identifier: string, password: string, totpCode?: string) => {
    await doLogin(identifier, password, totpCode);
    setLoggedIn(true);
    emitAuthChange();
  }, []);

  const logout = useCallback(async () => {
    await doLogout();
    setLoggedIn(false);
    emitAuthChange();
  }, []);

  return <AuthContext.Provider value={{ loggedIn, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
