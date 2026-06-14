const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
  name: { type: String, required: true },
  slug: { type: String, required: true, unique: true },
  color: { type: String, default: '#9333EA' },
  icon: { type: String, default: '📚' },
  description: { type: String, default: '' },
  sort_order: { type: Number, default: 0 }
});

module.exports = mongoose.model('Category', categorySchema);
