import { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import Layout from './components/Layout';
import { useAuthStore } from './store/authStore';
import { refreshAccessToken } from './services/api';
import { useT } from './i18n';
import AppLogo from './components/AppLogo';

// ─── Route-level code splitting ─────────────────────────────────────────────
// Every page used to be a static import, so the initial bundle contained all
// twelve of them plus MUI, Leaflet, Google Maps, Recharts and framer-motion in
// one chunk. An admin on 3G waited for the analytics charting library
// before they could see an alert.
//
// Login stays eager: it is the first thing an unauthenticated user needs, and
// splitting it only adds a round trip to the critical path.
import Login from './pages/Login';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const AlertDetails = lazy(() => import('./pages/AlertDetails'));
const Users = lazy(() => import('./pages/Users'));
const Roles = lazy(() => import('./pages/Roles'));
const Responders = lazy(() => import('./pages/Responders'));
const AuditLogs = lazy(() => import('./pages/AuditLogs'));
const Incidents = lazy(() => import('./pages/Incidents'));
const Settings = lazy(() => import('./pages/Settings'));
const PaymentGateways = lazy(() => import('./pages/PaymentGateways'));
// Analytics pulls in Recharts — by far the heaviest page, and the one least
// likely to be the first thing anyone opens.
const Analytics = lazy(() => import('./pages/Analytics'));

/** Shown while a route chunk downloads. */
const PageFallback = () => (
  <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
    <CircularProgress />
  </Box>
);

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated, user } = useAuthStore();
  
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Enforce admin-only access at the router level.
  // The API returns `role` as a string key, but older sessions may have stored
  // it as an object — handle both so a valid admin is never bounced.
  const roleKey = typeof user?.role === 'string' ? user.role : user?.role?.key;
  if (user && roleKey !== 'admin' && roleKey !== 'superadmin') {
    return <Navigate to="/login" replace />;
  }
  
  return <>{children}</>;
};

/** Page-level permission gate (the API enforces the same permissions). */
const RequirePermission = ({ permission, children }: { permission: string; children: React.ReactNode }) => {
  const allowed = useAuthStore((s) => s.hasPermission(permission));
  const t = useT();
  if (!allowed) {
    return (
      <div className="empty-state" style={{ padding: 60 }}>
        <h3 style={{ margin: '0 0 8px', color: 'var(--text)' }}>{t('Access restricted')}</h3>
        <p style={{ margin: 0 }}>{t('Your account does not have permission to view this page. Ask an administrator with “Manage Admins” to grant it.')}</p>
      </div>
    );
  }
  return <>{children}</>;
};

/** Shown while a persisted session is re-validated with the refresh cookie. */
const Splash = () => {
  const t = useT();
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, background: 'var(--bg)' }}>
      <AppLogo size={64} radius={18} />
      <CircularProgress size={28} />
      <span style={{ color: 'var(--text-sub)', fontSize: 14 }}>{t('Restoring your session…')}</span>
    </div>
  );
};

/**
 * The access token lives in memory only, so after a reload a persisted user
 * has no token. Mint a fresh one from the httpOnly refresh cookie before any
 * protected route renders; on failure clear the user → /login.
 */
function useSessionBootstrap(): boolean {
  const [ready, setReady] = useState(() => {
    const s = useAuthStore.getState();
    return !s.user || !!s.accessToken;
  });
  useEffect(() => {
    if (ready) return;
    let cancelled = false;
    refreshAccessToken()
      .catch(() => useAuthStore.getState().logout())
      .finally(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, [ready]);
  return ready;
}

function App() {
  const ready = useSessionBootstrap();
  if (!ready) return <Splash />;
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Suspense fallback={<PageFallback />}>
                <Layout />
              </Suspense>
            </ProtectedRoute>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="alerts/:id" element={<AlertDetails />} />
          <Route path="users" element={<RequirePermission permission="manage_users"><Users /></RequirePermission>} />
          <Route path="roles" element={<RequirePermission permission="manage_users"><Roles /></RequirePermission>} />
          <Route path="responders" element={<RequirePermission permission="manage_users"><Responders /></RequirePermission>} />
          <Route path="incidents" element={<Incidents />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="audit-logs" element={<RequirePermission permission="view_audit_logs"><AuditLogs /></RequirePermission>} />
          <Route path="settings" element={<Settings />} />
          <Route path="payments" element={<PaymentGateways />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
