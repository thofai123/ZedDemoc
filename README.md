# ZedDemoc — Geofenced QR Attendance & AI Analytics System (Demo)

## Architecture Overview
- **Frontend:** React Native + Expo (Mobile & Web) with Fading Light Blue UI & Zambian Calendar Year footer.
- **Backend:** Node.js + Express + Prisma ORM v7 + PostgreSQL.
- **Core Rules:**
  - Lecturer registration restricted to `@gmail.com`, `@outlook.com`, `@yahoo.com`.
  - Maximum 5 classes per lecturer account.
  - 100-meter GPS geofence around live session coordinates.
  - Unique daily QR code + fallback physical URL link (120-minute expiration).
  - Student registration via Full Name, Unique Student ID, and <= 6 alphanumeric PIN.
  - Background heartbeat checks every 13 minutes + random backend checks.
  - Automatic cancellation if outside 100m for > 15 minutes; auto-attended at 50–60 minutes.
  - Embedded Lecturer AI for natural-language attendance metrics.
  - Automated post-session file compression & full calendar year retention.

## Development Log
- **Step 1:** WSL/Ubuntu environment, PostgreSQL database (`zeddemoc_db`), and Prisma schema initialized.
