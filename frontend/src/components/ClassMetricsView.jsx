import React, { useState, useEffect } from 'react';
import { ArrowLeft, Calendar, Clock, Users, Download, CheckCircle2, QrCode } from 'lucide-react';
import { apiRequest } from '../api';

export default function ClassMetricsView({ token, classItem, onBack, onStartSession }) {
  const [metrics, setMetrics] = useState(null);
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function fetchMetrics() {
      setLoading(true);
      setError('');
      try {
        const data = await apiRequest(`/classes/${classItem.id}/metrics`, {}, token);
        setMetrics(data);
        if (data.sessions?.length > 0) {
          setSelectedSessionId(data.sessions[0].id);
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchMetrics();
  }, [classItem.id, token]);

  const activeDay = metrics?.sessions?.find((s) => s.id === selectedSessionId) || null;

  function handleExportCsv(sessionObj) {
    if (!sessionObj) return;
    const headers = ['Student ID', 'Full Name', 'Check-In Time', 'Check-Out Time', 'Mins In Range', 'Out of Range Mins', 'Status', 'Manual Edit'];
    const rows = sessionObj.records.map((r) => [
      r.student.studentId,
      `"${r.student.fullName.replace(/"/g, '""')}"`,
      new Date(r.checkInTime).toLocaleTimeString(),
      r.checkOutTime ? new Date(r.checkOutTime).toLocaleTimeString() : 'Still Active / Auto-Closed',
      r.totalMinutesInRange,
      r.minutesOutOfRange,
      r.status,
      r.manualLecturerEdit ? 'Yes' : 'No',
    ]);
    const csv = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${classItem.courseName.replace(/\s+/g, '_')}_${sessionObj.dateLabel.replace(/[^a-zA-Z0-9]/g, '_')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="glass-card" style={{ padding: '22px', marginBottom: '22px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button className="btn-secondary" onClick={onBack} style={{ padding: '8px 12px' }}>
            <ArrowLeft size={16} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
            All Classes
          </button>
          <div>
            <span className="badge badge-attending">Year {classItem.yearOfStudy} • {classItem.calendarYear}</span>
            <h2 style={{ margin: '4px 0 0', color: '#0c4a6e', fontSize: '1.25rem' }}>
              {classItem.courseName} — {classItem.className}
            </h2>
          </div>
        </div>
        <button className="btn-primary" onClick={() => onStartSession(classItem)}>
          <QrCode size={16} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
          Start & Beam QR Today
        </button>
      </div>

      {loading && <p style={{ color: '#0369a1' }}>Loading permanent class attendance metrics...</p>}
      {error && <div style={{ background: '#fee2e2', color: '#b91c1c', padding: '12px', borderRadius: '10px' }}>{error}</div>}

      {metrics && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '12px', marginBottom: '22px' }}>
            <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '10px', padding: '14px' }}>
              <div style={{ fontSize: '0.8rem', color: '#475569' }}>Total Lectures Held</div>
              <div style={{ fontSize: '1.45rem', fontWeight: 700, color: '#0369a1' }}>{metrics.summary.totalLectures}</div>
            </div>
            <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '10px', padding: '14px' }}>
              <div style={{ fontSize: '0.8rem', color: '#475569' }}>Total Student Check-Ins</div>
              <div style={{ fontSize: '1.45rem', fontWeight: 700, color: '#0c4a6e' }}>{metrics.summary.totalCheckIns}</div>
            </div>
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '10px', padding: '14px' }}>
              <div style={{ fontSize: '0.8rem', color: '#166534' }}>Completed (&ge;50 Mins)</div>
              <div style={{ fontSize: '1.45rem', fontWeight: 700, color: '#15803d' }}>{metrics.summary.totalCompletedAttendance}</div>
            </div>
            <div style={{ background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '10px', padding: '14px' }}>
              <div style={{ fontSize: '0.8rem', color: '#475569' }}>Avg Lecture Duration</div>
              <div style={{ fontSize: '1.45rem', fontWeight: 700, color: '#0f172a' }}>{metrics.summary.avgLectureDurationMins} mins</div>
            </div>
          </div>

          {metrics.sessions.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '28px', background: '#f8fafc', borderRadius: '12px', color: '#64748b' }}>
              No lectures have been held for this class yet. Click <strong>Start &amp; Beam QR Today</strong> to record your first session.
            </div>
          ) : (
            <>
              <h3 style={{ margin: '0 0 10px', color: '#0c4a6e', fontSize: '1rem' }}>
                <Calendar size={16} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
                Select a Lecture Date to View Daily Attendance Metrics
              </h3>
              <div style={{ display: 'flex', gap: '10px', overflowX: 'auto', paddingBottom: '10px', marginBottom: '18px' }}>
                {metrics.sessions.map((s) => {
                  const isSelected = s.id === activeDay?.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSelectedSessionId(s.id)}
                      style={{
                        minWidth: '195px',
                        textAlign: 'left',
                        padding: '12px 14px',
                        borderRadius: '10px',
                        cursor: 'pointer',
                        border: isSelected ? '2px solid #0284c7' : '1px solid #cbd5e1',
                        background: isSelected ? '#e0f2fe' : '#ffffff',
                      }}
                    >
                      <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '0.9rem' }}>{s.dateLabel}</div>
                      <div style={{ fontSize: '0.78rem', color: '#475569', marginTop: '3px' }}>
                        {new Date(s.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} –{' '}
                        {s.endedAt ? new Date(s.endedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Live Now'}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: '#0369a1', fontWeight: 600, marginTop: '6px' }}>
                        {s.attendedCount}/{s.totalStudents} Attended • {s.durationMinutes}m
                      </div>
                    </button>
                  );
                })}
              </div>

              {activeDay && (
                <div style={{ background: '#f8fafc', border: '1px solid #bae6fd', borderRadius: '12px', padding: '18px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '14px' }}>
                    <div>
                      <h4 style={{ margin: 0, color: '#0c4a6e', fontSize: '1.05rem' }}>
                        Lecture Log: {activeDay.dateLabel}
                      </h4>
                      <p style={{ margin: '4px 0 0', fontSize: '0.86rem', color: '#475569' }}>
                        <Clock size={14} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                        Started: <strong>{new Date(activeDay.startedAt).toLocaleTimeString()}</strong> •{' '}
                        Ended: <strong>{activeDay.endedAt ? new Date(activeDay.endedAt).toLocaleTimeString() : 'In Progress'}</strong> •{' '}
                        Duration: <strong>{activeDay.durationMinutes} mins</strong> •{' '}
                        Avg Time in Range: <strong>{activeDay.avgMinutesInRange} mins</strong>
                      </p>
                    </div>
                    <button className="btn-secondary" onClick={() => handleExportCsv(activeDay)} style={{ fontSize: '0.82rem' }}>
                      <Download size={15} style={{ verticalAlign: 'middle', marginRight: '5px' }} />
                      Export Day CSV
                    </button>
                  </div>

                  <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '14px', fontSize: '0.84rem' }}>
                    <span className="badge badge-attended"><CheckCircle2 size={13} style={{ verticalAlign: 'middle', marginRight: '4px' }} />Attended: {activeDay.attendedCount}</span>
                    <span className="badge badge-attending"><Users size={13} style={{ verticalAlign: 'middle', marginRight: '4px' }} />Attending: {activeDay.attendingCount}</span>
                    <span className="badge badge-absent">Absent: {activeDay.absentCount}</span>
                  </div>

                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem', background: '#ffffff' }}>
                      <thead>
                        <tr style={{ background: '#e0f2fe', textAlign: 'left' }}>
                          <th style={{ padding: '10px' }}>Student ID</th>
                          <th style={{ padding: '10px' }}>Full Name</th>
                          <th style={{ padding: '10px' }}>Check-In</th>
                          <th style={{ padding: '10px' }}>Check-Out</th>
                          <th style={{ padding: '10px' }}>In Range</th>
                          <th style={{ padding: '10px' }}>Out of Range</th>
                          <th style={{ padding: '10px' }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeDay.records.length === 0 ? (
                          <tr>
                            <td colSpan="7" style={{ padding: '14px', textAlign: 'center', color: '#64748b' }}>
                              No students checked into this session.
                            </td>
                          </tr>
                        ) : (
                          activeDay.records.map((rec) => (
                            <tr key={rec.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                              <td style={{ padding: '10px', fontWeight: 600 }}>{rec.student.studentId}</td>
                              <td style={{ padding: '10px' }}>{rec.student.fullName}</td>
                              <td style={{ padding: '10px' }}>{new Date(rec.checkInTime).toLocaleTimeString()}</td>
                              <td style={{ padding: '10px' }}>
                                {rec.checkOutTime ? new Date(rec.checkOutTime).toLocaleTimeString() : '—'}
                              </td>
                              <td style={{ padding: '10px', fontWeight: 600, color: '#0369a1' }}>{rec.totalMinutesInRange} mins</td>
                              <td style={{ padding: '10px' }}>{rec.minutesOutOfRange} mins</td>
                              <td style={{ padding: '10px' }}>
                                <span className={`badge badge-${rec.status.toLowerCase()}`}>{rec.status}</span>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
