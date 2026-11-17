const express = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('../config/db');

function getDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const router = express.Router();

async function evaluateLocationPing(recordId, lat, lng, pingType, recordedAtIso) {
  const record = await prisma.attendanceRecord.findUnique({ where: { id: recordId }, include: { session: true } });
  if (!record || record.status === 'ABSENT') {
    return { status: record?.status || 'ABSENT', distanceMeters: 0, withinRange: false, totalMinutesInRange: record?.totalMinutesInRange || 0, minutesOutOfRange: record?.minutesOutOfRange || 0 };
  }
  const eventTime = recordedAtIso ? new Date(recordedAtIso) : new Date();
  const distance = getDistanceMeters(record.session.centerLat, record.session.centerLng, Number(lat), Number(lng));
  const isWithinRange = distance <= record.session.radiusMeters;

  await prisma.locationPing.create({
    data: { recordId: record.id, latitude: Number(lat), longitude: Number(lng), distanceMeters: Math.round(distance), isWithinRange, pingType: pingType || 'CONTINUOUS_WATCH', recordedAt: eventTime },
  });

  const totalElapsedMins = Math.max(0, Math.floor((eventTime.getTime() - new Date(record.checkInTime).getTime()) / 60000));
  const prevPingMs = record.lastPingTime ? new Date(record.lastPingTime).getTime() : new Date(record.checkInTime).getTime();
  const deltaMins = Math.max(0, Math.floor((eventTime.getTime() - prevPingMs) / 60000));

  let minutesOutOfRange = record.minutesOutOfRange;
  let status = record.status;
  if (!isWithinRange) {
    minutesOutOfRange += deltaMins;
    if (minutesOutOfRange > 15) status = 'ABSENT';
  }
  const totalMinutesInRange = Math.max(0, totalElapsedMins - minutesOutOfRange);
  let checkOutTime = record.checkOutTime;
  if (status === 'ATTENDING' && totalMinutesInRange >= 60) {
    status = 'ATTENDED';
    checkOutTime = eventTime;
  }

  await prisma.attendanceRecord.update({
    where: { id: record.id },
    data: { totalMinutesInRange, minutesOutOfRange, lastPingTime: eventTime, lastKnownLat: Number(lat), lastKnownLng: Number(lng), status, checkOutTime },
  });
  return { status, distanceMeters: Math.round(distance), withinRange: isWithinRange, totalMinutesInRange, minutesOutOfRange };
}

router.get('/session/:sessionToken', async (req, res) => {
  try {
    const { sessionToken } = req.params;
    const { lat, lng } = req.query;
    if (!lat || !lng) return res.status(400).json({ error: 'GPS coordinates (lat, lng) are required.' });
    const session = await prisma.attendanceSession.findUnique({ where: { sessionToken }, include: { class: true } });
    if (!session || !session.isActive) return res.status(404).json({ error: 'This attendance session is invalid or has already ended.' });
    const now = new Date();
    if (now > new Date(session.expiresAt)) return res.status(410).json({ error: 'This QR code has expired (120-minute limit reached).' });
    const distance = getDistanceMeters(session.centerLat, session.centerLng, Number(lat), Number(lng));
    if (distance > session.radiusMeters) return res.status(403).json({ error: `Out of bounds (${Math.round(distance)}m away). Must be within 100m.`, distanceMeters: Math.round(distance) });
    res.json({ sessionId: session.id, className: session.class.className, courseName: session.class.courseName, yearOfStudy: session.class.yearOfStudy, distanceMeters: Math.round(distance), remainingSeconds: Math.max(0, Math.floor((new Date(session.expiresAt) - now) / 1000)), expiresAt: session.expiresAt });
  } catch (err) {
    res.status(500).json({ error: `Failed to validate QR session: ${err.message}` });
  }
});

