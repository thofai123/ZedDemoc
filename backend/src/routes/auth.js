const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../config/db');
const { getZambianCalendarYear } = require('../utils/helpers');

const router = express.Router();
const ALLOWED_DOMAINS = ['gmail.com', 'outlook.com', 'yahoo.com'];

function isAllowedEmail(email) {
  if (!email || !email.includes('@')) return false;
  const domain = email.trim().toLowerCase().split('@')[1];
  return ALLOWED_DOMAINS.includes(domain);
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { fullName, email, password } = req.body;
    if (!fullName || !email || !password) {
      return res.status(400).json({ error: 'Full name, email, and password are required.' });
    }
    if (!isAllowedEmail(email)) {
      return res.status(400).json({
        error: 'Only Gmail (@gmail.com), Outlook (@outlook.com), or Yahoo (@yahoo.com) email addresses are permitted.',
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existing = await prisma.lecturer.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      return res.status(409).json({ error: 'A lecturer account with this email already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const lecturer = await prisma.lecturer.create({
      data: { fullName: fullName.trim(), email: normalizedEmail, passwordHash },
    });

    const token = jwt.sign(
      { id: lecturer.id, email: lecturer.email, fullName: lecturer.fullName },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      token,
      lecturer: { id: lecturer.id, fullName: lecturer.fullName, email: lecturer.email },
      calendarYear: getZambianCalendarYear(),
    });
  } catch (err) {
    res.status(500).json({ error: 'Registration failed.', details: err.message });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!isAllowedEmail(email)) {
      return res.status(400).json({
        error: 'Only Gmail, Outlook, or Yahoo email addresses are permitted.',
      });
    }

    const lecturer = await prisma.lecturer.findUnique({
      where: { email: email.trim().toLowerCase() },
      include: { classes: true },
    });
    if (!lecturer || !(await bcrypt.compare(password, lecturer.passwordHash))) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const token = jwt.sign(
      { id: lecturer.id, email: lecturer.email, fullName: lecturer.fullName },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      lecturer: {
        id: lecturer.id,
        fullName: lecturer.fullName,
        email: lecturer.email,
        classes: lecturer.classes,
      },
      calendarYear: getZambianCalendarYear(),
    });
  } catch (err) {
    res.status(500).json({ error: 'Login failed.', details: err.message });
  }
});

module.exports = router;
