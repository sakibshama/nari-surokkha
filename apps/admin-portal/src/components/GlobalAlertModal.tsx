import { useEffect, useState } from 'react';
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
  const [audioBlocked, setAudioBlocked] = useState(false);

  useEffect(() => {
    if (!alert) return;

    let intervalId: any;

    const attemptPlay = async () => {
      try {
        await playSiren();
        setAudioBlocked(false);
      } catch (err) {
        console.error('Audio playback failed - likely browser autoplay blocked', err);
        setAudioBlocked(true);
      }
    };

    attemptPlay();
    intervalId = setInterval(attemptPlay, 2100);

    return () => clearInterval(intervalId);
  }, [alert]);

  if (!alert) return null;

  const handleViewCase = () => {
    onDismiss();
    navigate(`/alerts/${alert.alertId}`);
  };

  const handleUnmute = async () => {
    try {
      await playSiren();
      setAudioBlocked(false);
    } catch (err) {
      console.warn('Still blocked', err);
    }
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        {/* Pulsing red background behind icon */}
        <div className="pulse-ring" style={styles.iconContainer}>
          <ShieldAlert size={48} color="#fff" />
        </div>
        
        <h2 style={styles.title}>EMERGENCY SOS DETECTED</h2>
        
        <p style={styles.subtitle}>
          A citizen has triggered an SOS and requires immediate assistance.
        </p>
        
        <div style={styles.detailsBox}>
          <div style={styles.detailRow}>
            <MapPin size={18} color="var(--danger)" />
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
        
        {audioBlocked && (
          <div style={{ color: '#ef4444', marginBottom: 16, fontSize: 14 }}>
            🔇 Browser blocked the siren. Click below to unmute!
          </div>
        )}
        
        <div style={styles.actions}>
          {audioBlocked ? (
            <button style={{...styles.viewBtn, backgroundColor: '#f97316'}} onClick={handleUnmute}>
              Unmute Siren
            </button>
          ) : (
            <button style={styles.dismissBtn} onClick={onDismiss}>
              Dismiss
            </button>
          )}
          <button style={styles.viewBtn} onClick={handleViewCase}>
            View Case Details
          </button>
        </div>
      </div>

      <style>{`
        @keyframes pulse-red {
          0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); }
          70% { box-shadow: 0 0 0 30px rgba(239, 68, 68, 0); }
          100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
        }
        .pulse-ring {
          animation: pulse-red 2s infinite;
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
    backgroundColor: '#1e0f0f',
    border: '2px solid #ef4444',
    borderRadius: '16px',
    padding: '40px 30px',
    maxWidth: '500px',
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    boxShadow: '0 20px 50px rgba(239, 68, 68, 0.3)',
  },
  iconContainer: {
    backgroundColor: '#ef4444',
    borderRadius: '50%',
    width: '90px',
    height: '90px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '24px',
  },
  title: {
    color: '#ef4444',
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
    backgroundColor: '#ef4444',
    border: 'none',
    borderRadius: '8px',
    color: '#fff',
    fontWeight: 'bold',
    cursor: 'pointer',
    fontSize: '16px',
  },
};
