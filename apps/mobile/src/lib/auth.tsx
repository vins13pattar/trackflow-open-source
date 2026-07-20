import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getToken, type PublicUser, setToken } from './api';

interface AuthState {
  user: PublicUser | null;
  ready: boolean;
  signedIn: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    getToken()
      .then((t) => setSignedIn(!!t))
      .finally(() => setReady(true));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.login(email, password);
    await setToken(res.tokens.accessToken);
    setUser(res.user);
    setSignedIn(true);
  }, []);

  const logout = useCallback(async () => {
    await setToken(null);
    setUser(null);
    setSignedIn(false);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, ready, signedIn, login, logout }),
    [user, ready, signedIn, login, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
