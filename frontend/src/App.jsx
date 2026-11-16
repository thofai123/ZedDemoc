import React, { useState, useEffect } from 'react';
import { ShieldCheck, MapPin, QrCode, Bot, MailCheck, KeyRound } from 'lucide-react';
import { apiRequest } from './api';
import LecturerDashboard from './components/LecturerDashboard';
import StudentPortal from './components/StudentPortal';
import Footer from './components/Footer';

export default function App() {
  const params = new URLSearchParams(window.location.search);
  const studentToken = params.get('token');
  const isStudentRoute = window.location.pathname.startsWith('/student') || Boolean(studentToken);

  // 'login' | 'register' | 'forgot'
  const [authMode, setAuthMode] = useState('login');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);

  const [infoMsg, setInfoMsg] = useState('');
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

  function switchAuthMode(mode) {
    setAuthMode(mode);
    setError('');
    setInfoMsg('');
    setOtpCode('');
    setOtpSent(false);
  }

  async function handleSendOtp() {
    setError('');
    setInfoMsg('');
    if (!email.trim()) {
      setError('Please enter your @gmail.com, @outlook.com, or @yahoo.com email first.');
      return;
    }

    setSendingOtp(true);
    try {
      const purpose = authMode === 'forgot' ? 'RESET_PASSWORD' : 'REGISTER';
      const res = await apiRequest('/auth/send-otp', {
        method: 'POST',
        body: JSON.stringify({ email, purpose }),
      });
      setOtpSent(true);
      setInfoMsg(res.message);
      if (res.devCode) {
        setOtpCode(res.devCode);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSendingOtp(false);
    }
  }

  async function handleLecturerAuth(e) {
    e.preventDefault();
    setError('');
    setInfoMsg('');
    setLoading(true);

    try {
      if (authMode === 'forgot') {
        const res = await apiRequest('/auth/reset-password', {
          method: 'POST',
          body: JSON.stringify({ email, otpCode, newPassword: password }),
        });
        setInfoMsg(res.message);
        setAuthMode('login');
        setOtpCode('');
        setOtpSent(false);
        return;
      }

      const endpoint = authMode === 'register' ? '/auth/register' : '/auth/login';
      const payload =
        authMode === 'register'
          ? { fullName, email, password, otpCode }
          : { email, password };

      const data = await apiRequest(endpoint, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      // Trigger browser / Google Credential Management API save prompt if supported
      if (window.PasswordCredential) {
        try {
          const cred = new window.PasswordCredential({
            id: email.trim().toLowerCase(),
            password,
            name: data.lecturer.fullName,
          });
          await navigator.credentials.store(cred);
        } catch {
          // Standard form submission also triggers native browser password save prompt
        }
      }

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
            100-meter geofenced QR attendance with continuous proximity tracking, offline sync queues, daily compressed records, and embedded lecturer AI analytics.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '28px', alignItems: 'start' }}>
          <div className="glass-card" style={{ padding: '28px' }}>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
              <button
                type="button"
                className={authMode === 'login' ? 'btn-primary' : 'btn-secondary'}
                style={{ flex: 1 }}
                onClick={() => switchAuthMode('login')}
              >
                Lecturer Login
              </button>
              <button
                type="button"
                className={authMode === 'register' ? 'btn-primary' : 'btn-secondary'}
                style={{ flex: 1 }}
                onClick={() => switchAuthMode('register')}
              >
                Register Account
              </button>
            </div>

            <p style={{ margin: '0 0 14px', fontSize: '0.84rem', color: '#0369a1', fontWeight: 600 }}>
              Restricted to @gmail.com, @outlook.com, or @yahoo.com emails only.
            </p>

            {error && (
              <div style={{ background: '#fee2e2', color: '#b91c1c', padding: '10px', borderRadius: '8px', marginBottom: '14px', fontSize: '0.88rem' }}>
                {error}
              </div>
            )}
            {infoMsg && (
              <div style={{ background: '#dcfce7', color: '#15803d', padding: '10px', borderRadius: '8px', marginBottom: '14px', fontSize: '0.88rem', fontWeight: 600 }}>
                {infoMsg}
              </div>
            )}

            {/* Semantic form with standard autocomplete attributes for Google Password Manager autofill & save prompt */}
            <form onSubmit={handleLecturerAuth} autoComplete="on" style={{ display: 'grid', gap: '14px' }}>
              {authMode === 'register' && (
                <div>
                  <label htmlFor="lecturer-name" style={{ display: 'block', fontWeight: 600, marginBottom: '6px', fontSize: '0.88rem' }}>
                    Lecturer Full Name
                  </label>
                  <input
                    id="lecturer-name"
                    name="name"
                    type="text"
                    autoComplete="name"
                    className="input-field"
                    placeholder="e.g., Dr. Lighton Phiri"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                  />
                </div>
              )}

              <div>
                <label htmlFor="lecturer-email" style={{ display: 'block', fontWeight: 600, marginBottom: '6px', fontSize: '0.88rem' }}>
                  Email (Gmail, Outlook, or Yahoo only)
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    id="lecturer-email"
                    name="username"
                    type="email"
                    autoComplete="username email"
                    className="input-field"
                    placeholder="lecturer@gmail.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                  {(authMode === 'register' || authMode === 'forgot') && (
                    <button
                      type="button"
                      className="btn-secondary"
                      style={{ whiteSpace: 'nowrap', fontSize: '0.82rem' }}
                      onClick={handleSendOtp}
                      disabled={sendingOtp}
                    >
                      <MailCheck size={15} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                      {sendingOtp ? 'Sending...' : otpSent ? 'Resend Code' : 'Send Code'}
                    </button>
                  )}
                </div>
              </div>

              {(authMode === 'register' || authMode === 'forgot') && (
                <div>
                  <label htmlFor="email-otp" style={{ display: 'block', fontWeight: 600, marginBottom: '6px', fontSize: '0.88rem' }}>
                    6-Digit Email Verification Code
                  </label>
                  <input
                    id="email-otp"
                    name="one-time-code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    className="input-field"
                    placeholder="Enter 6-digit code sent to your email"
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value)}
                    required
                  />
                </div>
              )}

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <label htmlFor="lecturer-password" style={{ fontWeight: 600, fontSize: '0.88rem' }}>
                    {authMode === 'forgot' ? 'New Password' : 'Password'}
                  </label>
                  {authMode === 'login' && (
                    <button
                      type="button"
                      onClick={() => switchAuthMode('forgot')}
                      style={{ background: 'none', border: 'none', color: '#0284c7', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', padding: 0 }}
                    >
                      Forgot Password?
                    </button>
                  )}
                </div>
                <input
                  id="lecturer-password"
                  name="password"
                  type="password"
                  autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
                  className="input-field"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              <button type="submit" className="btn-primary" disabled={loading}>
                {loading
                  ? 'Please wait...'
                  : authMode === 'register'
                  ? 'Verify & Create Lecturer Account'
                  : authMode === 'forgot'
                  ? 'Verify Code & Reset Password'
                  : 'Access Lecturer Dashboard'}
              </button>

              {authMode === 'forgot' && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => switchAuthMode('login')}
                >
                  <KeyRound size={14} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
                  Back to Login
                </button>
              )}
            </form>
          </div>

          <div className="glass-card" style={{ padding: '28px', display: 'grid', gap: '16px' }}>
            <h3 style={{ margin: 0, color: '#0c4a6e' }}>How ZedDemoc Works</h3>
            <div style={{ display: 'flex', gap: '12px' }}><MapPin color="#0284c7" size={22} style={{ flexShrink: 0 }} /><div><strong style={{ color: '#0f172a' }}>Continuous 100-Meter Tracking</strong><p style={{ margin: '2px 0 0', fontSize: '0.88rem', color: '#475569' }}>Live GPS watch tracks attendees continuously. Leaving the 100m perimeter for more than 15 minutes automatically cancels attendance.</p></div></div>
            <div style={{ display: 'flex', gap: '12px' }}><QrCode color="#0284c7" size={22} style={{ flexShrink: 0 }} /><div><strong style={{ color: '#0f172a' }}>50-Minute Lock & Offline Sync Queue</strong><p style={{ margin: '2px 0 0', fontSize: '0.88rem', color: '#475569' }}>Attendees remain locked in until 50 real minutes elapse. If the device goes offline, GPS pings queue locally and sync automatically upon reconnection.</p></div></div>
            <div style={{ display: 'flex', gap: '12px' }}><Bot color="#0284c7" size={22} style={{ flexShrink: 0 }} /><div><strong style={{ color: '#0f172a' }}>Embedded Lecturer AI & Daily ZIPs</strong><p style={{ margin: '2px 0 0', fontSize: '0.88rem', color: '#475569' }}>Query attendance averages, 15-minute departures, and 50/60-minute completions directly on your dashboard.</p></div></div>
            <div style={{ display: 'flex', gap: '12px' }}><ShieldCheck color="#0284c7" size={22} style={{ flexShrink: 0 }} /><div><strong style={{ color: '#0f172a' }}>Verified Lecturer Access</strong><p style={{ margin: '2px 0 0', fontSize: '0.88rem', color: '#475569' }}>Email verification codes protect account creation and password resets while syncing smoothly with Google Password Manager.</p></div></div>
          </div>
        </div>
      </main>
      <Footer calendarYear={calendarYear} />
    </div>
  );
}
