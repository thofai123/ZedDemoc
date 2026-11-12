import React, { useState, useEffect } from 'react';
import { MapPin, CheckCircle2, Clock, AlertTriangle } from 'lucide-react';
import { apiRequest, formatCountdown } from '../api';

export default function StudentPortal({ sessionToken }) {
  const [coords, setCoords] = useState(null);
  const [sessionInfo, setSessionInfo] = useState(null);
  const [gateError, setGateError] = useState('');
  const [checkingGate, setCheckingGate] = useState(true);

  const [isFirstTime, setIsFirstTime] = useState(false);
  const [studentId, setStudentId] = useState('');
  const [fullName, setFullName] = useState('');
  const [pin, setPin] = useState('');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [checkedInRecord, setCheckedInRecord] = useState(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [pingStatus, setPingStatus] = useState(null);
  const [checkedOutMessage, setCheckedOutMessage] = useState('');

  useEffect(() => {
    if (!sessionToken) {
      setGateError('Access Restricted: Students can only access ZedDemoc by scanning an active class QR code or opening the session link.');
      setCheckingGate(false);
      return;
    }
    if (!navigator.geolocation) {
      setGateError('Location services are required by ZedDemoc.');
      setCheckingGate(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setCoords({ lat, lng });
        try {
          const data = await apiRequest(`/students/session/${sessionToken}?lat=${lat}&lng=${lng}`);
          setSessionInfo(data);
          setRemainingSeconds(data.remainingSeconds);
        } catch (err) {
          setGateError(err.message);
        } finally {
          setCheckingGate(false);
        }
      },
      () => {
        setGateError('Location Permission Denied: You must grant GPS location consent to register or log in.');
        setCheckingGate(false);
      },
      { enableHighAccuracy: true }
    );
  }, [sessionToken]);

  useEffect(() => {
    if (!checkedInRecord || checkedOutMessage) return;
    const timerTick = setInterval(() => setRemainingSeconds((prev) => (prev > 0 ? prev - 1 : 0)), 1000);
    const ping13Min = setInterval(() => sendBackgroundPing('INTERVAL_13M'), 13 * 60 * 1000);
    const randomCheck = setTimeout(() => sendBackgroundPing('RANDOM_CHECK'), (6 + Math.floor(Math.random() * 5)) * 60 * 1000);

    return () => {
      clearInterval(timerTick);
      clearInterval(ping13Min);
      clearTimeout(randomCheck);
    };
  }, [checkedInRecord, checkedOutMessage]);

  function sendBackgroundPing(pingType = 'INTERVAL_13M') {
    if (!checkedInRecord || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const res = await apiRequest('/students/ping', {
            method: 'POST',
            body: JSON.stringify({ recordId: checkedInRecord.recordId, lat: pos.coords.latitude, lng: pos.coords.longitude, pingType }),
          });
          setPingStatus(res);
          if (res.status === 'ABSENT') setGateError('Attendance Cancelled: You left the 100m classroom range for more than 15 minutes.');
        } catch (err) {
          console.error(err);
        }
      },
      null,
      { enableHighAccuracy: true }
    );
  }

  async function handleStudentSubmit(e) {
    e.preventDefault();
    setFormError('');
    setSubmitting(true);
    try {
      const res = await apiRequest('/students/checkin', {
        method: 'POST',
        body: JSON.stringify({ sessionToken, studentId, fullName, pin, lat: coords.lat, lng: coords.lng, isFirstTime }),
      });
      setCheckedInRecord(res);
      setRemainingSeconds(res.remainingSeconds);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleManualCheckout() {
    if (!navigator.geolocation || !checkedInRecord) return;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const res = await apiRequest('/students/checkout', {
            method: 'POST',
            body: JSON.stringify({ recordId: checkedInRecord.recordId, lat: pos.coords.latitude, lng: pos.coords.longitude }),
          });
          setCheckedOutMessage(res.message);
        } catch (err) {
          setFormError(err.message);
        }
      },
      () => setFormError('Location permission required to confirm attendance and log out.'),
      { enableHighAccuracy: true }
    );
  }

  if (checkingGate) {
    return (
      <div className="glass-card" style={{ maxWidth: '460px', margin: '60px auto', padding: '30px', textAlign: 'center' }}>
        <MapPin size={32} color="#0284c7" style={{ marginBottom: '10px' }} />
        <h2 style={{ margin: '0 0 8px', color: '#0c4a6e' }}>Verifying 100m Classroom Proximity...</h2>
        <p style={{ margin: 0, color: '#475569' }}>Please allow location permission when prompted.</p>
      </div>
    );
  }

  if (gateError) {
    return (
      <div className="glass-card" style={{ maxWidth: '460px', margin: '60px auto', padding: '30px', textAlign: 'center', borderColor: '#fca5a5' }}>
        <AlertTriangle size={36} color="#dc2626" style={{ marginBottom: '10px' }} />
        <h2 style={{ margin: '0 0 8px', color: '#991b1b' }}>ZedDemoc Access Blocked</h2>
        <p style={{ margin: 0, color: '#7f1d1d', lineHeight: 1.5 }}>{gateError}</p>
      </div>
    );
  }

  if (checkedOutMessage) {
    return (
      <div className="glass-card" style={{ maxWidth: '460px', margin: '60px auto', padding: '30px', textAlign: 'center' }}>
        <CheckCircle2 size={42} color="#16a34a" style={{ marginBottom: '10px' }} />
        <h2 style={{ margin: '0 0 8px', color: '#14532d' }}>Attendance Completed</h2>
        <p style={{ margin: 0, color: '#166534' }}>{checkedOutMessage}</p>
      </div>
    );
  }

  if (checkedInRecord) {
    return (
      <div className="glass-card" style={{ maxWidth: '480px', margin: '48px auto', padding: '30px', textAlign: 'center' }}>
        <CheckCircle2 size={44} color="#16a34a" style={{ marginBottom: '10px' }} />
        <h2 style={{ margin: '0 0 10px', color: '#0c4a6e', fontSize: '1.25rem' }}>{checkedInRecord.message}</h2>
        <p style={{ margin: '0 0 18px', color: '#475569', fontSize: '0.92rem' }}>Student: <strong>{checkedInRecord.studentName}</strong> • {sessionInfo.courseName}</p>
        <div style={{ background: '#e0f2fe', padding: '14px', borderRadius: '12px', marginBottom: '16px' }}>
          <div style={{ fontSize: '0.82rem', color: '#0369a1', fontWeight: 600 }}><Clock size={14} style={{ verticalAlign: 'middle', marginRight: '4px' }} />Session Expiration Timer</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#0c4a6e', marginTop: '4px' }}>{formatCountdown(remainingSeconds)}</div>
        </div>
        {pingStatus && (
          <div style={{ background: '#f0fdf4', border: '1px solid #86efac', padding: '10px', borderRadius: '10px', fontSize: '0.84rem', color: '#166534', marginBottom: '14px' }}>
            Last Ping: {pingStatus.distanceMeters}m from lecturer • Minutes in range: <strong>{pingStatus.totalMinutesInRange}m</strong>
          </div>
        )}
        {formError && <div style={{ background: '#fee2e2', color: '#b91c1c', padding: '10px', borderRadius: '8px', marginBottom: '12px', fontSize: '0.86rem' }}>{formError}</div>}
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
          <button className="btn-secondary" onClick={() => sendBackgroundPing('MANUAL_TEST_PING')}>Send Coordinate Ping Now</button>
          <button className="btn-primary" onClick={handleManualCheckout}>Mark Attended & Log Out (50m+)</button>
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card" style={{ maxWidth: '460px', margin: '40px auto', padding: '28px' }}>
      <span className="badge badge-attended">Within Range ({sessionInfo.distanceMeters}m / 100m max)</span>
      <h2 style={{ margin: '10px 0 4px', color: '#0c4a6e' }}>{sessionInfo.courseName} ({sessionInfo.className})</h2>
      <p style={{ margin: '0 0 18px', color: '#475569', fontSize: '0.88rem' }}>Session Timer: <strong>{formatCountdown(remainingSeconds)}</strong></p>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '18px' }}>
        <button type="button" className={!isFirstTime ? 'btn-primary' : 'btn-secondary'} style={{ flex: 1 }} onClick={() => setIsFirstTime(false)}>Returning Student</button>
        <button type="button" className={isFirstTime ? 'btn-primary' : 'btn-secondary'} style={{ flex: 1 }} onClick={() => setIsFirstTime(true)}>First-Time Registration</button>
      </div>
      {formError && <div style={{ background: '#fee2e2', color: '#b91c1c', padding: '10px', borderRadius: '8px', marginBottom: '14px', fontSize: '0.88rem' }}>{formError}</div>}
      <form onSubmit={handleStudentSubmit} style={{ display: 'grid', gap: '14px' }}>
        {isFirstTime && (
          <div>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: '6px', fontSize: '0.88rem' }}>Full Name</label>
            <input className="input-field" placeholder="Enter your full name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          </div>
        )}
        <div>
          <label style={{ display: 'block', fontWeight: 600, marginBottom: '6px', fontSize: '0.88rem' }}>Unique Student ID</label>
          <input className="input-field" placeholder="e.g., 202145892" value={studentId} onChange={(e) => setStudentId(e.target.value)} required />
        </div>
        <div>
          <label style={{ display: 'block', fontWeight: 600, marginBottom: '6px', fontSize: '0.88rem' }}>PIN Password (Max 6 letters/numbers)</label>
          <input type="password" maxLength={6} className="input-field" placeholder="Up to 6 characters" value={pin} onChange={(e) => setPin(e.target.value)} required />
        </div>
        <button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Verifying...' : isFirstTime ? 'Register & Check In' : 'Log In & Mark Attending'}</button>
      </form>
    </div>
  );
}
