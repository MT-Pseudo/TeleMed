import jwt from 'jsonwebtoken';
import Appointment from '../models/Appointment.js';

const rooms = new Map();
const socketUser = new Map();
const userSockets = new Map();

export function initSignaling(io) {
  io.use((socket, next) => {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (!token) return next(new Error('No token'));
    try {
      socket.user = jwt.verify(token, process.env.JWT_SECRET);
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    console.log('Socket connected:', socket.id, socket.user.name);

    const uid = String(socket.user.id);
    if (!userSockets.has(uid)) userSockets.set(uid, new Set());
    userSockets.get(uid).add(socket.id);

    socket.on('join-room', async ({ roomId }) => {
      socket.join(roomId);
      if (!rooms.has(roomId)) rooms.set(roomId, new Set());
      rooms.get(roomId).add(socket.id);
      socketUser.set(socket.id, { ...socket.user, roomId });

      socket.to(roomId).emit('peer-joined', {
        socketId: socket.id,
        name: socket.user.name,
        role: socket.user.role
      });

      const peers = [...(rooms.get(roomId) || [])]
        .filter(id => id !== socket.id)
        .map(id => ({ socketId: id, ...socketUser.get(id) }));
      socket.emit('room-peers', peers);

      try {
        const appt = await Appointment.findOne({ roomId });
        if (appt) {
          const joinerId = String(socket.user.id);
          const otherId = joinerId === String(appt.doctor)
            ? String(appt.patient)
            : String(appt.doctor);
          const targetSockets = userSockets.get(otherId);
          if (targetSockets) {
            for (const sid of targetSockets) {
              io.to(sid).emit('call-started', {
                appointmentId: String(appt._id),
                from: socket.user.name,
                fromRole: socket.user.role
              });
            }
          }
        }
      } catch (e) {
        console.error('call-started notify failed:', e.message);
      }
    });

    socket.on('offer',  ({ to, sdp }) => io.to(to).emit('offer',  { from: socket.id, sdp }));
    socket.on('answer', ({ to, sdp }) => io.to(to).emit('answer', { from: socket.id, sdp }));
    socket.on('ice-candidate', ({ to, candidate }) =>
      io.to(to).emit('ice-candidate', { from: socket.id, candidate }));

    socket.on('chat-message', ({ roomId, text }) => {
      const user = socketUser.get(socket.id);
      io.to(roomId).emit('chat-message', {
        from: socket.id,
        name: user ? user.name : 'Anonymous',
        role: user ? user.role : null,
        text,
        ts: Date.now()
      });
    });

    socket.on('note-update', ({ roomId, note }) => {
      socket.to(roomId).emit('note-update', { note });
    });

    socket.on('leave-room', () => cleanup(socket));

    socket.on('disconnect', () => {
      console.log('Socket disconnected:', socket.id);
      cleanup(socket);
    });
  });
}

function cleanup(socket) {
  const uid = String(socket.user.id);
  const set = userSockets.get(uid);
  if (set) {
    set.delete(socket.id);
    if (set.size === 0) userSockets.delete(uid);
  }

  const info = socketUser.get(socket.id);
  if (!info) return;
  const roomId = info.roomId;
  socket.leave(roomId);
  const roomSet = rooms.get(roomId);
  if (roomSet) {
    roomSet.delete(socket.id);
    if (roomSet.size === 0) rooms.delete(roomId);
  }
  socket.to(roomId).emit('peer-left', { socketId: socket.id });
  socketUser.delete(socket.id);
}