'use client';

import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { USER_KEY, api, clearSession, setToken } from './api';
import type { PublicUser } from './types';

interface AuthState {
  user: PublicUser | null;
  ready: boolean;
  /** Resolves with an MFA challenge when the account has 2FA enabled —
   *  complete it with verifyMfa. Resolves undefined on a plain sign-in. */
  login: (email: string, password: string) => Promise<{ mfaToken: string } | undefined>;
  verifyMfa: (mfaToken: string, code: string) => Promise<void>;
  register: (input: { email: string; password: string; name: string; tenantName: string }) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<PublicUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(USER_KEY);
      if (raw) setUser(JSON.parse(raw) as PublicUser);
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);

  const persist = useCallback((u: PublicUser, accessToken: string) => {
    setToken(accessToken);
    window.localStorage.setItem(USER_KEY, JSON.stringify(u));
    setUser(u);
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api.login({ email, password });
      if ('mfaRequired' in res) return { mfaToken: res.mfaToken };
      persist(res.user, res.tokens.accessToken);
      return undefined;
    },
    [persist],
  );

  const verifyMfa = useCallback(
    async (mfaToken: string, code: string) => {
      const res = await api.verifyMfa({ mfaToken, code });
      persist(res.user, res.tokens.accessToken);
    },
    [persist],
  );

  const register = useCallback(
    async (input: { email: string; password: string; name: string; tenantName: string }) => {
      const res = await api.register(input);
      persist(res.user, res.tokens.accessToken);
    },
    [persist],
  );

  const logout = useCallback(() => {
    clearSession();
    setUser(null);
    router.push('/login');
  }, [router]);

  const value = useMemo<AuthState>(
    () => ({ user, ready, login, verifyMfa, register, logout }),
    [user, ready, login, verifyMfa, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
