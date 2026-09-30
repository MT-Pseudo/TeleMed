# TeleMed - Low-Bandwidth Telemedicine Video System

A WebRTC-based video consultation platform designed for weak, unstable networks. Built with Node.js, Socket.IO, MongoDB, and vanilla JavaScript. Features adaptive bitrate control, automatic audio-only fallback, live network quality monitoring, in-call chat, real-time call notifications, and doctor session notes.

![Node](https://img.shields.io/badge/Node-18%2B-green)
![MongoDB](https://img.shields.io/badge/MongoDB-6%2B-blue)
![WebRTC](https://img.shields.io/badge/WebRTC-VP9%2FVP8-orange)
![License](https://img.shields.io/badge/license-MIT-green)

## Features

- Role-based access: patient, doctor, admin
- Booking with unique per-appointment WebRTC rooms
- Video call with VP9 codec preference (23-33% bandwidth savings)
- Adaptive bitrate throttled to 70% of measured outgoing capacity
- Automatic audio-only fallback below 120 kbps for 3 samples
- Automatic video recovery above 250 kbps for 3 samples
- Live 5-bar network quality indicator (RTT, packet loss, jitter)
- In-call chat over Socket.IO relay and WebRTC data channel
- Doctor-only session notes, live-synced, persisted to the appointment
- Real-time "peer joined the call" toast with a soft beep
- ICE restart on disconnect with a 4-second grace period
- Missed appointments display a yellow MISSED badge instead of Scheduled

## Tech Stack

| Layer        | Technology                      |
| ------------ | ------------------------------- |
| Backend      | Node.js 18+, Express 4          |
| Realtime     | Socket.IO 4                     |
| Peer-to-peer | WebRTC (VP9 / VP8)              |
| Database     | MongoDB + Mongoose 8            |
| Auth         | JWT + bcryptjs                  |
| Frontend     | HTML5, CSS3, vanilla JavaScript |

## Project Structure

    telemed/
    |-- server.js
    |-- config/db.js
    |-- models/User.js
    |-- models/Appointment.js
    |-- middleware/auth.js
    |-- routes/auth.js
    |-- routes/appointments.js
    |-- routes/users.js
    |-- signaling/signaling.js
    |-- public/index.html
    |-- public/dashboard.html
    |-- public/call.html
    |-- public/css/style.css
    |-- public/js/auth.js
    |-- public/js/dashboard.js
    `-- public/js/call.js

## Prerequisites

- Node.js 18 or later
- MongoDB 6 or later running locally

Verify:

    node --version
    npm --version
    mongod --version

Install MongoDB on Windows:

    winget install --id=MongoDB.Server -e --accept-package-agreements --accept-source-agreements
    net start MongoDB

If PowerShell blocks npm:

    Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned

## Setup

    git clone https://github.com/<your-username>/telemed.git
    cd telemed
    npm install

## Running the App

    npm start

Expected:

    MongoDB connected
    TeleMed running on http://localhost:3000

Open http://localhost:3000.

## How to Use

1. Register a doctor in one browser window (Meera / meera@clinic.com / doctor123 / Doctor).
2. Register a patient in an incognito window (Ravi / ravi@gmail.com / patient123 / Patient).
3. Patient books an appointment with Dr. Meera for a few minutes from now.
4. Doctor reloads the dashboard - the appointment appears under Upcoming.
5. Doctor clicks Join call. Patient's dashboard shows a toast with a beep.
6. Patient clicks Join now in the toast - both are connected.
7. Chat: bidirectional messages.
8. Notes: doctor types and saves. Patient sees live, read-only.
9. Network throttle test: DevTools -> Network -> Slow 3G. Video degrades, audio-only banner may appear. Remove throttle - video resumes.
10. End call - both return to dashboard. Appointment shows COMPLETED.
11. Book another and don't join. After its time passes, it shows MISSED.

## Low-Bandwidth Design

### Codec selection

VP9 preferred via setCodecPreferences(). ~25% better compression than VP8 at equal quality. VP8 kept as fallback.

### Adaptive bitrate

Every 3 seconds getStats() reads availableOutgoingBitrate. Video sender maxBitrate is set to 70% of that, clamped 100 kbps to 1.5 Mbps.

### Audio-only fallback

If availableOutgoingBitrate < 120 kbps for 3 consecutive samples, video track replaced with null. If > 250 kbps for 3 samples, video restored.

### Network quality indicator

Composite of RTT (< 150 ms good, > 300 ms bad), packet loss (< 1% good, > 3% bad), jitter (< 30 ms good, > 50 ms bad), bitrate (> 500 kbps good, < 200 kbps bad). Mapped to 5 bars.

### Reconnection

pc.onconnectionstatechange triggers ICE restart after 4-second grace period.

### Media constraints

640x480, 15 fps, echo cancellation, noise suppression, auto gain control.

## API Reference

All /api/\*_ except /api/auth/_ require:

    Authorization: Bearer <jwt>

| Method | Endpoint                    | Role                |
| ------ | --------------------------- | ------------------- |
| POST   | /api/auth/register          | Public              |
| POST   | /api/auth/login             | Public              |
| GET    | /api/users/me               | Any                 |
| GET    | /api/users/doctors          | Any                 |
| GET    | /api/users                  | Admin               |
| GET    | /api/appointments           | Any (role-filtered) |
| POST   | /api/appointments           | Patient             |
| GET    | /api/appointments/:id       | Any (own)           |
| PATCH  | /api/appointments/:id/notes | Doctor              |
| GET    | /api/config                 | Any                 |

### Socket.IO events

| Event          | Direction        |
| -------------- | ---------------- |
| join-room      | client -> server |
| room-peers     | server -> client |
| peer-joined    | server -> client |
| peer-left      | server -> client |
| call-started   | server -> client |
| offer / answer | bidirectional    |
| ice-candidate  | bidirectional    |
| chat-message   | bidirectional    |
| note-update    | bidirectional    |

## Demo Flow

1. Register Dr. Meera (doctor) in a normal window.
2. Register Ravi (patient) in incognito.
3. Ravi books an appointment 2 minutes from now.
4. Meera reloads, sees the appointment under Upcoming.
5. Meera clicks Join call.
6. Ravi gets a toast with a beep: "Dr. Meera (DOCTOR) has joined the call".
7. Ravi clicks Join now.
8. Chat both ways.
9. Meera writes Notes and saves. Ravi sees them live.
10. Throttle to Slow 3G - observe adaptive bitrate and audio-only fallback.
11. End call.
12. Book another and don't join - it becomes MISSED after its time passes.

## Troubleshooting

| Symptom                      | Fix                                                                  |
| ---------------------------- | -------------------------------------------------------------------- |
| npm script error             | Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned |
| MongoDB service denied       | Run PowerShell as Administrator, then net start MongoDB              |
| MongoDB service name invalid | Install: winget install --id=MongoDB.Server                          |
| Requested device not found   | No camera/mic (common in VMs). App falls back gracefully             |
| MongoDB connection failed    | Service not running: net start MongoDB                               |
| Port 3000 in use             | set PORT=3001 then npm start                                         |
| White screen after login     | Ctrl+F5                                                              |

## Production Notes

This demo uses public Google STUN only. For real deployments behind restrictive NATs, add a TURN server to iceServers in server.js:

    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'turn:your-turn-server:3478', username: '...', credential: '...' }
    ]

Options: coturn, Twilio, Metered.ca.

Also: serve over HTTPS, rotate JWT_SECRET, add rate limiting, use a managed MongoDB.

## License

MIT

## Author

MT

- GitHub: https://github.com/MT-Pseudo
