const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username: { type: String, sparse: true, unique: true },
  email: { type: String, sparse: true, unique: true },
  name: { type: String, default: '' },
  password: { type: String },
  role: { type: String, default: 'customer' }, // 'admin' or 'customer'
  firebaseUid: { type: String, sparse: true, unique: true }
});

userSchema.pre('save', async function(next) {
  if (this.email) {
    this.email = this.email.toLowerCase();
  }
  if (!this.password || !this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);

