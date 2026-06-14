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
  created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Mentor', mentorSchema);
