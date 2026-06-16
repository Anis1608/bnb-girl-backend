const mongoose = require('mongoose');

const mentorSchema = new mongoose.Schema({
  name: { type: String, required: true },
  role: { type: String, default: '' },
  photo: { type: String, default: '' },
  bio: { type: String, default: '' },
  quote: { type: String, default: '' },
  episode_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Episode', default: null },
  linkedin: { type: String, default: '' },
  expertise_areas: { type: String, default: '' },
  rate: { type: String, default: '' },
  availability: { type: String, default: '' },
  category_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
  specialized_field_id: { type: mongoose.Schema.Types.ObjectId, ref: 'SpecializedField', default: null },
  is_featured: { type: Boolean, default: false },
  status: { type: String, default: 'published' },
  durs: { type: [String], default: ['30', '60'] },
  slots: { type: [String], default: ["09:00", "09:30", "10:00", "11:00", "11:30", "14:00", "14:30", "15:00", "16:00", "16:30"] },
  busy: { type: [String], default: ["11:00", "15:00"] },
  created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Mentor', mentorSchema);

