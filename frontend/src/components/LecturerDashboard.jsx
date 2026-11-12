import React, { useState, useEffect } from 'react';
import { QrCode, Share2, Users, Bot, Archive, WifiOff, PlusCircle, LogOut, X } from 'lucide-react';
import { apiRequest, formatCountdown } from '../api';
import ClassSetupWizard from './ClassSetupWizard';

export default function LecturerDashboard({ token, lecturer, onLogout }) {
  const [classes, setClasses] = useState([]);
  const [showWizard, setShowWizard] = useState(false);
  const [activeSession, setActiveSession] = useState(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [liveRecords, setLiveRecords] = useState([]);
  const [showQrModal, setShowQrModal] = useState(false);
  const [archives, setArchives] = useState([]);
  const [statusMsg, setStatusMsg] = useState('');
  const [error, setError] = useState('');

  const [offlineStudentId, setOfflineStudentId] = useState('');
  const [offlineFullName, setOfflineFullName] = useState('');
  const [offlineStatus, setOfflineStatus] = useState('ATTENDED');

  const [aiPrompt, setAiPrompt] = useState('');
  const [aiResponse, setAiResponse] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);

  async function loadClassesAndArchives() {
    try {
      const clsData = await apiRequest('/classes', {}, token);
      setClasses(clsData.classes);
      if (clsData.classes.length === 0) setShowWizard(true);
      const arcData = await apiRequest('/sessions/archives/list', {}, token);
      setArchives(arcData.archives);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    loadClassesAndArchives();
  }, []);

  useEffect(() => {
    if (!activeSession) return;
    const interval = setInterval(async () => {
      try {
        const data = await apiRequest(`/sessions/${activeSession.id}/live`, {}, token);
        setLiveRecords(data.session.records || []);
        setRemainingSeconds(data.remainingSeconds);
      } catch (err) {
        console.error(err);
      }
    }, 5000);

    const tick = setInterval(() => {
      setRemainingSeconds((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);

    return () => {
      clearInterval(interval);
      clearInterval(tick);
    };
  }, [activeSession]);

  function handleSelectClassToBroadcast(cls) {
    setError('');
    setStatusMsg('Capturing classroom GPS coordinates (100m geofence center)...');
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by this browser.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const data = await apiRequest(
            '/sessions/start',
            {
              method: 'POST',
              body: JSON.stringify({
                classId: cls.id,
                centerLat: pos.coords.latitude,
                centerLng: pos.coords.longitude,
                clientOrigin: window.location.origin,
              }),
            },
            token
          );
          setActiveSession(data.session);
          setLiveRecords([]);
          setRemainingSeconds(120 * 60);
          setShowQrModal(true);
          setStatusMsg(`Live 100m geofence active for ${cls.courseName} (${cls.className})`);
        } catch (err) {
          setError(err.message);
          setStatusMsg('');
        }
      },
      () => {
        setError('Location permission denied. You must allow GPS so ZedDemoc can lock the 100m classroom radius.');
        setStatusMsg('');
      },
      { enableHighAccuracy: true }
    );
  }
  async function handleEndAndCompressSession() {
    if (!activeSession) return;
    try {
      const res = await apiRequest(`/sessions/${activeSession.id}/end`, { method: 'POST' }, token);
      setStatusMsg(`Session closed & safely compressed: ${res.archive?.fileName}`);
      setActiveSession(null);
      setShowQrModal(false);
      loadClassesAndArchives();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleOfflineSave(e) {
    e.preventDefault();
    if (!activeSession) return;
    try {
      await apiRequest(
        `/sessions/${activeSession.id}/offline-mark`,
        {
          method: 'POST',
          body: JSON.stringify({
            studentId: offlineStudentId,
            fullName: offlineFullName,
            status: offlineStatus,
          }),
        },
        token
      );
      setOfflineStudentId('');
      setOfflineFullName('');
      const data = await apiRequest(`/sessions/${activeSession.id}/live`, {}, token);
      setLiveRecords(data.session.records || []);
      setStatusMsg('Offline/manual attendance record updated.');
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleAskAi(customPrompt) {
    const queryText = customPrompt || aiPrompt;
    if (!queryText.trim()) return;
    setAiLoading(true);
    try {
      const res = await apiRequest('/ai/query', { method: 'POST', body: JSON.stringify({ prompt: queryText }) }, token);
      setAiResponse(res);
      if (!customPrompt) setAiPrompt('');
    } catch (err) {
      setError(err.message);
    } finally {
      setAiLoading(false);
    }
  }

  function handleWhatsAppShare() {
    if (!activeSession) return;
    const text = encodeURIComponent(
      `ZedDemoc Attendance (${activeSession.class.courseName} - ${activeSession.class.className}):\n` +
        `Open within 100m of the lecture hall (expires in 120 mins):\n${activeSession.fallbackUrl}`
    );
    window.open(`https://wa.me/?text=${text}`, '_blank');
  }

  if (showWizard) {
    return (
      <div style={{ maxWidth: '960px', margin: '0 auto', padding: '20px' }}>
        <ClassSetupWizard
          token={token}
          existingCount={classes.length}
          onComplete={() => {
            setShowWizard(false);
            loadClassesAndArchives();
          }}
        />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '20px' }}>
      <div className="glass-card" style={{ padding: '18px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '22px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ margin: 0, color: '#0369a1', fontSize: '1.5rem' }}>ZedDemoc Lecturer Portal</h1>
          <p style={{ margin: '4px 0 0', color: '#475569', fontSize: '0.9rem' }}>
            Welcome, <strong>{lecturer.fullName}</strong> ({lecturer.email})
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          {classes.length < 5 && (
            <button className="btn-secondary" onClick={() => setShowWizard(true)}>
              <PlusCircle size={16} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
              Add Class ({classes.length}/5)
            </button>
          )}
          <button className="btn-secondary" onClick={onLogout}>
            <LogOut size={16} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
            Logout
          </button>
        </div>
      </div>

      {error && <div style={{ background: '#fee2e2', color: '#b91c1c', padding: '12px 16px', borderRadius: '10px', marginBottom: '16px' }}>{error}</div>}
      {statusMsg && <div style={{ background: '#e0f2fe', color: '#0369a1', padding: '12px 16px', borderRadius: '10px', marginBottom: '16px', fontWeight: 600 }}>{statusMsg}</div>}

      <div className="glass-card" style={{ padding: '22px', marginBottom: '22px' }}>
        <h2 style={{ margin: '0 0 6px', color: '#0c4a6e', fontSize: '1.15rem' }}>
          Select a Class to Generate Live QR Code ({classes.length}/5 Registered)
        </h2>
        <p style={{ margin: '0 0 16px', color: '#64748b', fontSize: '0.88rem' }}>
          Clicking a class locks your current GPS as the 100m geofence center and starts the 120-minute QR timer.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
          {classes.map((cls) => (
            <div key={cls.id} style={{ border: '1px solid #7dd3fc', background: '#f8fafc', borderRadius: '12px', padding: '16px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '12px' }}>
              <div>
                <span className="badge badge-attending">Year {cls.yearOfStudy}</span>
                <h3 style={{ margin: '8px 0 4px', color: '#0f172a', fontSize: '1.05rem' }}>{cls.courseName}</h3>
                <p style={{ margin: 0, color: '#475569', fontSize: '0.88rem' }}>{cls.className}</p>
              </div>
              <button className="btn-primary" onClick={() => handleSelectClassToBroadcast(cls)}>
                <QrCode size={16} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
                Start & Beam QR
              </button>
            </div>
          ))}
        </div>
      </div>

      {activeSession && (
        <div className="glass-card" style={{ padding: '22px', marginBottom: '22px', border: '2px solid #0284c7' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
            <div>
              <span className="badge badge-attended">LIVE 100M GEOFENCE ACTIVE</span>
              <h2 style={{ margin: '6px 0 2px', color: '#0c4a6e' }}>{activeSession.class.courseName} — {activeSession.class.className}</h2>
              <p style={{ margin: 0, color: '#0369a1', fontWeight: 700, fontSize: '1.1rem' }}>QR Expiration Countdown: {formatCountdown(remainingSeconds)}</p>
            </div>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <button className="btn-secondary" onClick={() => setShowQrModal(true)}><QrCode size={16} style={{ verticalAlign: 'middle', marginRight: '6px' }} />Show QR Popup</button>
              <button className="btn-whatsapp" onClick={handleWhatsAppShare}><Share2 size={16} style={{ verticalAlign: 'middle', marginRight: '6px' }} />Share via WhatsApp</button>
              <button className="btn-primary" style={{ background: '#dc2626' }} onClick={handleEndAndCompressSession}>End & Compress Daily File</button>
            </div>
          </div>

          <h3 style={{ margin: '14px 0 10px', color: '#0f172a', fontSize: '1rem' }}>
            <Users size={16} style={{ verticalAlign: 'middle', marginRight: '6px' }} />Live Student Register ({liveRecords.length} Recorded)
          </h3>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ background: '#e0f2fe', textAlign: 'left' }}>
                  <th style={{ padding: '10px' }}>Student ID</th>
                  <th style={{ padding: '10px' }}>Full Name</th>
                  <th style={{ padding: '10px' }}>Check-In Time</th>
                  <th style={{ padding: '10px' }}>Mins In Range</th>
                  <th style={{ padding: '10px' }}>Out of Range</th>
                  <th style={{ padding: '10px' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {liveRecords.length === 0 ? (
                  <tr><td colSpan="6" style={{ padding: '14px', textAlign: 'center', color: '#64748b' }}>Waiting for students within 100m to scan QR code or open physical link...</td></tr>
                ) : (
                  liveRecords.map((rec) => (
                    <tr key={rec.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                      <td style={{ padding: '10px', fontWeight: 600 }}>{rec.student.studentId}</td>
                      <td style={{ padding: '10px' }}>{rec.student.fullName}</td>
                      <td style={{ padding: '10px' }}>{new Date(rec.checkInTime).toLocaleTimeString()}</td>
                      <td style={{ padding: '10px' }}>{rec.totalMinutesInRange} mins</td>
                      <td style={{ padding: '10px' }}>{rec.minutesOutOfRange} mins</td>
                      <td style={{ padding: '10px' }}><span className={`badge badge-${rec.status.toLowerCase()}`}>{rec.status}</span></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid #bae6fd' }}>
            <h4 style={{ margin: '0 0 10px', color: '#0369a1', fontSize: '0.95rem' }}>
              <WifiOff size={15} style={{ verticalAlign: 'middle', marginRight: '6px' }} />Offline / Manual Lecturer Attendance Override
            </h4>
            <form onSubmit={handleOfflineSave} style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <input className="input-field" style={{ flex: '1 1 160px' }} placeholder="Student ID" value={offlineStudentId} onChange={(e) => setOfflineStudentId(e.target.value)} required />
              <input className="input-field" style={{ flex: '2 1 220px' }} placeholder="Student Full Name" value={offlineFullName} onChange={(e) => setOfflineFullName(e.target.value)} required />
              <select className="input-field" style={{ flex: '1 1 140px' }} value={offlineStatus} onChange={(e) => setOfflineStatus(e.target.value)}>
                <option value="ATTENDED">ATTENDED</option>
                <option value="ATTENDING">ATTENDING</option>
                <option value="ABSENT">ABSENT</option>
              </select>
              <button type="submit" className="btn-secondary">Save Record</button>
            </form>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '20px' }}>
        <div className="glass-card" style={{ padding: '22px' }}>
          <h2 style={{ margin: '0 0 8px', color: '#0c4a6e', fontSize: '1.1rem' }}><Bot size={18} style={{ verticalAlign: 'middle', marginRight: '8px' }} />ZedDemoc Lecturer AI Analytics</h2>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
            <button className="btn-secondary" style={{ fontSize: '0.78rem', padding: '6px 10px' }} onClick={() => handleAskAi('Show full attendance summary')}>Full Summary</button>
            <button className="btn-secondary" style={{ fontSize: '0.78rem', padding: '6px 10px' }} onClick={() => handleAskAi('Compare 50 vs 60 minutes attended')}>50 vs 60 Mins</button>
            <button className="btn-secondary" style={{ fontSize: '0.78rem', padding: '6px 10px' }} onClick={() => handleAskAi('Who left for more than 15 mins vs briefly under 15 mins?')}>15-Min Proximity</button>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
            <input className="input-field" placeholder="Ask ZedDemoc AI..." value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} />
            <button className="btn-primary" onClick={() => handleAskAi()} disabled={aiLoading}>{aiLoading ? '...' : 'Ask'}</button>
          </div>
          {aiResponse && <div style={{ background: '#f0f9ff', border: '1px solid #7dd3fc', borderRadius: '10px', padding: '14px', fontSize: '0.88rem', whiteSpace: 'pre-line', color: '#0c4a6e' }}>{aiResponse.answer}</div>}
        </div>

        <div className="glass-card" style={{ padding: '22px' }}>
          <h2 style={{ margin: '0 0 8px', color: '#0c4a6e', fontSize: '1.1rem' }}><Archive size={18} style={{ verticalAlign: 'middle', marginRight: '8px' }} />Compressed Daily Attendance Files</h2>
          {archives.length === 0 ? (
            <p style={{ color: '#64748b', fontSize: '0.88rem' }}>No compressed session archives yet.</p>
          ) : (
            <div style={{ display: 'grid', gap: '10px' }}>
              {archives.map((arc) => (
                <div key={arc.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '10px 12px', borderRadius: '10px', border: '1px solid #bae6fd' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.88rem', color: '#0f172a' }}>{arc.fileName}</div>
                    <div style={{ fontSize: '0.78rem', color: '#64748b' }}>{new Date(arc.createdAt).toDateString()} • Year {arc.calendarYear}</div>
                  </div>
                  <a href={`http://localhost:5000/api/sessions/archives/${arc.id}/download`} target="_blank" rel="noreferrer" className="btn-secondary" style={{ textDecoration: 'none', fontSize: '0.8rem', padding: '6px 12px' }}>Download ZIP</a>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showQrModal && activeSession && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', zIndex: 50 }}>
          <div className="glass-card" style={{ background: '#ffffff', maxWidth: '440px', width: '100%', padding: '26px', textAlign: 'center', position: 'relative' }}>
            <button onClick={() => setShowQrModal(false)} style={{ position: 'absolute', top: '14px', right: '14px', background: 'none', border: 'none', cursor: 'pointer', color: '#475569' }}><X size={22} /></button>
            <span className="badge badge-attending">100M RADIUS ONLY</span>
            <h2 style={{ margin: '10px 0 4px', color: '#0c4a6e' }}>{activeSession.class.courseName}</h2>
            <p style={{ margin: '0 0 14px', color: '#475569', fontSize: '0.9rem' }}>{activeSession.class.className} • Expires in <strong>{formatCountdown(remainingSeconds)}</strong></p>
            <img src={activeSession.qrCodeData} alt="ZedDemoc QR" style={{ width: '250px', height: '250px', border: '4px solid #bae6fd', borderRadius: '14px', marginBottom: '12px' }} />
            <div style={{ background: '#f0f9ff', padding: '10px', borderRadius: '8px', fontSize: '0.8rem', wordBreak: 'break-all', color: '#0369a1', marginBottom: '14px' }}>
              <strong>Fallback Physical Link:</strong><br />
              <a href={activeSession.fallbackUrl} target="_blank" rel="noreferrer" style={{ color: '#0284c7' }}>{activeSession.fallbackUrl}</a>
            </div>
            <button className="btn-whatsapp" style={{ width: '100%' }} onClick={handleWhatsAppShare}><Share2 size={16} style={{ verticalAlign: 'middle', marginRight: '6px' }} />Share QR Link via WhatsApp</button>
          </div>
        </div>
      )}
    </div>
  );
}
