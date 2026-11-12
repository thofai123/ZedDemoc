const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const prisma = require('../config/db');

// Haversine formula: exact distance in meters between two GPS coordinates
function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth radius in meters
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Get current year aligned with Zambia (Africa/Lusaka, CAT UTC+2)
function getZambianCalendarYear() {
  const lusakaDate = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Africa/Lusaka' })
  );
  return lusakaDate.getFullYear();
}

// Safely compress session attendance into a daily ZIP archive
async function archiveSessionToZip(sessionId) {
  const session = await prisma.attendanceSession.findUnique({
    where: { id: sessionId },
    include: {
      class: { include: { lecturer: true } },
      records: { include: { student: true } },
    },
  });

  if (!session) return null;

  const existing = await prisma.sessionArchive.findUnique({
    where: { sessionId },
  });
  if (existing) return existing;

  const started = new Date(session.startedAt);
  const dayName = started.toLocaleDateString('en-US', { weekday: 'Long', timeZone: 'Africa/Lusaka' }).replace(/[^a-zA-Z]/g, '') ||
                  started.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'Africa/Lusaka' });
  const dateStr = started.toISOString().split('T')[0]; // YYYY-MM-DD
  const safeCourse = session.class.courseName.replace(/[^a-zA-Z0-9]/g, '_');
  const fileName = `${dayName}_${dateStr}_${safeCourse}_ZedDemoc.zip`;
  const archivesDir = path.join(__dirname, '../../archives');
  if (!fs.existsSync(archivesDir)) fs.mkdirSync(archivesDir, { recursive: true });

  const filePath = path.join(archivesDir, fileName);

  // Build CSV & JSON reports
  const csvHeader = 'Student_ID,Full_Name,Status,Check_In,Check_Out,Minutes_In_Range,Minutes_Out_Of_Range,Random_Checks_Passed,Manual_Edit\n';
  const csvRows = session.records.map((r) =>
    [
      r.student.studentId,
      `"${r.student.fullName}"`,
      r.status,
      r.checkInTime.toISOString(),
      r.checkOutTime ? r.checkOutTime.toISOString() : 'N/A',
      r.totalMinutesInRange,
      r.minutesOutOfRange,
      r.randomChecksPassed,
      r.manualLecturerEdit,
    ].join(',')
  ).join('\n');

  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(filePath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', resolve);
    archive.on('error', reject);

    archive.pipe(output);
    archive.append(csvHeader + csvRows, { name: `${dayName}_${dateStr}_${safeCourse}.csv` });
    archive.append(JSON.stringify(session, null, 2), { name: `${dayName}_${dateStr}_${safeCourse}.json` });
    archive.finalize();
  });

  return prisma.sessionArchive.create({
    data: {
      sessionId: session.id,
      lecturerId: session.class.lecturerId,
      fileName,
      filePath,
      calendarYear: session.class.calendarYear,
    },
  });
}

module.exports = {
  calculateDistanceMeters,
  getZambianCalendarYear,
  archiveSessionToZip,
};
