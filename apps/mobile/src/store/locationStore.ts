import { create } from 'zustand';

interface LocationState {
  isSosActive: boolean;
  activeAlertId: string | null;
  activeRouteId: string | null;
  setSosActive: (isActive: boolean, alertId?: string | null) => void;
  setActiveRoute: (routeId: string | null) => void;
}

export const useLocationStore = create<LocationState>((set) => ({
  isSosActive: false,
  activeAlertId: null,
  activeRouteId: null,
  
  setSosActive: (isActive, alertId = null) => {
    set({ isSosActive: isActive, activeAlertId: alertId });
  },
  
  setActiveRoute: (routeId) => {
    set({ activeRouteId: routeId });
  }
}));
