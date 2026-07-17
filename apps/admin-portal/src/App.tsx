import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import AlertDetails from './pages/AlertDetails';
import Users from './pages/Users';
import Roles from './pages/Roles';
import Responders from './pages/Responders';
import PoliceStations from './pages/PoliceStations';
import AuditLogs from './pages/AuditLogs';
import Incidents from './pages/Incidents';
import Settings from './pages/Settings';
import Analytics from './pages/Analytics';
import MLTuning from './pages/MLTuning';
import MLModels from './pages/MLModels';
import { useAuthStore } from './store/authStore';

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
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="alerts/:id" element={<AlertDetails />} />
          <Route path="users" element={<Users />} />
          <Route path="roles" element={<Roles />} />
          <Route path="responders" element={<Responders />} />
          <Route path="police-stations" element={<PoliceStations />} />
          <Route path="incidents" element={<Incidents />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="audit-logs" element={<AuditLogs />} />
          <Route path="ml-tuning" element={<MLTuning />} />
          <Route path="ml-models" element={<MLModels />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
