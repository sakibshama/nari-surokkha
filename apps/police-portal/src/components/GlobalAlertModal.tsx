import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert, MapPin } from 'lucide-react';
import { playSiren } from '../utils/audio';

interface GlobalAlertModalProps {
  alert: {
    alertId: string;
    userId: string;
    latitude: number;
    longitude: number;
    timestamp: string;
  } | null;
  onDismiss: () => void;
}

export default function GlobalAlertModal({ alert, onDismiss }: GlobalAlertModalProps) {
  const navigate = useNavigate();

  useEffect(() => {
    if (!alert) return;

    // Play immediately
    playSiren();
    
    // Play every 2.1 seconds to create a continuous looping siren
    const intervalId = setInterval(() => {
      playSiren();
    }, 2100);

    return () => {
      clearInterval(intervalId);
    };
  }, [alert]);

  if (!alert) return null;

  const handleViewCase = () => {
    onDismiss();
    navigate(`/cases`); // Police portal has a general cases/live alert queue
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        {/* Pulsing blue background behind icon (police theme) */}
        <div className="pulse-ring-blue" style={styles.iconContainer}>
          <ShieldAlert size={48} color="#fff" />
        </div>
        
        <h2 style={styles.title}>EMERGENCY SOS DISPATCH</h2>
        
        <p style={styles.subtitle}>
          A new SOS emergency has been routed to your station. Immediate action is required.
        </p>
        
        <div style={styles.detailsBox}>
          <div style={styles.detailRow}>
            <MapPin size={18} color="var(--blue)" />
            <span>
              Location: {alert.latitude.toFixed(4)}, {alert.longitude.toFixed(4)}
            </span>
          </div>
          <div style={styles.detailRow}>
            <span style={{ fontSize: 12, color: 'var(--text-sub)' }}>
              Time: {new Date(alert.timestamp).toLocaleTimeString()}
            </span>
          </div>
        </div>
        
        <div style={styles.actions}>
          <button style={styles.dismissBtn} onClick={onDismiss}>
            Dismiss Alarm
          </button>
          <button style={styles.viewBtn} onClick={handleViewCase}>
            View Active Cases
          </button>
        </div>
      </div>

      <style>{`
        @keyframes pulse-blue {
          0% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.7); }
          70% { box-shadow: 0 0 0 30px rgba(59, 130, 246, 0); }
          100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0); }
        }
        .pulse-ring-blue {
          animation: pulse-blue 2s infinite;
        }
      `}</style>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    backdropFilter: 'blur(8px)',
    zIndex: 9999,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
  },
  modal: {
    backgroundColor: '#0c1a2e',
    border: '2px solid #3b82f6',
    borderRadius: '16px',
    padding: '40px 30px',
    maxWidth: '500px',
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    boxShadow: '0 20px 50px rgba(59, 130, 246, 0.3)',
  },
  iconContainer: {
    backgroundColor: '#3b82f6',
    borderRadius: '50%',
    width: '90px',
    height: '90px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '24px',
  },
  title: {
    color: '#3b82f6',
    fontSize: '28px',
    fontWeight: 'bold',
    letterSpacing: '1px',
    margin: '0 0 12px 0',
  },
  subtitle: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: '16px',
    margin: '0 0 24px 0',
    lineHeight: '1.5',
  },
  detailsBox: {
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '8px',
    padding: '16px',
    width: '100%',
    marginBottom: '32px',
  },
  detailRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    color: '#fff',
    margin: '4px 0',
  },
  actions: {
    display: 'flex',
    gap: '16px',
    width: '100%',
  },
  dismissBtn: {
    flex: 1,
    padding: '14px',
    backgroundColor: 'transparent',
    border: '1px solid rgba(255, 255, 255, 0.2)',
    borderRadius: '8px',
    color: '#fff',
    fontWeight: 'bold',
    cursor: 'pointer',
  },
  viewBtn: {
    flex: 2,
    padding: '14px',
    backgroundColor: '#3b82f6',
    border: 'none',
    borderRadius: '8px',
    color: '#fff',
    fontWeight: 'bold',
    cursor: 'pointer',
    fontSize: '16px',
  },
};
