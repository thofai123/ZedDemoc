const express = require('express');
const prisma = require('../config/db');
const { authenticateLecturer } = require('../middleware/auth');

const router = express.Router();

// POST /api/ai/query
router.post('/query', authenticateLecturer, async (req, res) => {
  try {
    const { prompt, classId } = req.body;
    const whereClause = {
      session: {
        class: {
          lecturerId: req.lecturer.id,
          ...(classId ? { id: classId } : {}),
        },
      },
    };

    const records = await prisma.attendanceRecord.findMany({
      where: whereClause,
      include: {
        student: true,
        session: { include: { class: true } },
      },
    });

    const totalSessions = await prisma.attendanceSession.count({
      where: {
        class: {
          lecturerId: req.lecturer.id,
          ...(classId ? { id: classId } : {}),
        },
      },
    });

    const totalRecords = records.length;
    const attendedRecords = records.filter((r) => r.status === 'ATTENDED');
    const absentRecords = records.filter((r) => r.status === 'ABSENT');
    const leftPermanentlyAfterLogin = records.filter(
      (r) => r.status === 'ABSENT' && r.minutesOutOfRange > 15
    );
    const leftBrieflyUnder15Min = records.filter(
      (r) => r.minutesOutOfRange > 0 && r.minutesOutOfRange <= 15
    );
    const completedFull60Min = attendedRecords.filter((r) => r.totalMinutesInRange >= 60);
    const loggedOutAt50Min = attendedRecords.filter(
      (r) => r.totalMinutesInRange >= 50 && r.totalMinutesInRange < 60
    );

    const totalMinutesAttended = records.reduce((sum, r) => sum + r.totalMinutesInRange, 0);
    const averageMinutesAttended = totalRecords ? (totalMinutesAttended / totalRecords).toFixed(1) : 0;
    const averageAttendancePerDay = totalSessions ? (attendedRecords.length / totalSessions).toFixed(1) : 0;

    const metrics = {
      totalSessions,
      totalRegisteredCheckIns: totalRecords,
      totalAttended: attendedRecords.length,
      totalAbsent: absentRecords.length,
      averageAttendancePerDay: Number(averageAttendancePerDay),
      averageMinutesAttended: Number(averageMinutesAttended),
      totalMinutesAttended,
      totalLeftPermanentlyAfterLogin: leftPermanentlyAfterLogin.length,
      totalLeftBrieflyNotMoreThan15Min: leftBrieflyUnder15Min.length,
      totalCompleted60Minutes: completedFull60Min.length,
      totalLoggedOutAt50Minutes: loggedOutAt50Min.length,
    };

    // Build tailored natural-language response matching the lecturer's prompt
    const q = (prompt || '').toLowerCase();
    let answer = `Here are your ZedDemoc attendance analytics across ${totalSessions} session(s):\n` +
      `• Average Attendance / Session: ${metrics.averageAttendancePerDay} students\n` +
      `• Average Minutes Attended: ${metrics.averageMinutesAttended} mins (Total: ${metrics.totalMinutesAttended} mins)\n` +
      `• Total Attended: ${metrics.totalAttended} | Total Absent: ${metrics.totalAbsent} (out of ${metrics.totalRegisteredCheckIns})\n` +
      `• Left > 15 mins (Cancelled/Absent): ${metrics.totalLeftPermanentlyAfterLogin} | Stepped out ≤ 15 mins: ${metrics.totalLeftBrieflyNotMoreThan15Min}\n` +
      `• Completed Full 60 mins: ${metrics.totalCompleted60Minutes} | Logged out at 50–59 mins: ${metrics.totalLoggedOutAt50Minutes}`;

    if (q.includes('50') || q.includes('60')) {
      answer = `Completion Breakdown: ${metrics.totalCompleted60Minutes} student(s) completed the full 60 minutes (auto-logged out), while ${metrics.totalLoggedOutAt50Minutes} student(s) logged out between 50 and 59 minutes.`;
    } else if (q.includes('15') || q.includes('left') || q.includes('briefly')) {
      answer = `Proximity Breakdown: ${metrics.totalLeftPermanentlyAfterLogin} student(s) left the 100m range for more than 15 minutes and were marked Absent, while ${metrics.totalLeftBrieflyNotMoreThan15Min} student(s) stepped out briefly for 15 minutes or less.`;
    } else if (q.includes('average') || q.includes('minute')) {
      answer = `Time & Attendance Averages: Average attendance is ${metrics.averageAttendancePerDay} students per session, with an average of ${metrics.averageMinutesAttended} minutes attended (${metrics.totalMinutesAttended} cumulative minutes).`;
    }

    res.json({ prompt, answer, metrics });
  } catch (err) {
    res.status(500).json({ error: 'ZedDemoc AI failed to compute metrics.', details: err.message });
  }
});

module.exports = router;
