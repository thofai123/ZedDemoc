import React from 'react';

export default function Footer({ calendarYear }) {
  const lusakaYear =
    calendarYear ||
    new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Lusaka' })).getFullYear();

  return (
    <footer
      style={{
        textAlign: 'center',
        padding: '20px 16px',
        marginTop: '48px',
        borderTop: '1px solid rgba(125, 211, 252, 0.45)',
        color: '#0369a1',
        fontSize: '0.88rem',
        fontWeight: 600,
      }}
    >
      ZedDemoc Attendance System • Republic of Zambia Calendar Year: <strong>{lusakaYear}</strong> • Full-Year Data Retention
    </footer>
  );
}
