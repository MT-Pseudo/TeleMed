import express from 'express';
import crypto from 'crypto';
import Appointment from '../models/Appointment.js';
import User from '../models/User.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const filter = req.user.role === 'doctor'
    ? { doctor: req.user.id }
    : req.user.role === 'patient'
      ? { patient: req.user.id }
      : {};
  const appointments = await Appointment.find(filter)
    .populate('patient', 'name email')
    .populate('doctor', 'name specialization')
    .sort({ date: -1 });
  res.json(appointments);
});

router.post('/', requireAuth, async (req, res) => {
  try {
    const { doctorId, date, reason } = req.body;
    const doctor = await User.findById(doctorId);
    if (!doctor || doctor.role !== 'doctor')
      return res.status(400).json({ message: 'Invalid doctor' });

    const roomId = crypto.randomBytes(8).toString('hex');
    const appt = await Appointment.create({
      patient: req.user.id,
      doctor: doctorId,
      date: new Date(date),
      reason,
      roomId
    });
    res.status(201).json(appt);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/:id', requireAuth, async (req, res) => {
  const appt = await Appointment.findById(req.params.id)
    .populate('patient', 'name')
    .populate('doctor', 'name specialization');
  if (!appt) return res.status(404).json({ message: 'Not found' });
  res.json(appt);
});

router.patch('/:id/notes', requireAuth, requireRole('doctor'), async (req, res) => {
  const appt = await Appointment.findByIdAndUpdate(
    req.params.id,
    { notes: req.body.notes, status: req.body.status || 'completed' },
    { new: true }
  );
  res.json(appt);
});

export default router;