import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

export interface User {
  id: string;
  phone: string;
  email?: string;
  role?: { key: string; name: string } | string;
  profile?: {
    fullName?: string;
    bloodGroup?: string;
    nationalId?: string;
    emergencyNote?: string;
    preferredLanguage?: string;
  };
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (user: User, token: string) => Promise<void>;
  logout: () => Promise<void>;
  restoreToken: () => Promise<void>;
  updateUser: (partial: Partial<User>) => Promise<void>;
}

const setItem = async (key: string, value: string) => {
  if (Platform.OS === 'web') {
    await AsyncStorage.setItem(key, value);
  } else {
    await SecureStore.setItemAsync(key, value);
  }
};

const getItem = async (key: string) => {
  if (Platform.OS === 'web') {
    return await AsyncStorage.getItem(key);
  } else {
    return await SecureStore.getItemAsync(key);
  }
};

const deleteItem = async (key: string) => {
  if (Platform.OS === 'web') {
    await AsyncStorage.removeItem(key);
  } else {
    await SecureStore.deleteItemAsync(key);
  }
};

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  
  login: async (user, token) => {
    await setItem('accessToken', token);
    await setItem('userData', JSON.stringify(user));
    set({ user, isAuthenticated: true });
  },
  
  logout: async () => {
    await deleteItem('accessToken');
    await deleteItem('userData');
    set({ user: null, isAuthenticated: false });
  },
  
  updateUser: async (partial) => {
    const current = useAuthStore.getState().user;
    if (!current) return;
    const updated = { ...current, ...partial, profile: { ...current.profile, ...(partial.profile || {}) } };
    await setItem('userData', JSON.stringify(updated));
    set({ user: updated });
  },

  restoreToken: async () => {
    try {
      const token = await getItem('accessToken');
      const userDataStr = await getItem('userData');
      
      if (token && userDataStr) {
        set({ user: JSON.parse(userDataStr), isAuthenticated: true });
      } else {
        set({ user: null, isAuthenticated: false });
      }
    } catch (e) {
      console.error('Failed to restore token', e);
      set({ user: null, isAuthenticated: false });
    } finally {
      set({ isLoading: false });
    }
  },
}));
