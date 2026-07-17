import { useState, useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, ShieldAlert, AlertTriangle, Settings, LogOut, Menu, X,
  Bell, Moon, Sun, MapPin
} from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { useThemeStore } from '../store/themeStore';
import { socketService } from '../services/socket';
import toast, { Toaster } from 'react-hot-toast';
import GlobalAlertModal from './GlobalAlertModal';

const NAV_MAIN = [
  { label: 'Live Alerts',    icon: LayoutDashboard, path: '/' },
  { label: 'Cases',          icon: ShieldAlert,     path: '/cases' },
  { label: 'Incidents',      icon: AlertTriangle,   path: '/incidents' },
  { label: 'Settings',       icon: Settings,        path: '/settings' },
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

  useEffect(() => {
    socketService.connect();
    
    const handleNewAlert = (alertData: any) => {
      setIncomingAlert(alertData);
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
      className={`sidebar-item ${isActive(item.path) ? 'active blue-accent' : ''}`}
      onClick={() => { navigate(item.path); setSidebarOpen(false); }}
    >
      <span className="sidebar-item-icon">
        <item.icon size={18} />
      </span>
      {item.label}
    </div>
  );

  const initials = user?.fullName ? user.fullName.charAt(0).toUpperCase() : (user?.badgeNumber || 'POL').charAt(0).toUpperCase();

  const SidebarContent = () => (
    <>
      {/* Brand */}
      <div className="sidebar-brand">
        <div className="sidebar-brand-icon blue">
          <ShieldAlert size={20} color="#fff" />
        </div>
        <div className="sidebar-brand-text">
          <span className="sidebar-brand-name">Nari Surokkha</span>
          <span className="sidebar-brand-sub">Police Portal</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="sidebar-nav">
        <div className="sidebar-section-label">Main</div>
        {NAV_MAIN.map(item => <NavItem key={item.path} item={item} />)}
      </nav>

      {/* User footer */}
      <div className="sidebar-footer">
        <div className="sidebar-user">
          <div className="sidebar-user-avatar blue">{initials}</div>
          <div>
            <div className="sidebar-user-name">{String(user?.fullName || 'Officer')}</div>
            <div className="sidebar-user-role" style={{ textTransform: 'capitalize' }}>
              {typeof user?.role === 'object' ? (user.role as any)?.name || 'Officer' : String(user?.role || 'Officer')} {' • '} {String(user?.badgeNumber || 'N/A')}
            </div>

            {user?.stationName && (
              <div className="sidebar-user-role" style={{ marginTop: 2, fontSize: 11, opacity: 0.8 }}>
                <MapPin size={10} style={{ display: 'inline', marginRight: 4, position: 'relative', top: 1 }} />
                {String(user.stationName)}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );

  // Page title mapping
  const PAGE_TITLES: Record<string, string> = {
    '/': 'Live SOS Alerts Queue',
    '/cases': 'Cases',
    '/incidents': 'Reported Incidents',
    '/settings': 'Settings',
  };
  const pageTitle = PAGE_TITLES[location.pathname] || 'Police Portal';

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
            <button className="topbar-btn">
              <Bell size={16} />
              <span>Alerts</span>
            </button>
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
