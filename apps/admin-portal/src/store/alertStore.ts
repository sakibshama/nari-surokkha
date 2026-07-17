import { create } from 'zustand';

export interface Alert {
  id: string;
  type: string;
  status: string;
  latitude: number;
  longitude: number;
  createdAt: string;
  user: {
    id: string;
    phone: string;
    profile?: {
      fullName: string;
      bloodGroup?: string;
    };
  };
}

interface AlertState {
  alerts: Alert[];
  setAlerts: (alerts: Alert[]) => void;
  addAlert: (alert: Alert) => void;
  updateAlertStatus: (alertId: string, status: string) => void;
  updateAlertLocation: (alertId: string, latitude: number, longitude: number) => void;
}

export const useAlertStore = create<AlertState>((set: any) => ({
  alerts: [],
  setAlerts: (alerts: Alert[]) => set({ alerts }),
  addAlert: (alert: Alert) => set((state: AlertState) => ({ alerts: [alert, ...state.alerts] })),
  updateAlertStatus: (alertId: string, status: string) => set((state: AlertState) => ({
    alerts: state.alerts.map((a: Alert) => a.id === alertId ? { ...a, status } : a)
  })),
  updateAlertLocation: (alertId: string, latitude: number, longitude: number) => set((state: AlertState) => ({
    alerts: state.alerts.map((a: Alert) => a.id === alertId ? { ...a, latitude, longitude } : a)
  })),
}));
