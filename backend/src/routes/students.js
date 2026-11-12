const express = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('../config/db');
const { calculateDistanceMeters } = require('../utils/helpers');

const router = express.Router();

// GET /api/students/session/:token (Verify QR/link & 100m radius before allowing access)
router.get('/session/:token', async (req, res) => {
  try {
    const { lat, lng } = req.query;
    if (lat === undefined || lng === undefined) {
      return res.status(403).json({
        error: 'Location permission is required. Please enable GPS to access this session.',
      });
    }

    const session = await prisma.attendanceSession.findUnique({
      where: { sessionToken: req.params.token },
      include: { class: true },
    });

    if (!session || !session.isActive || new Date() > new Date(session.expiresAt)) {
      return res.status(410).json({ error: 'This QR session has expired (120-minute limit) or ended.' });
    }

    const distance = calculateDistanceMeters(
      session.centerLat,
      session.centerLng,
      Number(lat),
      Number(lng)
    );

    if (distance > session.radiusMeters) {
      return res.status(403).json({
        error: `Out of range (${Math.round(distance)}m away). You must be within 100 meters of the lecture hall.`,
        distanceMeters: Math.round(distance),
      });
    }

    const remainingSeconds = Math.max(0, Math.floor((new Date(session.expiresAt) - new Date()) / 1000));
    res.json({
      allowed: true,
      sessionId: session.id,
      className: session.class.className,
      courseName: session.class.courseName,
      yearOfStudy: session.class.yearOfStudy,
      distanceMeters: Math.round(distance),
      remainingSeconds,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to validate session.' });
  }
});

// POST /api/students/checkin (Handles First-Time Registration OR Returning Login)
router.post('/checkin', async (req, res) => {
  try {
    const { sessionToken, studentId, fullName, pin, lat, lng, isFirstTime } = req.body;

    if (lat === undefined || lng === undefined) {
      return res.status(403).json({ error: 'Location permission is mandatory to check in.' });
    }
    if (!sessionToken || !studentId || !pin) {
      return res.status(400).json({ error: 'Session token, Student ID, and PIN are required.' });
    }
    if (!/^[a-zA-Z0-9]{1,6}$/.test(pin)) {
      return res.status(400).json({ error: 'PIN must be 1 to 6 letters and/or numbers.' });
    }

    const session = await prisma.attendanceSession.findUnique({
      where: { sessionToken },
    });
    if (!session || !session.isActive || new Date() > new Date(session.expiresAt)) {
      return res.status(410).json({ error: 'Session is inactive or expired.' });
    }

    const now = new Date();
    const minutesSinceStart = (now - new Date(session.startedAt)) / 60000;
    if (minutesSinceStart > 15) {
      return res.status(403).json({
        error: 'Check-in window closed: Students must register/log in within the first 15 minutes of the session.',
      });
    }

    const distance = calculateDistanceMeters(
      session.centerLat,
      session.centerLng,
      Number(lat),
      Number(lng)
    );
    if (distance > session.radiusMeters) {
      return res.status(403).json({
        error: `Access denied: You are ${Math.round(distance)}m away (must be within 100m).`,
      });
    }

    let student = await prisma.student.findUnique({ where: { studentId: studentId.trim() } });

    if (isFirstTime) {
      if (student) {
        return res.status(409).json({ error: 'Student ID already registered. Please log in as a returning student.' });
      }
      if (!fullName || !fullName.trim()) {
        return res.status(400).json({ error: 'Full name is required for first-time registration.' });
      }
      const pinHash = await bcrypt.hash(pin, 10);
      student = await prisma.student.create({
        data: {
          studentId: studentId.trim(),
          fullName: fullName.trim(),
          pinHash,
        },
      });
    } else {
      if (!student) {
        return res.status(404).json({ error: 'Student ID not found. Please select First-Time Registration.' });
      }
      const validPin = await bcrypt.compare(pin, student.pinHash);
      if (!validPin) {
        return res.status(401).json({ error: 'Incorrect PIN.' });
      }
    }

    const record = await prisma.attendanceRecord.upsert({
      where: { sessionId_studentId: { sessionId: session.id, studentId: student.id } },
      update: {
        lastPingTime: now,
        lastKnownLat: Number(lat),
        lastKnownLng: Number(lng),
      },
      create: {
        sessionId: session.id,
        studentId: student.id,
        status: 'ATTENDING',
        checkInTime: now,
        lastPingTime: now,
        lastKnownLat: Number(lat),
        lastKnownLng: Number(lng),
      },
    });

    await prisma.locationPing.create({
      data: {
        recordId: record.id,
        pingType: 'INITIAL',
        latitude: Number(lat),
        longitude: Number(lng),
        distanceMeters: distance,
        isWithinRange: true,
      },
    });

    const remainingSeconds = Math.max(0, Math.floor((new Date(session.expiresAt) - now) / 1000));

    res.json({
      message: "Successful, please don't close app/web, minimize",
      recordId: record.id,
      status: record.status,
      studentName: student.fullName,
      remainingSeconds,
    });
  } catch (err) {
    res.status(500).json({ error: 'Check-in failed.', details: err.message });
  }
});

// POST /api/students/ping (13-minute interval, first/last 15-min, and random backend coordinate checks)
router.post('/ping', async (req, res) => {
  try {
    const { recordId, lat, lng, pingType = 'INTERVAL_13M' } = req.body;
    const record = await prisma.attendanceRecord.findUnique({
      where: { id: recordId },
      include: { session: true },
    });
    if (!record) return res.status(404).json({ error: 'Attendance record not found.' });

    if (record.status === 'ABSENT' || record.status === 'ATTENDED') {
      return res.json({ status: record.status, record });
    }

    const now = new Date();
    const elapsedSinceLastPing = Math.max(1, Math.round((now - new Date(record.lastPingTime)) / 60000));
    const distance = calculateDistanceMeters(
      record.session.centerLat,
      record.session.centerLng,
      Number(lat),
      Number(lng)
    );
    const isWithinRange = distance <= record.session.radiusMeters;

    let newMinutesInRange = record.totalMinutesInRange;
    let newMinutesOutOfRange = record.minutesOutOfRange;
    let newRandomChecksPassed = record.randomChecksPassed;
    let newStatus = record.status;
    let checkOutTime = record.checkOutTime;

    if (isWithinRange) {
      newMinutesInRange += elapsedSinceLastPing;
      if (['RANDOM_CHECK', 'FIRST_15M', 'LAST_15M', 'INTERVAL_13M'].includes(pingType)) {
        newRandomChecksPassed += 1;
      }
    } else {
      newMinutesOutOfRange += elapsedSinceLastPing;
    }

    // Rule: Leaving 100m proximity for > 15 minutes cancels attendance -> ABSENT
    if (newMinutesOutOfRange > 15) {
      newStatus = 'ABSENT';
    } else if (newMinutesInRange >= 60) {
      // Rule: Auto-attended and auto-logged out at 60 minutes in range
      newStatus = 'ATTENDED';
      checkOutTime = now;
    } else if (newMinutesInRange >= 50 && newRandomChecksPassed >= 2) {
      // Rule: Passing >= 2 verification checks and 50 minutes in range marks ATTENDED
      newStatus = 'ATTENDED';
    }

    await prisma.locationPing.create({
      data: {
        recordId: record.id,
        pingType,
        latitude: Number(lat),
        longitude: Number(lng),
        distanceMeters: distance,
        isWithinRange,
      },
    });

    const updated = await prisma.attendanceRecord.update({
      where: { id: record.id },
      data: {
        status: newStatus,
        totalMinutesInRange: newMinutesInRange,
        minutesOutOfRange: newMinutesOutOfRange,
        randomChecksPassed: newRandomChecksPassed,
        lastPingTime: now,
        lastKnownLat: Number(lat),
        lastKnownLng: Number(lng),
        checkOutTime,
      },
    });

    res.json({
      status: updated.status,
      isWithinRange,
      distanceMeters: Math.round(distance),
      totalMinutesInRange: updated.totalMinutesInRange,
      minutesOutOfRange: updated.minutesOutOfRange,
      canManualCheckout: updated.totalMinutesInRange >= 50 && isWithinRange,
    });
  } catch (err) {
    res.status(500).json({ error: 'Ping update failed.', details: err.message });
  }
});

// POST /api/students/checkout (Manual attendance confirmation & logout at >= 50 minutes within range)
router.post('/checkout', async (req, res) => {
  try {
    const { recordId, lat, lng } = req.body;
    const record = await prisma.attendanceRecord.findUnique({
      where: { id: recordId },
      include: { session: true },
    });
    if (!record) return res.status(404).json({ error: 'Record not found.' });

    const distance = calculateDistanceMeters(
      record.session.centerLat,
      record.session.centerLng,
      Number(lat),
      Number(lng)
    );
    if (distance > record.session.radiusMeters) {
      return res.status(403).json({
        error: 'You must be inside the 100-meter classroom range to manually mark attended and log out.',
      });
    }

    const totalMins = Math.max(
      record.totalMinutesInRange,
      Math.floor((new Date() - new Date(record.checkInTime)) / 60000)
    );

    if (totalMins < 50) {
      return res.status(403).json({
        error: `You have only attended ${totalMins} minutes. Manual attendance checkout unlocks at 50 minutes.`,
      });
    }

    const updated = await prisma.attendanceRecord.update({
      where: { id: record.id },
      data: {
        status: 'ATTENDED',
        totalMinutesInRange: totalMins,
        checkOutTime: new Date(),
      },
    });

    res.json({
      message: 'Attendance confirmed and logged out successfully.',
      record: updated,
    });
  } catch (err) {
    res.status(500).json({ error: 'Checkout failed.', details: err.message });
  }
});

module.exports = router;
