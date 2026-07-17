import { useState, useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Users, UserCheck, Building2,
  Activity, Settings, LogOut, ShieldAlert, Menu, X,
  Bell, Moon, Sun, AlertTriangle, BarChart3, ShieldCheck, CheckCircle, BrainCircuit
} from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { useThemeStore } from '../store/themeStore';
import { socketService } from '../services/socket';
import api from '../services/api';
import toast, { Toaster } from 'react-hot-toast';
import GlobalAlertModal from './GlobalAlertModal';

type NavItemDef = { label: string; icon: any; path: string; permission?: string };

const NAV_MAIN: NavItemDef[] = [
  { label: 'Dashboard',       icon: LayoutDashboard, path: '/' },
  { label: 'Users',            icon: Users,        path: '/users', permission: 'manage_users' },
  { label: 'Role Management',  icon: ShieldCheck,  path: '/roles', permission: 'manage_users' },
  { label: 'Responders',       icon: UserCheck,    path: '/responders', permission: 'manage_users' },
  { label: 'Police Stations', icon: Building2,       path: '/police-stations', permission: 'manage_stations' },
  { label: 'Incident Reports', icon: AlertTriangle,   path: '/incidents' },
  { label: 'Analytics',       icon: BarChart3,       path: '/analytics' },
];
const NAV_SYSTEM: NavItemDef[] = [
  { label: 'Audit Logs',      icon: Activity,  path: '/audit-logs', permission: 'view_audit_logs' },
  { label: 'ML Tuning',       icon: Settings,  path: '/ml-tuning' },
  { label: 'ML Models',       icon: BrainCircuit, path: '/ml-models' },
  { label: 'Settings',        icon: Settings,  path: '/settings' },
];

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuthStore();
  const { mode, toggleTheme } = useThemeStore();

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', mode);
  }, [mode]);

  const [incomingAlert, setIncomingAlert] = useState<any | null>(null);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);

  const fetchNotifications = async () => {
    try {
      const res = await api.get('/admin/alerts', { params: { limit: 5, _t: Date.now() }, headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' } });
      const activeAlerts = res.data.data.filter((a: any) => a.status === 'created' || a.status === 'confirmed');
      setNotifications(activeAlerts);
      setUnreadCount(activeAlerts.length);
    } catch (err) {
      console.error('Failed to fetch notifications', err);
    }
  };

  useEffect(() => {
    fetchNotifications();
    socketService.connect();
    
    const handleNewAlert = (alertData: any) => {
      console.log('🚨 Received alert:created via WebSocket!', alertData);
      toast.error('EMERGENCY SOS DETECTED!', { duration: 5000, position: 'top-center' });
      setIncomingAlert(alertData);
      setNotifications(prev => [alertData, ...prev]);
      setUnreadCount(prev => prev + 1);
    };

    if (socketService.socket) {
      socketService.socket.on('alert:created', handleNewAlert);
    }

    return () => {
      if (socketService.socket) {
        socketService.socket.off('alert:created', handleNewAlert);
      }
    };
  }, []);

  const handleLogout = () => {
    logout();
    socketService.disconnect();
    navigate('/login');
  };

  const isActive = (path: string) =>
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);

  const NavItem = ({ item }: { item: any }) => (
    <div
      className={`sidebar-item ${isActive(item.path) ? 'active' : ''}`}
      onClick={() => { navigate(item.path); setSidebarOpen(false); }}
    >
      <span className="sidebar-item-icon">
        <item.icon size={18} />
      </span>
      {item.label}
    </div>
  );


  const SidebarContent = () => (
    <>
      {/* Brand */}
      <div className="sidebar-brand">
        <div className="sidebar-brand-icon">
          <ShieldAlert size={20} color="#fff" />
        </div>
        <div className="sidebar-brand-text">
          <span className="sidebar-brand-name">Nari Surokkha</span>
          <span className="sidebar-brand-sub">Admin Portal</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="sidebar-nav">
        <div className="sidebar-section-label">Main</div>
        {/* Show all items if permissions not loaded yet, else filter by permission */}
        {NAV_MAIN.filter(item => !item.permission || !user?.permissions || user.permissions.includes(item.permission)).map(item => <NavItem key={item.path} item={item} />)}

        <div className="sidebar-section-label" style={{ marginTop: 8 }}>System</div>
        {NAV_SYSTEM.filter(item => !item.permission || !user?.permissions || user.permissions.includes(item.permission)).map(item => <NavItem key={item.path} item={item} />)}
      </nav>

      {/* User footer */}
      <div className="sidebar-footer">
        <div className="sidebar-user">
          <div className="sidebar-user-avatar">{user?.fullName ? user.fullName.substring(0, 2).toUpperCase() : 'AD'}</div>
          <div>
            <div className="sidebar-user-name" style={{ textTransform: 'capitalize' }}>{user?.fullName || 'Administrator'}</div>
            <div className="sidebar-user-role" style={{ textTransform: 'capitalize' }}>{typeof user?.role === 'string' ? user.role : (user?.role?.name || user?.role?.key) || 'Admin'}</div>
          </div>
        </div>
      </div>
    </>
  );

  // Page title mapping
  const PAGE_TITLES: Record<string, string> = {
    '/': 'Dashboard',
    '/users': 'User Management',
    '/roles': 'Role Management',
    '/responders': 'Responders',
    '/police-stations': 'Police Stations',
    '/incidents': 'Incident Reports',
    '/analytics': 'City Safety Analytics',
    '/audit-logs': 'Audit Logs',
    '/ml-tuning': 'ML Tuning Configuration',
    '/ml-models': 'On-Device ML Models',
    '/settings': 'Settings',
  };
  const pageTitle = PAGE_TITLES[location.pathname] || 'Admin Portal';

  return (
    <div className="portal-shell">
      <Toaster />
      <GlobalAlertModal alert={incomingAlert} onDismiss={() => setIncomingAlert(null)} />
      {/* ── Sidebar Desktop ── */}
      <aside className="sidebar" style={{ display: 'flex' }}>
        <SidebarContent />
      </aside>

      {/* ── Mobile Overlay ── */}
      {sidebarOpen && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 99, backdropFilter: 'blur(4px)' }}
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside
        className="sidebar"
        style={{
          display: 'flex',
          transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)',
          zIndex: 200,
        }}
      >
        <SidebarContent />
      </aside>

      {/* ── Main ── */}
      <div className="main-content" style={{ flex: 1 }}>
        {/* Topbar */}
        <header className="topbar">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-sub)', display: 'none', padding: 4 }}
            className="mobile-menu-btn"
          >
            {sidebarOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
          <span className="topbar-title">{pageTitle}</span>
          <div className="topbar-actions">
            <button className="topbar-btn" onClick={toggleTheme} title="Toggle theme">
              {mode === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <div style={{ position: 'relative' }}>
              <button className="topbar-btn" onClick={() => {
                setShowNotifications(!showNotifications);
                if (!showNotifications) setUnreadCount(0);
              }}>
                <div style={{ position: 'relative' }}>
                  <Bell size={16} />
                  {unreadCount > 0 && (
                    <span style={{
                      position: 'absolute', top: -4, right: -4,
                      background: '#ef4444', color: '#fff', fontSize: 10,
                      width: 14, height: 14, borderRadius: '50%',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 'bold'
                    }}>{unreadCount}</span>
                  )}
                </div>
                <span>Alerts</span>
              </button>

              {showNotifications && (
                <>
                  <div style={{ position: 'fixed', inset: 0, zIndex: 90 }} onClick={() => setShowNotifications(false)} />
                  <div className="card animate-in" style={{
                    position: 'absolute', top: 'calc(100% + 8px)', right: 0,
                    width: 320, padding: 0, zIndex: 100,
                    boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
                    overflow: 'hidden'
                  }}>
                    <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Active Alerts</h3>
                      {unreadCount > 0 && <span className="badge danger">{unreadCount} New</span>}
                    </div>
                    <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                      {notifications.length === 0 ? (
                        <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-sub)' }}>
                          <CheckCircle size={32} style={{ margin: '0 auto 12px', opacity: 0.5 }} />
                          <p style={{ margin: 0, fontSize: 13 }}>No active alerts right now.</p>
                        </div>
                      ) : (
                        notifications.map((alert, index) => {
                          const alertId = alert.id || alert.alertId || alert._id;
                          return (
                          <div 
                            key={alertId || index} 
                            style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', cursor: 'pointer', transition: 'background 0.2s' }}
                            onClick={() => {
                              setShowNotifications(false);
                              navigate(`/alerts/${alertId}`);
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                          >
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', marginTop: 6, animation: 'alert-pulse 1.5s infinite' }} />
                              <div>
                                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>SOS Emergency</div>
                                <div style={{ fontSize: 12, color: 'var(--text-sub)' }}>{new Date(alert.createdAt || alert.timestamp || Date.now()).toLocaleTimeString()}</div>
                              </div>
                            </div>
                          </div>
                        )})
                      )}
                    </div>
                    <div 
                      style={{ padding: '12px', textAlign: 'center', background: 'rgba(255,255,255,0.02)', fontSize: 13, color: 'var(--text-sub)', cursor: 'pointer', borderTop: '1px solid var(--border)' }}
                      onClick={() => { setShowNotifications(false); navigate('/'); }}
                    >
                      View All Alerts
                    </div>
                  </div>
                </>
              )}
            </div>
            <button className="topbar-btn danger" onClick={handleLogout}>
              <LogOut size={16} />
              <span>Logout</span>
            </button>
          </div>
        </header>

        {/* Page content */}
        <div className="page-body">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
