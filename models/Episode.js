const mongoose = require('mongoose');

const episodeSchema = new mongoose.Schema({
  title: { type: String, required: true },
  guest_name: { type: String, default: '' },
  guest_role: { type: String, default: '' },
  guest_photo: { type: String, default: '' },
  guest_bio: { type: String, default: '' },
  guest_quote: { type: String, default: '' },
  episode_number: { type: String, default: '' },
  category_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
  subcategory_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Subcategory', default: null },
  specialized_field_id: { type: mongoose.Schema.Types.ObjectId, ref: 'SpecializedField', default: null },
  episode_type: { type: String, default: 'Interview' },
  youtube_id: { type: String, default: '' },
  spotify_url: { type: String, default: '' },
  audio_url: { type: String, default: '' },
  pdf_url: { type: String, default: '' },
  duration: { type: String, default: '' },
  description: { type: String, default: '' },
  tags: { type: String, default: '' },
  is_featured: { type: Boolean, default: false },
  is_new: { type: Boolean, default: true },
  is_mentor: { type: Boolean, default: false },
  mentor_rate: { type: String, default: '' },
  mentor_avail: { type: String, default: '' },
  mentor_linkedin: { type: String, default: '' },
  mentor_fields: { type: String, default: '' },
  status: { type: String, default: 'published' },
  durs: { type: [String], default: ['30', '60'] },
  slots: { type: [String], default: ["09:00", "09:30", "10:00", "11:00", "11:30", "14:00", "14:30", "15:00", "16:00", "16:30"] },
  busy: { type: [String], default: ["11:00", "15:00"] },
  pricing: { type: Map, of: String, default: {} },
  created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Episode', episodeSchema);

