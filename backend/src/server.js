const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
require('dotenv').config();

const prisma = require('./config/db');
const { archiveSessionToZip, getZambianCalendarYear } = require('./utils/helpers');

const authRoutes = require('./routes/auth');
const classRoutes = require('./routes/classes');
const sessionRoutes = require('./routes/sessions');
const studentRoutes = require('./routes/students');
const aiRoutes = require('./routes/ai');

const app = express();
app.use(cors());
app.use(express.json());

// Health & Zambian Calendar Year check
app.get('/api/health', (req, res) => {
  res.json({
    app: 'ZedDemoc',
    status: 'online',
    calendarYear: getZambianCalendarYear(),
    country: 'Zambia',
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/classes', classRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/ai', aiRoutes);

// Background Cron Job: Runs every minute to enforce 15-min absence, 60-min auto-checkout, and 120-min QR expiry
cron.schedule('* * * * *', async () => {
  try {
    const now = new Date();

    // 1. Auto-expire sessions past 120 minutes and compress daily archive
    const expiredSessions = await prisma.attendanceSession.findMany({
      where: { isActive: true, expiresAt: { lte: now } },
    });
    for (const s of expiredSessions) {
      await prisma.attendanceSession.update({
        where: { id: s.id },
        data: { isActive: false },
      });
      await archiveSessionToZip(s.id);
    }

    // 2. Evaluate active ATTENDING student records
    const activeRecords = await prisma.attendanceRecord.findMany({
      where: { status: 'ATTENDING', session: { isActive: true } },
    });

    for (const rec of activeRecords) {
      const minsSinceLastPing = Math.floor((now - new Date(rec.lastPingTime)) / 60000);
      const minsSinceCheckIn = Math.floor((now - new Date(rec.checkInTime)) / 60000);

      // If student stopped sending pings or stayed out of range for > 15 minutes -> ABSENT
      if (rec.minutesOutOfRange + minsSinceLastPing > 15 && minsSinceLastPing > 15) {
        await prisma.attendanceRecord.update({
          where: { id: rec.id },
          data: { status: 'ABSENT', minutesOutOfRange: rec.minutesOutOfRange + minsSinceLastPing },
        });
      } else if (rec.totalMinutesInRange >= 60 || (minsSinceCheckIn >= 60 && rec.minutesOutOfRange <= 15)) {
        // Auto-attended and auto-logged out at 60 minutes
        await prisma.attendanceRecord.update({
          where: { id: rec.id },
          data: {
            status: 'ATTENDED',
            totalMinutesInRange: Math.max(60, rec.totalMinutesInRange),
            checkOutTime: now,
          },
        });
      }
    }
  } catch (err) {
    console.error('Cron evaluation error:', err.message);
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`ZedDemoc Backend API running on http://localhost:${PORT} (Zambia Year: ${getZambianCalendarYear()})`);
});
