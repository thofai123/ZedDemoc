const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const prisma = require('../config/db');
const { getZambianCalendarYear } = require('../utils/helpers');
const isAllowedLecturerEmail = (email) => /^[^\s@]+@(gmail\.com|outlook\.com|yahoo\.com)$/i.test(String(email || '').trim());

const router = express.Router();

// Configure SMTP mailer if SMTP_USER & SMTP_PASS are provided in environment variables
function getMailer() {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  return nodemailer.createTransport({
    service: process.env.SMTP_SERVICE || 'gmail',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function dispatchOtpEmail(email, code, purpose) {
  const mailer = getMailer();
  const subject =
    purpose === 'RESET_PASSWORD'
      ? 'ZedDemoc Password Reset Verification Code'
      : 'ZedDemoc Lecturer Account Verification Code';
  const text =
    `Your ZedDemoc 6-digit verification code is: ${code}\n\n` +
    `This code expires in 15 minutes. If you did not request this, please ignore this email.`;

  if (mailer) {
    await mailer.sendMail({
      from: `"ZedDemoc Attendance" <${process.env.SMTP_USER}>`,
      to: email,
      subject,
      text,
    });
    return { sentViaEmail: true };
  }

  console.log(`[ZedDemoc OTP Fallback] ${purpose} code for ${email}: ${code}`);
  return { sentViaEmail: false, devCode: code };
}

// POST /api/auth/send-otp (Used for both Registration Verification & Forgot Password)
router.post('/send-otp', async (req, res) => {
  try {
    const { email, purpose } = req.body;
    if (!email || !['REGISTER', 'RESET_PASSWORD'].includes(purpose)) {
      return res.status(400).json({ error: 'Valid email and purpose (REGISTER or RESET_PASSWORD) are required.' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    if (!isAllowedLecturerEmail(normalizedEmail)) {
      return res.status(400).json({
        error: 'Only @gmail.com, @outlook.com, and @yahoo.com accounts are allowed to register.',
      });
    }

    const existing = await prisma.lecturer.findUnique({ where: { email: normalizedEmail } });
    if (purpose === 'REGISTER' && existing) {
      return res.status(409).json({ error: 'An account with this email already exists. Please log in.' });
    }
    if (purpose === 'RESET_PASSWORD' && !existing) {
      return res.status(404).json({ error: 'No lecturer account found with this email address.' });
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    await prisma.emailOtp.create({
      data: {
        email: normalizedEmail,
        code,
        purpose,
        expiresAt,
      },
    });

    const delivery = await dispatchOtpEmail(normalizedEmail, code, purpose);

    res.json({
      message: delivery.sentViaEmail
        ? `Verification code sent to ${normalizedEmail}. Check your inbox or spam folder.`
        : `Verification code generated for ${normalizedEmail} (SMTP not yet configured on server—use code: ${delivery.devCode}).`,
      ...(delivery.devCode ? { devCode: delivery.devCode } : {}),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to send verification code.', details: err.message });
  }
});

// POST /api/auth/register (Requires verified 6-digit email OTP)
router.post('/register', async (req, res) => {
  try {
    const { fullName, email, password, otpCode } = req.body;
    if (!fullName || !email || !password || !otpCode) {
      return res.status(400).json({ error: 'Full name, email, password, and 6-digit email code are required.' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    if (!isAllowedLecturerEmail(normalizedEmail)) {
      return res.status(400).json({
        error: 'Only @gmail.com, @outlook.com, and @yahoo.com accounts are allowed to register.',
      });
    }

    const validOtp = await prisma.emailOtp.findFirst({
      where: {
        email: normalizedEmail,
        code: String(otpCode).trim(),
        purpose: 'REGISTER',
        used: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!validOtp) {
      return res.status(400).json({ error: 'Invalid or expired email verification code.' });
    }

    const existing = await prisma.lecturer.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    await prisma.emailOtp.update({ where: { id: validOtp.id }, data: { used: true } });

    const passwordHash = await bcrypt.hash(password, 10);
    const lecturer = await prisma.lecturer.create({
      data: {
        fullName: fullName.trim(),
        email: normalizedEmail,
        passwordHash,
      },
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

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  try {
    const { email, otpCode, newPassword } = req.body;
    if (!email || !otpCode || !newPassword) {
      return res.status(400).json({ error: 'Email, verification code, and new password are required.' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const validOtp = await prisma.emailOtp.findFirst({
      where: {
        email: normalizedEmail,
        code: String(otpCode).trim(),
        purpose: 'RESET_PASSWORD',
        used: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!validOtp) {
      return res.status(400).json({ error: 'Invalid or expired password reset code.' });
    }

    const lecturer = await prisma.lecturer.findUnique({ where: { email: normalizedEmail } });
    if (!lecturer) {
      return res.status(404).json({ error: 'Lecturer account not found.' });
    }

    await prisma.emailOtp.update({ where: { id: validOtp.id }, data: { used: true } });
    const passwordHash = await bcrypt.hash(newPassword, 10);

    await prisma.lecturer.update({
      where: { id: lecturer.id },
      data: { passwordHash },
    });

    res.json({ message: 'Password updated successfully! You can now log in with your new password.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reset password.', details: err.message });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const lecturer = await prisma.lecturer.findUnique({ where: { email: normalizedEmail } });
    if (!lecturer) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const valid = await bcrypt.compare(password, lecturer.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const token = jwt.sign(
      { id: lecturer.id, email: lecturer.email, fullName: lecturer.fullName },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      lecturer: { id: lecturer.id, fullName: lecturer.fullName, email: lecturer.email },
      calendarYear: getZambianCalendarYear(),
    });
  } catch (err) {
    res.status(500).json({ error: 'Login failed.', details: err.message });
  }
});

module.exports = router;
