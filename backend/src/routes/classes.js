const express = require('express');
const prisma = require('../config/db');
const { authenticateLecturer } = require('../middleware/auth');
const { getZambianCalendarYear } = require('../utils/helpers');

const router = express.Router();

// GET /api/classes
router.get('/', authenticateLecturer, async (req, res) => {
  try {
    const classes = await prisma.class.findMany({
      where: { lecturerId: req.lecturer.id },
      include: {
        _count: { select: { sessions: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ classes, remainingSlots: Math.max(0, 5 - classes.length) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load classes.' });
  }
});

// GET /api/classes/:id/metrics (Full historical lectures & attendance metrics per day)
router.get('/:id/metrics', authenticateLecturer, async (req, res) => {
  try {
    const targetClass = await prisma.class.findFirst({
      where: { id: req.params.id, lecturerId: req.lecturer.id },
      include: {
        sessions: {
          orderBy: { startedAt: 'desc' },
          include: {
            records: {
              include: {
                student: { select: { id: true, studentId: true, fullName: true } },
              },
              orderBy: { checkInTime: 'asc' },
            },
          },
        },
      },
    });

    if (!targetClass) {
      return res.status(404).json({ error: 'Class not found or unauthorized.' });
    }

    const now = new Date();
    let totalAttendedAcrossAll = 0;
    let totalRecordsAcrossAll = 0;
    let totalDurationMins = 0;

    const sessions = targetClass.sessions.map((s) => {
      const start = new Date(s.startedAt);
      const rawEnd = new Date(s.expiresAt);
      const effectiveEnd = !s.isActive || rawEnd < now ? rawEnd : now;
      const durationMinutes = Math.max(0, Math.round((effectiveEnd - start) / 60000));

      const attendedCount = s.records.filter((r) => r.status === 'ATTENDED').length;
      const attendingCount = s.records.filter((r) => r.status === 'ATTENDING').length;
      const absentCount = s.records.filter((r) => r.status === 'ABSENT').length;
      const avgMinutesInRange =
        s.records.length > 0
          ? Math.round(
              s.records.reduce((sum, r) => sum + (r.totalMinutesInRange || 0), 0) / s.records.length
            )
          : 0;

      totalAttendedAcrossAll += attendedCount;
      totalRecordsAcrossAll += s.records.length;
      totalDurationMins += durationMinutes;

      return {
        id: s.id,
        dateLabel: start.toLocaleDateString('en-ZM', {
          weekday: 'short',
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        }),
        startedAt: s.startedAt,
        endedAt: !s.isActive || rawEnd < now ? s.expiresAt : null,
        isActive: s.isActive && rawEnd > now,
        durationMinutes,
        totalStudents: s.records.length,
        attendedCount,
        attendingCount,
        absentCount,
        avgMinutesInRange,
        records: s.records,
      };
    });

    res.json({
      classInfo: {
        id: targetClass.id,
        className: targetClass.className,
        courseName: targetClass.courseName,
        yearOfStudy: targetClass.yearOfStudy,
        calendarYear: targetClass.calendarYear,
      },
      summary: {
        totalLectures: sessions.length,
        totalCheckIns: totalRecordsAcrossAll,
        totalCompletedAttendance: totalAttendedAcrossAll,
        avgLectureDurationMins:
          sessions.length > 0 ? Math.round(totalDurationMins / sessions.length) : 0,
      },
      sessions,
    });
  } catch (err) {
    res.status(500).json({ error: `Failed to load class metrics: ${err.message}` });
  }
});

// POST /api/classes (Enforces Max 5 Classes)
router.post('/', authenticateLecturer, async (req, res) => {
  try {
    const { className, yearOfStudy, courseName } = req.body;
    if (!className || !yearOfStudy || !courseName) {
      return res.status(400).json({ error: 'Class name, year of study, and course name are required.' });
    }

    const count = await prisma.class.count({ where: { lecturerId: req.lecturer.id } });
    if (count >= 5) {
      return res.status(403).json({
        error: 'Maximum limit reached: A lecturer can register at most 5 classes.',
      });
    }

    const newClass = await prisma.class.create({
      data: {
        lecturerId: req.lecturer.id,
        className: className.trim(),
        yearOfStudy: Number(yearOfStudy),
        courseName: courseName.trim(),
        calendarYear: getZambianCalendarYear(),
      },
    });

    res.status(201).json({
      class: newClass,
      totalClasses: count + 1,
      remainingSlots: 5 - (count + 1),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to register class.', details: err.message });
  }
});

module.exports = router;