router.post('/checkin', async (req, res) => {
  try {
    const { sessionToken, studentId, fullName, pin, lat, lng, isFirstTime } = req.body;
    if (!sessionToken || !studentId || !pin || lat === undefined || lng === undefined) return res.status(400).json({ error: 'Student ID, PIN, session token, and GPS coordinates are required.' });
    if (String(pin).length > 6 || !/^[a-zA-Z0-9]+$/.test(String(pin))) return res.status(400).json({ error: 'PIN must be letters/numbers only and max 6 characters.' });
    const session = await prisma.attendanceSession.findUnique({ where: { sessionToken }, include: { class: true } });
    if (!session || !session.isActive || new Date() > new Date(session.expiresAt)) return res.status(410).json({ error: 'Session has expired or is inactive.' });
    const distance = getDistanceMeters(session.centerLat, session.centerLng, Number(lat), Number(lng));
    if (distance > session.radiusMeters) return res.status(403).json({ error: `Access denied: You are ${Math.round(distance)}m away (must be within 100m).` });
    const cleanStudentId = String(studentId).trim();
    let student = await prisma.student.findUnique({ where: { studentId: cleanStudentId } });
    if (isFirstTime) {
      if (student) return res.status(409).json({ error: 'This Student ID is already registered. Please log in with your PIN.' });
      if (!fullName || !fullName.trim()) return res.status(400).json({ error: 'Full Name is required for first-time registration.' });
      student = await prisma.student.create({ data: { studentId: cleanStudentId, fullName: fullName.trim(), pinHash: await bcrypt.hash(String(pin), 10) } });
    } else {
      if (!student) return res.status(404).json({ error: 'Student ID not found. Please select First-Time Registration.' });
      if (!(await bcrypt.compare(String(pin), student.pinHash))) return res.status(401).json({ error: 'Incorrect PIN password.' });
    }
    const now = new Date();
    const record = await prisma.attendanceRecord.upsert({
      where: { sessionId_studentId: { sessionId: session.id, studentId: student.id } },
      update: { status: 'ATTENDING', lastPingTime: now, lastKnownLat: Number(lat), lastKnownLng: Number(lng) },
      create: { sessionId: session.id, studentId: student.id, checkInTime: now, lastPingTime: now, lastKnownLat: Number(lat), lastKnownLng: Number(lng), status: 'ATTENDING', totalMinutesInRange: 0, minutesOutOfRange: 0 },
    });
    await prisma.locationPing.create({ data: { recordId: record.id, latitude: Number(lat), longitude: Number(lng), distanceMeters: Math.round(distance), isWithinRange: true, pingType: 'INITIAL', recordedAt: now } });
    res.json({ message: 'Thanks for attending! Please note that you will be automatically logged out when the class ends.', recordId: record.id, checkInTime: record.checkInTime, studentName: student.fullName, status: record.status, remainingSeconds: Math.max(0, Math.floor((new Date(session.expiresAt) - now) / 1000)), expiresAt: session.expiresAt });
  } catch (err) {
    res.status(500).json({ error: `Student check-in failed: ${err.message}` });
  }
});

router.post('/ping', async (req, res) => {
  try {
    const { recordId, lat, lng, pingType, recordedAt } = req.body;
    res.json(await evaluateLocationPing(recordId, lat, lng, pingType, recordedAt));
  } catch (err) {
    res.status(500).json({ error: `Location ping failed: ${err.message}` });
  }
});

router.post('/sync-pings', async (req, res) => {
  try {
    const { recordId, pings } = req.body;
    if (!recordId || !Array.isArray(pings)) return res.status(400).json({ error: 'recordId and pings array are required.' });
    const sorted = [...pings].sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt));
    let latestResult = null;
    for (const p of sorted) latestResult = await evaluateLocationPing(recordId, p.lat, p.lng, p.pingType || 'OFFLINE_QUEUED', p.recordedAt);
    res.json({ syncedCount: sorted.length, latest: latestResult });
  } catch (err) {
    res.status(500).json({ error: `Failed to sync offline pings: ${err.message}` });
  }
});

router.post('/checkout', async (req, res) => {
  try {
    const { recordId, lat, lng } = req.body;
    const record = await prisma.attendanceRecord.findUnique({ where: { id: recordId }, include: { session: true } });
    if (!record) return res.status(404).json({ error: 'Attendance record not found.' });
    if (record.status === 'ABSENT') return res.status(403).json({ error: 'Attendance cancelled: left 100m radius for over 15 minutes.' });
    const distance = getDistanceMeters(record.session.centerLat, record.session.centerLng, Number(lat), Number(lng));
    if (distance > record.session.radiusMeters) return res.status(403).json({ error: 'You must be within 100m of the lecturer to confirm attendance.' });
    const now = new Date();
    const realElapsedMins = Math.floor((now.getTime() - new Date(record.checkInTime).getTime()) / 60000);
    const effectiveMinutesInRange = Math.max(0, realElapsedMins - record.minutesOutOfRange);
    if (effectiveMinutesInRange < 50) return res.status(400).json({ error: `Minimum 50 minutes required (currently ${effectiveMinutesInRange} real minutes attended).` });
    const updated = await prisma.attendanceRecord.update({ where: { id: record.id }, data: { status: 'ATTENDED', totalMinutesInRange: effectiveMinutesInRange, checkOutTime: now } });
    res.json({ message: `Attendance confirmed (${effectiveMinutesInRange} mins attended). You are now logged out.`, record: updated });
  } catch (err) {
    res.status(500).json({ error: `Checkout failed: ${err.message}` });
  }
});

module.exports = router;
