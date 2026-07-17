import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, UserCheck, Download, X } from 'lucide-react';
import { format } from 'date-fns';
import api from '../services/api';
import { useAuthStore } from '../store/authStore';

export default function CaseDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  
  const [caseData, setCaseData] = useState<any>(null);
  const [timeline, setTimeline] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [noteText, setNoteText] = useState('');
  
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [newStatus, setNewStatus] = useState('');
  const [closeReason, setCloseReason] = useState('');

  const fetchCase = async () => {
    try {
      const res = await api.get(`/cases/${id}/timeline`);
      setCaseData(res.data.data.case);
      setTimeline(res.data.data.timeline);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCase();
  }, [id]);

  const handleAssignToMe = async () => {
    try {
      await api.patch(`/cases/${id}/assign`, { officerId: user?.id });
      fetchCase();
    } catch (err) {
      alert('Failed to assign');
    }
  };

  const handleAddNote = async () => {
    if (!noteText) return;
    try {
      await api.post(`/cases/${id}/notes`, { note: noteText });
      setNoteText('');
      fetchCase();
    } catch (err) {
      alert('Failed to add note');
    }
  };

  const handleUpdateStatus = async () => {
    try {
      await api.patch(`/cases/${id}/status`, { 
        status: newStatus, 
        closedReason: (newStatus === 'closed' || newStatus === 'false_alarm') ? closeReason : undefined 
      });
      setStatusDialogOpen(false);
      fetchCase();
    } catch (err) {
      alert('Failed to update status');
    }
  };

  const handleDownloadReport = async () => {
    try {
      const res = await api.get(`/cases/${id}/report`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `case_${caseData.caseNumber}.txt`);
      document.body.appendChild(link);
      link.click();
    } catch (err) {
      alert('Failed to download report');
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px', color: 'var(--text-sub)' }}>
        Loading case details...
      </div>
    );
  }

  if (!caseData) {
    return (
      <div className="animate-in empty-state">
        <p>Case not found.</p>
        <button className="btn btn-ghost" onClick={() => navigate('/cases')} style={{ marginTop: 16 }}>Back to Cases</button>
      </div>
    );
  }

  const isClosed = caseData.status === 'closed' || caseData.status === 'false_alarm';

  return (
    <div className="animate-in">
      <div className="page-header">
        <div className="page-header-row">
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/cases')}>
              <ArrowLeft size={16} /> Back
            </button>
            <h1 className="page-title" style={{ margin: 0, fontSize: 22 }}>
              Case: <span className="cell-mono">{caseData.caseNumber}</span>
            </h1>
          </div>
          <button className="btn btn-primary" onClick={handleDownloadReport}>
            <Download size={16} /> Download Report
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {/* Left Column */}
        <div style={{ flex: '1 1 400px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Details Card */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--text)' }}>Case Details</h2>
              <span className={`badge ${isClosed ? 'success' : 'warning'}`}>{caseData.status.replace('_', ' ').toUpperCase()}</span>
            </div>
            <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '0 0 16px' }} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: 24 }}>
              <div className="detail-field">
                <span className="detail-field-label">Alert ID</span>
                <span className="detail-field-value cell-mono">{caseData.alertId}</span>
              </div>
              <div className="detail-field">
                <span className="detail-field-label">Assigned Officer</span>
                <span className="detail-field-value">
                  {caseData.assignedOfficer ? caseData.assignedOfficer.profile?.fullName || caseData.assignedOfficer.badgeNumber : 'Unassigned'}
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
              {!caseData.assignedOfficer && !isClosed && (
                <button className="btn btn-blue" onClick={handleAssignToMe}>
                  <UserCheck size={16} /> Assign to Me
                </button>
              )}
              {!isClosed && (
                <button className="btn btn-ghost" style={{ color: 'var(--amber)', borderColor: 'rgba(245,158,11,0.3)' }} onClick={() => setStatusDialogOpen(true)}>
                  Update Status
                </button>
              )}
            </div>
          </div>

          {/* Notes Card */}
          <div className="card">
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 16px', color: 'var(--text)' }}>Add Investigation Note</h2>
            <textarea
              className="field-input"
              rows={4}
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              disabled={isClosed}
              placeholder={isClosed ? "This case is closed." : "Enter detailed case notes here..."}
              style={{ resize: 'vertical', minHeight: 100, marginBottom: 16 }}
            />
            <button className="btn btn-primary" onClick={handleAddNote} disabled={isClosed || !noteText}>
              <Save size={16} /> Add Note
            </button>
          </div>
        </div>

        {/* Right Column (Timeline) */}
        <div className="card" style={{ flex: '1 1 350px', maxHeight: '80vh', overflowY: 'auto' }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 16px', color: 'var(--text)' }}>Master Timeline</h2>
          <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '0 0 16px' }} />
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {timeline.length === 0 ? (
              <p style={{ color: 'var(--text-sub)', fontSize: 14 }}>No timeline events recorded.</p>
            ) : (
              timeline.map((item, idx) => (
                <div key={idx} style={{ display: 'flex', gap: '12px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--blue)', marginTop: 4 }}></div>
                    {idx !== timeline.length - 1 && <div style={{ width: 2, flex: 1, background: 'var(--border)', marginTop: 4, marginBottom: -12 }}></div>}
                  </div>
                  <div style={{ flex: 1, paddingBottom: 16 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--blue)', marginBottom: 4 }}>
                      {format(new Date(item.timestamp), 'PPpp')} - {item.type.toUpperCase()}
                    </div>
                    {item.type === 'update' && (
                      <div style={{ fontSize: 14, color: 'var(--text)' }}>{item.data.note}</div>
                    )}
                    {item.type === 'location' && (
                      <div className="cell-mono" style={{ fontSize: 13, color: 'var(--text)' }}>
                        Location Ping: {item.data.latitude.toFixed(4)}, {item.data.longitude.toFixed(4)}
                      </div>
                    )}
                    {item.type === 'evidence' && (
                      <div style={{ fontSize: 14, color: 'var(--text)' }}>
                        Evidence Uploaded: {item.data.fileType}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Custom Modal for Status Update */}
      {statusDialogOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)'
        }}>
          <div className="card" style={{ width: '100%', maxWidth: 400, padding: 32, position: 'relative' }}>
            <button 
              onClick={() => setStatusDialogOpen(false)}
              style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', color: 'var(--text-sub)', cursor: 'pointer' }}
            >
              <X size={20} />
            </button>
            
            <h2 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 24px', color: 'var(--text)' }}>Update Case Status</h2>
            
            <div className="field">
              <label className="field-label">Status</label>
              <select 
                className="field-input" 
                value={newStatus} 
                onChange={(e) => setNewStatus(e.target.value)}
                style={{ appearance: 'none' }}
              >
                <option value="" disabled>Select a status...</option>
                <option value="open">Open</option>
                <option value="investigating">Investigating</option>
                <option value="closed">Closed (Resolved)</option>
                <option value="false_alarm">Closed (False Alarm)</option>
              </select>
            </div>

            {(newStatus === 'closed' || newStatus === 'false_alarm') && (
              <div className="field">
                <label className="field-label">Reason for closing</label>
                <textarea
                  className="field-input"
                  rows={3}
                  value={closeReason}
                  onChange={(e) => setCloseReason(e.target.value)}
                  style={{ resize: 'vertical' }}
                />
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: 24 }}>
              <button className="btn btn-ghost" onClick={() => setStatusDialogOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleUpdateStatus} disabled={!newStatus}>Update Case</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
