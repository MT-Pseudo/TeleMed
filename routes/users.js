import express from 'express';
import User from '../models/User.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = express.Router();

router.get('/me', requireAuth, async (req, res) => {
  const user = await User.findById(req.user.id).select('-password');
  res.json(user);
});

router.get('/doctors', requireAuth, async (_req, res) => {
  const doctors = await User.find({ role: 'doctor' }).select('name specialization');
  res.json(doctors);
});

router.get('/', requireAuth, requireRole('admin'), async (_req, res) => {
  const users = await User.find().select('-password');
  res.json(users);
});

export default router;