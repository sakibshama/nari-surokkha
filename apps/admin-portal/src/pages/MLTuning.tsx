import { useState } from 'react';

export default function MLTuning() {
  const [fallSensitivity, setFallSensitivity] = useState(70);
  const [audioConfidence, setAudioConfidence] = useState(85);

  const handleSave = () => {
    // Mock save logic, since there is no actual database for ML settings right now
    alert('ML settings saved successfully!');
  };

  return (
    <div className="animate-in space-y-6">
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: 'var(--text)' }}>ML Tuning</h1>
        <p style={{ marginTop: 8, fontSize: 14, color: 'var(--text-sub)' }}>Adjust the sensitivity thresholds for the machine learning services.</p>
      </div>

      <div style={{ display: 'grid', gap: 24, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <div className="card" style={{ padding: 24 }}>
          <h2 style={{ margin: '0 0 8px 0', fontSize: 18, fontWeight: 700 }}>Fall Detection Sensitivity</h2>
          <p style={{ margin: '0 0 16px 0', fontSize: 13, color: 'var(--text-sub)' }}>Minimum confidence threshold to trigger a soft alert for a fall.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 600 }}>
              <span>Sensitivity</span>
              <span style={{ color: 'var(--text-sub)' }}>{fallSensitivity}%</span>
            </div>
            <input 
              type="range" 
              min="10" 
              max="100" 
              value={fallSensitivity} 
              onChange={(e) => setFallSensitivity(Number(e.target.value))}
              style={{ width: '100%', cursor: 'pointer' }}
            />
          </div>
        </div>

        <div className="card" style={{ padding: 24 }}>
          <h2 style={{ margin: '0 0 8px 0', fontSize: 18, fontWeight: 700 }}>Audio Distress Confidence</h2>
          <p style={{ margin: '0 0 16px 0', fontSize: 13, color: 'var(--text-sub)' }}>Minimum confidence threshold to trigger a soft alert for distress audio.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 600 }}>
              <span>Confidence</span>
              <span style={{ color: 'var(--text-sub)' }}>{audioConfidence}%</span>
            </div>
            <input 
              type="range" 
              min="50" 
              max="99" 
              value={audioConfidence} 
              onChange={(e) => setAudioConfidence(Number(e.target.value))}
              style={{ width: '100%', cursor: 'pointer' }}
            />
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 24 }}>
        <button 
          onClick={handleSave} 
          style={{
            padding: '10px 20px', 
            background: 'var(--primary, #3b82f6)', 
            color: '#fff', 
            border: 'none', 
            borderRadius: 8, 
            fontWeight: 600, 
            cursor: 'pointer'
          }}
        >
          Save Thresholds
        </button>
      </div>
    </div>
  );
}
