import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import Layout from './components/Layout';
import { useAuthStore } from './store/authStore';

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

function App() {
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
          <Route path="users" element={<Users />} />
          <Route path="roles" element={<Roles />} />
          <Route path="responders" element={<Responders />} />
          <Route path="incidents" element={<Incidents />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="audit-logs" element={<AuditLogs />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
