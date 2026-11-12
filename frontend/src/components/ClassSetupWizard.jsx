import React, { useState } from 'react';
import { apiRequest } from '../api';

export default function ClassSetupWizard({ token, existingCount, onComplete }) {
  const [stepCount, setStepCount] = useState(existingCount);
  const [className, setClassName] = useState('');
  const [yearOfStudy, setYearOfStudy] = useState('1');
  const [courseName, setCourseName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const currentClassNumber = stepCount + 1;

  async function handleAddClass(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await apiRequest(
        '/classes',
        {
          method: 'POST',
          body: JSON.stringify({ className, yearOfStudy, courseName }),
        },
        token
      );
      const nextCount = stepCount + 1;
      setStepCount(nextCount);
      setClassName('');
      setYearOfStudy('1');
      setCourseName('');
      if (nextCount >= 5) {
        onComplete();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="glass-card" style={{ maxWidth: '520px', margin: '32px auto', padding: '28px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <span className="badge badge-attending">Class {currentClassNumber} of 5 Max</span>
        <span style={{ fontSize: '0.85rem', color: '#0369a1' }}>{5 - stepCount} slots left</span>
      </div>

      <h2 style={{ margin: '0 0 8px', color: '#0c4a6e' }}>
        Register Class #{currentClassNumber}
      </h2>
      <p style={{ margin: '0 0 20px', color: '#475569', fontSize: '0.92rem' }}>
        Enter the class details you teach or administer. You can register up to 5 classes total.
      </p>

      {error && (
        <div style={{ background: '#fee2e2', color: '#b91c1c', padding: '10px', borderRadius: '8px', marginBottom: '14px' }}>
          {error}
        </div>
      )}

      <form onSubmit={handleAddClass} style={{ display: 'grid', gap: '14px' }}>
        <div>
          <label style={{ display: 'block', fontWeight: 600, marginBottom: '6px', fontSize: '0.88rem' }}>
            Class Name (e.g., 3rd Years, 2nd Years)
          </label>
          <input
            className="input-field"
            placeholder="e.g., 3rd Years"
            value={className}
            onChange={(e) => setClassName(e.target.value)}
            required
          />
        </div>

        <div>
          <label style={{ display: 'block', fontWeight: 600, marginBottom: '6px', fontSize: '0.88rem' }}>
            Year of Study
          </label>
          <select
            className="input-field"
            value={yearOfStudy}
            onChange={(e) => setYearOfStudy(e.target.value)}
          >
            <option value="1">Year 1</option>
            <option value="2">Year 2</option>
            <option value="3">Year 3</option>
            <option value="4">Year 4</option>
            <option value="5">Year 5</option>
          </select>
        </div>

        <div>
          <label style={{ display: 'block', fontWeight: 600, marginBottom: '6px', fontSize: '0.88rem' }}>
            Course Name (e.g., Special Education, Computer Science)
          </label>
          <input
            className="input-field"
            placeholder="e.g., Computer Science"
            value={courseName}
            onChange={(e) => setCourseName(e.target.value)}
            required
          />
        </div>

        <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
          <button type="submit" className="btn-primary" style={{ flex: 1 }} disabled={loading}>
            {loading ? 'Saving...' : currentClassNumber < 5 ? 'Save & Add Next Class' : 'Save Final Class & Finish'}
          </button>
          {stepCount > 0 && (
            <button type="button" className="btn-secondary" onClick={onComplete}>
              Done ({stepCount} Saved)
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
