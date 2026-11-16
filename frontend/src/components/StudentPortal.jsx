import React, { useState, useEffect, useRef } from 'react';
import { MapPin, CheckCircle2, Clock, AlertTriangle, Lock, Wifi, WifiOff } from 'lucide-react';
import { apiRequest, formatCountdown } from '../api';

const REQUIRED_ATTENDANCE_SECONDS = 50 * 60; // 50 minutes mandatory lock

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

  const [checkedInRecord, setCheckedInRecord] = useState(() => {
    const saved = localStorage.getItem(`zeddemoc_student_active_${sessionToken}`);
    return saved ? JSON.parse(saved) : null;
  });
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [sessionRemainingSeconds, setSessionRemainingSeconds] = useState(0);
  const [liveMetrics, setLiveMetrics] = useState({ distanceMeters: 0, totalMinutesInRange: 0, withinRange: true });
  const [queuedCount, setQueuedCount] = useState(() => {
    const q = localStorage.getItem('zeddemoc_ping_queue');
    return q ? JSON.parse(q).length : 0;
  });
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [checkedOutMessage, setCheckedOutMessage] = useState('');

  const lastSentTimestampRef = useRef(0);

  // Monitor online/offline status & flush queued GPS pings immediately on reconnect
  useEffect(() => {
    function handleOnline() {
      setIsOnline(true);
      flushOfflineQueue();
    }
    function handleOffline() {
      setIsOnline(false);
    }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [checkedInRecord]);

  // Initial 100m classroom proximity gate check
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
          setSessionRemainingSeconds(data.remainingSeconds);
        } catch (err) {
          if (!checkedInRecord) setGateError(err.message);
        } finally {
          setCheckingGate(false);
        }
      },
      () => {
        if (!checkedInRecord) {
          setGateError('Location Permission Denied: You must grant GPS location consent to register or log in.');
        }
        setCheckingGate(false);
      },
      { enableHighAccuracy: true }
    );
  }, [sessionToken]);

  // Queue a GPS ping locally if offline, or transmit immediately if online
  async function recordOrQueuePing(lat, lng, pingType = 'CONTINUOUS_WATCH') {
    if (!checkedInRecord) return;

    const payload = {
      recordId: checkedInRecord.recordId,
      lat,
      lng,
      pingType,
      recordedAt: new Date().toISOString(),
    };

    if (!navigator.onLine) {
      const existing = JSON.parse(localStorage.getItem('zeddemoc_ping_queue') || '[]');
      existing.push(payload);
      localStorage.setItem('zeddemoc_ping_queue', JSON.stringify(existing));
      setQueuedCount(existing.length);
      return;
    }

    try {
      // First flush any pending offline items if present
      await flushOfflineQueue();

      const res = await apiRequest('/students/ping', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setLiveMetrics(res);

      if (res.status === 'ABSENT') {
        localStorage.removeItem(`zeddemoc_student_active_${sessionToken}`);
        setGateError('Attendance Cancelled: Continuous tracking detected you left the 100m classroom vicinity for more than 15 minutes.');
      } else if (res.status === 'ATTENDED') {
        localStorage.removeItem(`zeddemoc_student_active_${sessionToken}`);
        setCheckedOutMessage(`Attendance completed (${res.totalMinutesInRange} real minutes verified). You have been logged out.`);
      }
    } catch {
      // Network hiccup: save to offline queue so nothing is lost
      const existing = JSON.parse(localStorage.getItem('zeddemoc_ping_queue') || '[]');
      existing.push(payload);
      localStorage.setItem('zeddemoc_ping_queue', JSON.stringify(existing));
      setQueuedCount(existing.length);
    }
  }

  async function flushOfflineQueue() {
    const existing = JSON.parse(localStorage.getItem('zeddemoc_ping_queue') || '[]');
    if (existing.length === 0) return;

    try {
      const recordId = existing[0].recordId;
      const syncRes = await apiRequest('/students/sync-pings', {
        method: 'POST',
        body: JSON.stringify({ recordId, pings: existing }),
      });
      localStorage.removeItem('zeddemoc_ping_queue');
      setQueuedCount(0);

      if (syncRes.latest) {
        setLiveMetrics(syncRes.latest);
        if (syncRes.latest.status === 'ABSENT') {
          localStorage.removeItem(`zeddemoc_student_active_${sessionToken}`);
          setGateError('Attendance Cancelled: Offline tracking logs showed you were outside the 100m range for over 15 minutes.');
        }
      }
    } catch {
      // Keep in queue until connection stabilizes
    }
  }

  // Continuous Background Timer (50-min lock) + Continuous GPS watchPosition
  useEffect(() => {
    if (!checkedInRecord || checkedOutMessage || gateError) return;

    const timerTick = setInterval(() => {
      const checkInMs = new Date(checkedInRecord.checkInTime).getTime();
      const nowMs = Date.now();
      const elapsed = Math.max(0, Math.floor((nowMs - checkInMs) / 1000));
      setElapsedSeconds(elapsed);

      if (checkedInRecord.expiresAt) {
        const rem = Math.max(0, Math.floor((new Date(checkedInRecord.expiresAt).getTime() - nowMs) / 1000));
        setSessionRemainingSeconds(rem);
      }
    }, 1000);

    // Continuous GPS tracking: fires whenever device moves or every 60 seconds
    let watchId = null;
    if (navigator.geolocation) {
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const now = Date.now();
          // Throttle server transmissions to once every 60 seconds (or immediately if distance shifts)
          if (now - lastSentTimestampRef.current >= 60 * 1000) {
            lastSentTimestampRef.current = now;
            recordOrQueuePing(pos.coords.latitude, pos.coords.longitude, 'CONTINUOUS_WATCH');
          }
        },
        null,
        { enableHighAccuracy: true, maximumAge: 30000, timeout: 20000 }
      );
    }

    // Periodic 13-minute heartbeat backup in case device remains completely stationary
    const heartbeat13Min = setInterval(() => {
      navigator.geolocation.getCurrentPosition(
        (pos) => recordOrQueuePing(pos.coords.latitude, pos.coords.longitude, 'INTERVAL_13M'),
        null,
        { enableHighAccuracy: true }
      );
    }, 13 * 60 * 1000);

    return () => {
      clearInterval(timerTick);
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      clearInterval(heartbeat13Min);
    };
  }, [checkedInRecord, checkedOutMessage, gateError]);

  async function handleStudentSubmit(e) {
    e.preventDefault();
    setFormError('');
    setSubmitting(true);
    try {
      const res = await apiRequest('/students/checkin', {
        method: 'POST',
        body: JSON.stringify({ sessionToken, studentId, fullName, pin, lat: coords.lat, lng: coords.lng, isFirstTime }),
      });
      localStorage.setItem(`zeddemoc_student_active_${sessionToken}`, JSON.stringify(res));
      setCheckedInRecord(res);
      setSessionRemainingSeconds(res.remainingSeconds);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleManualCheckout() {
    if (elapsedSeconds < REQUIRED_ATTENDANCE_SECONDS) return;
    if (!navigator.geolocation || !checkedInRecord) return;

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          await flushOfflineQueue();
          const res = await apiRequest('/students/checkout', {
            method: 'POST',
            body: JSON.stringify({ recordId: checkedInRecord.recordId, lat: pos.coords.latitude, lng: pos.coords.longitude }),
          });
          localStorage.removeItem(`zeddemoc_student_active_${sessionToken}`);
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
    const lockRemainingSeconds = Math.max(0, REQUIRED_ATTENDANCE_SECONDS - elapsedSeconds);
    const isUnlocked = lockRemainingSeconds === 0;

    return (
      <div className="glass-card" style={{ maxWidth: '480px', margin: '40px auto', padding: '28px', textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginBottom: '12px' }}>
          <span className="badge badge-attended">CONTINUOUS GPS LOCK ACTIVE</span>
          <span className="badge" style={{ background: isOnline ? '#dcfce7' : '#fef3c7', color: isOnline ? '#15803d' : '#b45309' }}>
            {isOnline ? <><Wifi size={12} style={{ verticalAlign: 'middle' }} /> Online</> : <><WifiOff size={12} style={{ verticalAlign: 'middle' }} /> Offline Queue ({queuedCount})</>}
          </span>
        </div>

        <CheckCircle2 size={40} color="#16a34a" style={{ marginBottom: '8px' }} />
        <h2 style={{ margin: '0 0 8px', color: '#0c4a6e', fontSize: '1.2rem' }}>{checkedInRecord.message}</h2>
        <p style={{ margin: '0 0 16px', color: '#475569', fontSize: '0.92rem' }}>
          Student: <strong>{checkedInRecord.studentName}</strong>
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '16px' }}>
          <div style={{ background: '#e0f2fe', padding: '12px', borderRadius: '12px' }}>
            <div style={{ fontSize: '0.78rem', color: '#0369a1', fontWeight: 700 }}>
              <Lock size={13} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
              {isUnlocked ? '50-Min Requirement Met' : 'Logout Unlocks In'}
            </div>
            <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#0c4a6e', marginTop: '4px' }}>
              {isUnlocked ? 'UNLOCKED' : formatCountdown(lockRemainingSeconds)}
            </div>
          </div>

          <div style={{ background: '#f0f9ff', padding: '12px', borderRadius: '12px', border: '1px solid #bae6fd' }}>
            <div style={{ fontSize: '0.78rem', color: '#0369a1', fontWeight: 700 }}>
              <Clock size={13} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
              Class Session Timer
            </div>
            <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#0c4a6e', marginTop: '4px' }}>
              {formatCountdown(sessionRemainingSeconds)}
            </div>
          </div>
        </div>

        <div style={{ background: '#f8fafc', border: '1px solid #bae6fd', padding: '10px', borderRadius: '10px', fontSize: '0.84rem', color: '#334155', marginBottom: '16px' }}>
          Real Time Attended: <strong>{Math.floor(elapsedSeconds / 60)} mins</strong> • Distance: <strong>{liveMetrics.distanceMeters}m</strong> / 100m max
          {queuedCount > 0 && (
            <div style={{ color: '#b45309', marginTop: '4px', fontWeight: 600 }}>
              {queuedCount} offline GPS ping(s) queued — will auto-sync immediately upon reconnection.
            </div>
          )}
        </div>

        {formError && (
          <div style={{ background: '#fee2e2', color: '#b91c1c', padding: '10px', borderRadius: '8px', marginBottom: '12px', fontSize: '0.86rem' }}>
            {formError}
          </div>
        )}

        <button
          className="btn-primary"
          style={{ width: '100%' }}
          disabled={!isUnlocked}
          onClick={handleManualCheckout}
        >
          {isUnlocked
            ? 'Confirm Attendance & Log Out'
            : `Locked Until 50 Mins Lapse (${Math.ceil(lockRemainingSeconds / 60)} mins left)`}
        </button>
      </div>
    );
  }

  return (
    <div className="glass-card" style={{ maxWidth: '460px', margin: '40px auto', padding: '28px' }}>
      <span className="badge badge-attended">Within Range ({sessionInfo.distanceMeters}m / 100m max)</span>
      <h2 style={{ margin: '10px 0 4px', color: '#0c4a6e' }}>{sessionInfo.courseName} ({sessionInfo.className})</h2>
      <p style={{ margin: '0 0 18px', color: '#475569', fontSize: '0.88rem' }}>Session Timer: <strong>{formatCountdown(sessionRemainingSeconds)}</strong></p>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '18px' }}>
        <button type="button" className={!isFirstTime ? 'btn-primary' : 'btn-secondary'} style={{ flex: 1 }} onClick={() => setIsFirstTime(false)}>Returning Student</button>
        <button type="button" className={isFirstTime ? 'btn-primary' : 'btn-secondary'} style={{ flex: 1 }} onClick={() => setIsFirstTime(true)}>First-Time Registration</button>
      </div>

      {formError && <div style={{ background: '#fee2e2', color: '#b91c1c', padding: '10px', borderRadius: '8px', marginBottom: '14px', fontSize: '0.88rem' }}>{formError}</div>}

      <form onSubmit={handleStudentSubmit} autoComplete="on" style={{ display: 'grid', gap: '14px' }}>
        {isFirstTime && (
          <div>
            <label htmlFor="student-fullname" style={{ display: 'block', fontWeight: 600, marginBottom: '6px', fontSize: '0.88rem' }}>Full Name</label>
            <input id="student-fullname" name="name" autoComplete="name" className="input-field" placeholder="Enter your full name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          </div>
        )}
        <div>
          <label htmlFor="student-id" style={{ display: 'block', fontWeight: 600, marginBottom: '6px', fontSize: '0.88rem' }}>Unique Student ID</label>
          <input id="student-id" name="username" autoComplete="username" className="input-field" placeholder="e.g., 202145892" value={studentId} onChange={(e) => setStudentId(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="student-pin" style={{ display: 'block', fontWeight: 600, marginBottom: '6px', fontSize: '0.88rem' }}>PIN Password (Max 6 letters/numbers)</label>
          <input id="student-pin" name="password" type="password" autoComplete="current-password" maxLength={6} className="input-field" placeholder="Up to 6 characters" value={pin} onChange={(e) => setPin(e.target.value)} required />
        </div>
        <button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Verifying...' : isFirstTime ? 'Register & Check In' : 'Log In & Mark Attending'}</button>
      </form>
    </div>
  );
}
