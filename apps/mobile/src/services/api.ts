import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

// ─── API URL Configuration ───────────────────────────────────────────────────
// For real device testing on same WiFi: set to your laptop's local IP
//   e.g. 'http://192.168.1.105:3001/api/v1'
// For production: set to your deployed backend URL
//   e.g. 'https://api.narisurokkha.com/api/v1'
// For Android emulator: use '10.0.2.2' which maps to host machine localhost

const PRODUCTION_API_URL = 'https://api.narisurokkha.com/api/v1'; // Change this for production
const LOCAL_WIFI_API_URL = 'https://narisurokkha-api.loca.lt/api/v1'; // Bypass firewall for physical devices
const EMULATOR_API_URL   = 'http://10.0.2.2:3001/api/v1'; // Android emulator localhost
const WEB_API_URL        = 'http://localhost:3001/api/v1'; // Web platform localhost

// ⬇️ Switch this to LOCAL_WIFI_API_URL for real device testing on same WiFi
// ⬇️ Switch this to PRODUCTION_API_URL when backend is deployed to the cloud
export const API_BASE_URL = Platform.OS === 'android'
  ? LOCAL_WIFI_API_URL   // Real device on same WiFi
  : Platform.OS === 'web'
    ? WEB_API_URL
    : WEB_API_URL;

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

const getItem = async (key: string) => {
  if (Platform.OS === 'web') {
    return await AsyncStorage.getItem(key);
  } else {
    return await SecureStore.getItemAsync(key);
  }
};

api.interceptors.request.use(async (config) => {
  const token = await getItem('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  if (config.baseURL?.includes('loca.lt')) {
    config.headers['Bypass-Tunnel-Reminder'] = 'true';
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    // If it's a network error or connection timeout
    if (error.message === 'Network Error' || error.code === 'ECONNABORTED' || !error.response) {
      const Toast = require('react-native-toast-message').default;
      Toast.show({
        type: 'error',
        text1: 'Connection Error',
        text2: 'Could not connect to backend server',
        position: 'top',
      });
    }

    if (error.response && error.response.status === 401) {
      // Token expired or invalid — clear it out so they return to LoginScreen
      if (Platform.OS === 'web') {
        await AsyncStorage.removeItem('accessToken');
        await AsyncStorage.removeItem('userData');
      } else {
        await SecureStore.deleteItemAsync('accessToken');
        await SecureStore.deleteItemAsync('userData');
      }
      
      // Use the store to update global state
      const { useAuthStore } = require('../store/authStore');
      useAuthStore.getState().logout();
    }
    return Promise.reject(error);
  }
);

export default api;
