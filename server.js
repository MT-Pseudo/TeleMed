import 'dotenv/config';
import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server } from 'socket.io';
import { connectDB } from './config/db.js';
import authRoutes from './routes/auth.js';
import appointmentRoutes from './routes/appointments.js';
import userRoutes from './routes/users.js';
import { initSignaling } from './signaling/signaling.js';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

app.use('/api/auth',         authRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/users',        userRoutes);

app.get('/api/config', (_req, res) => {
  res.json({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
});

initSignaling(io);

const PORT = process.env.PORT || 3000;
connectDB().then(() => {
  server.listen(PORT, () => console.log(`TeleMed running on http://localhost:${PORT}`));
});