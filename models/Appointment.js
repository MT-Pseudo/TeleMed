import mongoose from 'mongoose';

const appointmentSchema = new mongoose.Schema({
  patient:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  doctor:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date:     { type: Date, required: true },
  reason:   { type: String, default: '' },
  status:   { type: String, enum: ['scheduled', 'completed', 'cancelled'], default: 'scheduled' },
  roomId:   { type: String, required: true, unique: true },
  notes:    { type: String, default: '' },
  createdAt:{ type: Date, default: Date.now }
});

export default mongoose.model('Appointment', appointmentSchema);