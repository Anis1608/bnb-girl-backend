const mongoose = require('mongoose');

const subcategorySchema = new mongoose.Schema({
  category_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
  name: { type: String, required: true },
  slug: { type: String, required: true },
  sort_order: { type: Number, default: 0 }
});

// Compound index to allow same subcategory slug in different categories if needed, but keep unique within a category
subcategorySchema.index({ category_id: 1, slug: 1 }, { unique: true });

module.exports = mongoose.model('Subcategory', subcategorySchema);
