const mongoose = require('mongoose');

const submissionSchema = new mongoose.Schema({
  form_type: { 
    type: String, 
    required: true,
    enum: ['ask_guest', 'suggest_guest', 'community', 'quiz', 'mentorship', 'guest_apply', 'mentor_apply']
  },
  data: { type: mongoose.Schema.Types.Mixed, required: true },
  ip_address: { type: String, default: '' },
  status: { type: String, default: 'new' }, // 'new', 'reviewed', 'actioned', 'spam'
  created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Submission', submissionSchema);
