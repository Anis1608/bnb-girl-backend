const mongoose = require('mongoose');

const resourceSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  resource_type: { type: String, default: 'pdf' },
  category_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
  subcategory_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Subcategory', default: null },
  specialized_field_id: { type: mongoose.Schema.Types.ObjectId, ref: 'SpecializedField', default: null },
  episode_ref: { type: String, default: '' },
  file_url: { type: String, default: '' },
  external_link: { type: String, default: '' },
  pages: { type: Number, default: 0 },
  icon: { type: String, default: '📄' },
  cover_color: { type: String, default: '' },
  is_featured: { type: Boolean, default: false },
  is_coming_soon: { type: Boolean, default: true },
  sort_order: { type: Number, default: 0 },
  status: { type: String, default: 'published' },
  created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Resource', resourceSchema);
