import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface User {
  id: string;
  fullName?: string;
  badgeNumber: string;
  role: string;
  stationId: string;
  stationName?: string;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  login: (user: User, token: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set: any): AuthState => ({
      user: null,
      accessToken: null,
      isAuthenticated: false,
      login: (user: User, token: string) => set({ user, accessToken: token, isAuthenticated: true }),
      logout: () => set({ user: null, accessToken: null, isAuthenticated: false }),
    }),
    {
      name: 'police-auth-storage',
    }
  )
);
