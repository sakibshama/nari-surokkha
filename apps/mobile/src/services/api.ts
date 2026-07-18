import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

// ─── API URL Configuration ───────────────────────────────────────────────────
// PRODUCTION (default): the live VPS API. Used automatically in all release
// builds (`__DEV__` is false in EAS/production builds).
//
// DEVELOPMENT (`expo start`): set DEV_API_URL to reach your local backend:
//   - Android emulator:            'http://10.0.2.2:3001/api/v1'
//   - iOS simulator / web:         'http://localhost:3001/api/v1'
//   - Physical device (same WiFi): 'http://<your-laptop-LAN-IP>:3001/api/v1'
// Or leave it as the production URL to develop against the live server.

const PRODUCTION_API_URL = 'https://api.mystrix-soft.com/api/v1';

// Dev default = live VPS API (works from any device/emulator with internet).
// To develop against a local backend instead, swap in one of the options below.
const DEV_API_URL = PRODUCTION_API_URL;
// const DEV_API_URL = Platform.OS === 'android'
//   ? 'http://10.0.2.2:3001/api/v1'      // Android emulator → host machine
//   : 'http://localhost:3001/api/v1';    // iOS simulator / web

// Release builds always hit production; dev builds use DEV_API_URL.
export const API_BASE_URL = __DEV__ ? DEV_API_URL : PRODUCTION_API_URL;

// ─── WebRTC ICE servers ──────────────────────────────────────────────────────
// STUN discovers the public address; TURN relays media when peer-to-peer
// fails (common on cellular CGNAT). The TURN credential must match
// TURN_PASSWORD in the server's .env.production.
export const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  {
    urls: [
      'turn:api.mystrix-soft.com:3478?transport=udp',
      'turn:api.mystrix-soft.com:3478?transport=tcp',
    ],
    username: 'nari',
    credential: 'CHANGE_ME_turn_password',
  },
];

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
