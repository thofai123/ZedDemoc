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
      orderBy: { createdAt: 'asc' },
    });
    res.json({ classes, remainingSlots: Math.max(0, 5 - classes.length) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load classes.' });
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
