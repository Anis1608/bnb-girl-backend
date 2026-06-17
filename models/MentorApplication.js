const mongoose = require('mongoose');

const mentorApplicationSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true },
  role: { type: String, default: '' },
  organisation: { type: String, default: '' },
  linkedin: { type: String, default: '' },
  expertise: { type: String, default: '' },
  bio: { type: String, default: '' },
  motivation: { type: String, default: '' },
  years_exp: { type: String, default: '' },
  photo: { type: String, default: '' },
  status: { type: String, default: 'pending', enum: ['pending', 'accepted', 'rejected'] },
  notes: { type: String, default: '' },
  created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('MentorApplication', mentorApplicationSchema);
