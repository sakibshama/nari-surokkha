import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AuthUser {
  id: string;
  phone: string;
  role: any;
  permissions: string[];
  fullName?: string;
}

interface AuthState {
  user: AuthUser | null;
  /**
   * Short-lived access token. Kept in memory ONLY — never written to
   * localStorage, so an XSS bug cannot lift a bearer token from storage. After
   * a reload it is re-minted from the httpOnly refresh cookie (see
   * refreshAccessToken() in services/api.ts and the bootstrap in App.tsx).
   */
  accessToken: string | null;
  isAuthenticated: boolean;
  login: (user: AuthUser, token: string) => void;
  setAccessToken: (token: string) => void;
  /** Merge fresh user data from the API (e.g. the refresh response). */
  setUser: (user: Partial<AuthUser>) => void;
  logout: () => void;
  hasPermission: (permission: string) => boolean;
}

const normalizeUser = (u: any): AuthUser => ({
  ...u,
  permissions: Array.isArray(u?.permissions) ? u.permissions : [],
  fullName: u?.fullName ?? u?.profile?.fullName ?? undefined,
});

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      isAuthenticated: false,
      login: (user, token) => set({ user: normalizeUser(user), accessToken: token, isAuthenticated: true }),
      setAccessToken: (token) => set({ accessToken: token, isAuthenticated: !!get().user }),
      setUser: (user) => {
        const prev = get().user;
        const merged = normalizeUser({ ...(prev ?? {}), ...user, fullName: (user as any)?.fullName ?? (user as any)?.profile?.fullName ?? prev?.fullName });
        set({ user: merged, isAuthenticated: !!get().accessToken });
      },
      logout: () => set({ user: null, accessToken: null, isAuthenticated: false }),
      // Missing permissions mean NOT allowed. The API now returns
      // `user.permissions` on login and refresh, so there is no "not loaded
      // yet, show everything" state any more.
      hasPermission: (permission) => !!get().user?.permissions?.includes(permission),
    }),
    {
      name: 'admin-auth-storage',
      version: 2,
      // Persist only the non-secret profile used to decide whether to attempt a
      // silent refresh on start-up. Never the token.
      partialize: (s) => ({ user: s.user }),
      // Older versions stored the access token here; drop it.
      migrate: (persisted: any) => ({ user: persisted?.user ? normalizeUser(persisted.user) : null }),
    },
  ),
);
