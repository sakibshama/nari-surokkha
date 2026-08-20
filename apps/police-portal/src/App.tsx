import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { Box, CircularProgress } from '@mui/material';
import Layout from './components/Layout';
import { useAuthStore } from './store/authStore';

// ─── Route-level code splitting ─────────────────────────────────────────────
// All six pages used to be static imports, so the initial bundle carried MUI,
// Leaflet, Google Maps and framer-motion before an officer could see a single
// alert. Login stays eager — it is the first screen and splitting it would only
// add a round trip to the critical path.
import Login from './pages/Login';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const AlertDetails = lazy(() => import('./pages/AlertDetails'));
const Cases = lazy(() => import('./pages/Cases'));
const CaseDetail = lazy(() => import('./pages/CaseDetail'));
const Incidents = lazy(() => import('./pages/Incidents'));
const Settings = lazy(() => import('./pages/Settings'));

const PageFallback = () => (
  <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
    <CircularProgress />
  </Box>
);

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  
  if (!isAuthenticated) {
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
          <Route path="incidents" element={<Incidents />} />
          <Route path="alerts/:id" element={<AlertDetails />} />
          <Route path="cases" element={<Cases />} />
          <Route path="cases/:id" element={<CaseDetail />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
      <Toaster />
    </BrowserRouter>
  );
}

export default App;
