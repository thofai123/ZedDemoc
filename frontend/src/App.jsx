import React, { useState, useEffect } from 'react';
import { ShieldCheck, MapPin, QrCode, Bot } from 'lucide-react';
import { apiRequest } from './api';
import LecturerDashboard from './components/LecturerDashboard';
import StudentPortal from './components/StudentPortal';
import Footer from './components/Footer';

export default function App() {
  const params = new URLSearchParams(window.location.search);
  const studentToken = params.get('token');
  const isStudentRoute = window.location.pathname.startsWith('/student') || Boolean(studentToken);

  const [authMode, setAuthMode] = useState('login');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const [token, setToken] = useState(() => localStorage.getItem('zeddemoc_token'));
  const [lecturer, setLecturer] = useState(() => {
    const saved = localStorage.getItem('zeddemoc_lecturer');
    return saved ? JSON.parse(saved) : null;
  });
  const [calendarYear, setCalendarYear] = useState(2026);

  useEffect(() => {
    apiRequest('/health').then((res) => setCalendarYear(res.calendarYear)).catch(() => {});
  }, []);

  async function handleLecturerAuth(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const endpoint = authMode === 'register' ? '/auth/register' : '/auth/login';
      const payload = authMode === 'register' ? { fullName, email, password } : { email, password };
      const data = await apiRequest(endpoint, { method: 'POST', body: JSON.stringify(payload) });
      localStorage.setItem('zeddemoc_token', data.token);
      localStorage.setItem('zeddemoc_lecturer', JSON.stringify(data.lecturer));
      setToken(data.token);
      setLecturer(data.lecturer);
      setCalendarYear(data.calendarYear);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleLogout() {
    localStorage.removeItem('zeddemoc_token');
    localStorage.removeItem('zeddemoc_lecturer');
    setToken(null);
    setLecturer(null);
  }

  if (isStudentRoute) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div>
          <header style={{ textAlign: 'center', paddingTop: '24px' }}>
            <h1 style={{ margin: 0, color: '#0369a1', letterSpacing: '1px' }}>ZedDemoc</h1>
            <p style={{ margin: '4px 0 0', color: '#0284c7', fontSize: '0.88rem', fontWeight: 600 }}>Geofenced Student Attendance Portal</p>
          </header>
          <StudentPortal sessionToken={studentToken} />
        </div>
        <Footer calendarYear={calendarYear} />
      </div>
    );
  }

  if (token && lecturer) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <LecturerDashboard token={token} lecturer={lecturer} onLogout={handleLogout} />
        <Footer calendarYear={calendarYear} />
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
      <main style={{ maxWidth: '1040px', margin: '0 auto', padding: '40px 20px', width: '100%' }}>
        <div style={{ textAlign: 'center', marginBottom: '36px' }}>
          <span className="badge badge-attending" style={{ marginBottom: '10px' }}>Zambia Smart Classroom Attendance Demo</span>
          <h1 style={{ margin: '0 0 10px', fontSize: '2.6rem', color: '#0c4a6e', letterSpacing: '-0.5px' }}>ZedDemoc</h1>
          <p style={{ margin: '0 auto', maxWidth: '620px', color: '#334155', fontSize: '1.05rem', lineHeight: 1.5 }}>
            100-meter geofenced QR attendance with automated proximity verification, daily compressed records, and embedded lecturer AI analytics.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '28px', alignItems: 'start' }}>
          <div className="glass-card" style={{ padding: '28px' }}>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
              <button type="button" className={authMode === 'login' ? 'btn-primary' : 'btn-secondary'} style={{ flex: 1 }} onClick={() => { setAuthMode('login'); setError(''); }}>Lecturer Login</button>
              <button type="button" className={authMode === 'register' ? 'btn-primary' : 'btn-secondary'} style={{ flex: 1 }} onClick={() => { setAuthMode('register'); setError(''); }}>Register Account</button>
            </div>
            <p style={{ margin: '0 0 14px', fontSize: '0.84rem', color: '#0369a1', fontWeight: 600 }}>Restricted to @gmail.com, @outlook.com, or @yahoo.com emails only.</p>
            {error && <div style={{ background: '#fee2e2', color: '#b91c1c', padding: '10px', borderRadius: '8px', marginBottom: '14px', fontSize: '0.88rem' }}>{error}</div>}
            <form onSubmit={handleLecturerAuth} style={{ display: 'grid', gap: '14px' }}>
              {authMode === 'register' && (
                <div>
                  <label style={{ display: 'block', fontWeight: 600, marginBottom: '6px', fontSize: '0.88rem' }}>Lecturer Full Name</label>
                  <input className="input-field" placeholder="e.g., Dr. Lighton Phiri" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
                </div>
              )}
              <div>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: '6px', fontSize: '0.88rem' }}>Email (Gmail, Outlook, or Yahoo only)</label>
                <input type="email" className="input-field" placeholder="lecturer@gmail.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: '6px', fontSize: '0.88rem' }}>Password</label>
                <input type="password" className="input-field" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </div>
              <button type="submit" className="btn-primary" disabled={loading}>
                {loading ? 'Please wait...' : authMode === 'register' ? 'Create Lecturer Account' : 'Access Lecturer Dashboard'}
              </button>
            </form>
          </div>

          <div className="glass-card" style={{ padding: '28px', display: 'grid', gap: '16px' }}>
            <h3 style={{ margin: 0, color: '#0c4a6e' }}>How ZedDemoc Works</h3>
            <div style={{ display: 'flex', gap: '12px' }}><MapPin color="#0284c7" size={22} style={{ flexShrink: 0 }} /><div><strong style={{ color: '#0f172a' }}>Strict 100-Meter Radius</strong><p style={{ margin: '2px 0 0', fontSize: '0.88rem', color: '#475569' }}>Only students within 100m of the lecture hall can scan or access the session link. Leaving for over 15 minutes cancels attendance.</p></div></div>
            <div style={{ display: 'flex', gap: '12px' }}><QrCode color="#0284c7" size={22} style={{ flexShrink: 0 }} /><div><strong style={{ color: '#0f172a' }}>120-Minute QR & 13-Minute Pings</strong><p style={{ margin: '2px 0 0', fontSize: '0.88rem', color: '#475569' }}>Unique QR codes expire after 120 minutes. Background pings verify attendance every 13 minutes until 50–60 minutes elapse.</p></div></div>
            <div style={{ display: 'flex', gap: '12px' }}><Bot color="#0284c7" size={22} style={{ flexShrink: 0 }} /><div><strong style={{ color: '#0f172a' }}>Embedded Lecturer AI & Daily ZIPs</strong><p style={{ margin: '2px 0 0', fontSize: '0.88rem', color: '#475569' }}>Query attendance averages, 15-minute departures, and 50/60-minute completions directly on your dashboard.</p></div></div>
            <div style={{ display: 'flex', gap: '12px' }}><ShieldCheck color="#0284c7" size={22} style={{ flexShrink: 0 }} /><div><strong style={{ color: '#0f172a' }}>Student-Only QR/Link Access</strong><p style={{ margin: '2px 0 0', fontSize: '0.88rem', color: '#475569' }}>Students scan the beamed QR code or tap the fallback link to register with Student ID + 6-character PIN.</p></div></div>
          </div>
        </div>
      </main>
      <Footer calendarYear={calendarYear} />
    </div>
  );
}
