const mongoose = require('mongoose');

const specializedFieldSchema = new mongoose.Schema({
  subcategory_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Subcategory', required: true },
  name: { type: String, required: true },
  slug: { type: String, required: true },
  sort_order: { type: Number, default: 0 }
});

specializedFieldSchema.index({ subcategory_id: 1, slug: 1 }, { unique: true });

module.exports = mongoose.model('SpecializedField', specializedFieldSchema);
