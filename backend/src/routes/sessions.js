const express = require('express');
const crypto = require('crypto');
const QRCode = require('qrcode');
const prisma = require('../config/db');
const { authenticateLecturer } = require('../middleware/auth');
const { archiveSessionToZip } = require('../utils/helpers');

const router = express.Router();

// GET /api/sessions/active (Resumes any active session after page close, offline, or logout/login)
router.get('/active', authenticateLecturer, async (req, res) => {
  try {
    const now = new Date();
    const session = await prisma.attendanceSession.findFirst({
      where: {
        isActive: true,
        expiresAt: { gt: now },
        class: { lecturerId: req.lecturer.id },
      },
      include: {
        class: true,
        records: {
          include: { student: { select: { id: true, studentId: true, fullName: true } } },
          orderBy: { checkInTime: 'desc' },
        },
      },
      orderBy: { startedAt: 'desc' },
    });

    if (!session) {
      return res.json({ session: null, remainingSeconds: 0 });
    }

    const remainingSeconds = Math.max(0, Math.floor((new Date(session.expiresAt) - now) / 1000));
    res.json({ session, remainingSeconds });
  } catch (err) {
    res.status(500).json({ error: 'Failed to restore active session.' });
  }
});

// POST /api/sessions/start
router.post('/start', authenticateLecturer, async (req, res) => {
  try {
    const { classId, centerLat, centerLng, clientOrigin } = req.body;
    if (!classId || centerLat === undefined || centerLng === undefined) {
      return res.status(400).json({ error: 'classId, centerLat, and centerLng are required.' });
    }

    const targetClass = await prisma.class.findFirst({
      where: { id: classId, lecturerId: req.lecturer.id },
    });
    if (!targetClass) {
      return res.status(404).json({ error: 'Class not found or unauthorized.' });
    }

    // Deactivate any previous active session for this lecturer
    await prisma.attendanceSession.updateMany({
      where: { isActive: true, class: { lecturerId: req.lecturer.id } },
      data: { isActive: false },
    });

    const sessionToken = crypto.randomBytes(16).toString('hex');
    const baseUrl = clientOrigin || 'http://localhost:5173';
    const fallbackUrl = `${baseUrl}/student?token=${sessionToken}`;
    const qrCodeData = await QRCode.toDataURL(fallbackUrl, { width: 320, margin: 2 });

    const startedAt = new Date();
    const expiresAt = new Date(startedAt.getTime() + 120 * 60 * 1000); // 120 minutes

    const session = await prisma.attendanceSession.create({
      data: {
        classId,
        sessionToken,
        qrCodeData,
        fallbackUrl,
        centerLat: Number(centerLat),
        centerLng: Number(centerLng),
        radiusMeters: 100,
        startedAt,
        expiresAt,
        isActive: true,
      },
      include: { class: true },
    });

    res.status(201).json({ session });
  } catch (err) {
    res.status(500).json({ error: 'Failed to start attendance session.', details: err.message });
  }
});

// GET /api/sessions/:id/live
router.get('/:id/live', authenticateLecturer, async (req, res) => {
  try {
    const session = await prisma.attendanceSession.findUnique({
      where: { id: req.params.id },
      include: {
        class: true,
        records: {
          include: { student: { select: { id: true, studentId: true, fullName: true } } },
          orderBy: { checkInTime: 'desc' },
        },
      },
    });
    if (!session) return res.status(404).json({ error: 'Session not found.' });

    const now = new Date();
    const remainingSeconds = Math.max(0, Math.floor((new Date(session.expiresAt) - now) / 1000));

    res.json({ session, remainingSeconds });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch live session.' });
  }
});

// POST /api/sessions/:id/offline-mark
router.post('/:id/offline-mark', authenticateLecturer, async (req, res) => {
  try {
    const { studentId, fullName, status } = req.body;
    if (!studentId || !fullName || !['ATTENDING', 'ATTENDED', 'ABSENT'].includes(status)) {
      return res.status(400).json({ error: 'Valid studentId, fullName, and status are required.' });
    }

    let student = await prisma.student.findUnique({ where: { studentId: studentId.trim() } });
    if (!student) {
      student = await prisma.student.create({
        data: {
          studentId: studentId.trim(),
          fullName: fullName.trim(),
          pinHash: 'OFFLINE_CREATED',
        },
      });
    }

    const record = await prisma.attendanceRecord.upsert({
      where: { sessionId_studentId: { sessionId: req.params.id, studentId: student.id } },
      update: {
        status,
        manualLecturerEdit: true,
        checkOutTime: status === 'ATTENDED' ? new Date() : null,
      },
      create: {
        sessionId: req.params.id,
        studentId: student.id,
        status,
        totalMinutesInRange: status === 'ATTENDED' ? 60 : 0,
        manualLecturerEdit: true,
        checkOutTime: status === 'ATTENDED' ? new Date() : null,
      },
      include: { student: true },
    });

    await prisma.attendanceSession.update({
      where: { id: req.params.id },
      data: { isOfflineSync: true },
    });

    res.json({ message: 'Offline attendance record saved.', record });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save offline record.', details: err.message });
  }
});

// DELETE /api/sessions/:id/cancel (Dedicated Cancel Class button to stop/cancel session)
router.delete('/:id/cancel', authenticateLecturer, async (req, res) => {
  try {
    const session = await prisma.attendanceSession.findFirst({
      where: { id: req.params.id, class: { lecturerId: req.lecturer.id } },
    });
    if (!session) return res.status(404).json({ error: 'Session not found.' });

    await prisma.attendanceSession.delete({
      where: { id: req.params.id },
    });

    res.json({ message: 'Class session cancelled and stopped.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to cancel class session.', details: err.message });
  }
});

// POST /api/sessions/:id/end (Complete session & compress daily ZIP)
router.post('/:id/end', authenticateLecturer, async (req, res) => {
  try {
    await prisma.attendanceSession.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });
    const archive = await archiveSessionToZip(req.params.id);
    res.json({ message: 'Session ended and compressed into daily archive.', archive });
  } catch (err) {
    res.status(500).json({ error: 'Failed to close and archive session.', details: err.message });
  }
});

// GET /api/sessions/archives/list
router.get('/archives/list', authenticateLecturer, async (req, res) => {
  try {
    const archives = await prisma.sessionArchive.findMany({
      where: { lecturerId: req.lecturer.id },
      include: { session: { include: { class: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ archives });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load archives.' });
  }
});

// GET /api/sessions/archives/:archiveId/download
router.get('/archives/:archiveId/download', authenticateLecturer, async (req, res) => {
  try {
    const archive = await prisma.sessionArchive.findFirst({
      where: { id: req.params.archiveId, lecturerId: req.lecturer.id },
    });
    if (!archive) return res.status(404).json({ error: 'Archive file not found.' });
    res.download(archive.filePath, archive.fileName);
  } catch (err) {
    res.status(500).json({ error: 'Failed to download archive.' });
  }
});

module.exports = router;
