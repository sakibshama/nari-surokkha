import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface User {
  id: string;
  phone: string;
  role: any;
  permissions: string[];
  fullName?: string;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  login: (user: User, token: string) => void;
  setAccessToken: (token: string) => void;
  logout: () => void;
  hasPermission: (permission: string) => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      isAuthenticated: false,
      login: (user: User, token: string) => set({ user, accessToken: token, isAuthenticated: true }),
      setAccessToken: (token: string) => set({ accessToken: token }),
      logout: () => set({ user: null, accessToken: null, isAuthenticated: false }),
      // Helper to check permissions gracefully (shows all if permissions not loaded)
      hasPermission: (permission: string) => {
        const perms = get().user?.permissions;
        if (!perms) return true; // gracefully show if not loaded
        return perms.includes(permission);
      },
    }),
    {
      name: 'admin-auth-storage',
    }
  )
);
