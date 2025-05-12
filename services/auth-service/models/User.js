const mongoose = require('mongoose');

const deviceSchema = new mongoose.Schema({
  deviceId: { type: String, required: true },
  deviceType: { type: String, required: true }, // e.g., "mobile", "Windows", "Mac"
  deviceName: { type: String, required: true }, // e.g., "Chrome", "Firefox"
  lastUsed: { type: Date, default: Date.now },
  isActive: { type: Boolean, default: true },
});

const userSchema = new mongoose.Schema({
  userId: { type: String, unique: true },
  fullName: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  devices: [deviceSchema],
  channels: [{ type: String }],
  channelsCount: { type: Number, default: 0 },
  agents: [{ type: String }],
  agentsCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  lastLogin: { type: Date },
});

userSchema.pre('save', async function (next) {
  if (!this.userId) {
    this.userId = this._id.toString();
  }
  next();
});

module.exports = mongoose.model('User', userSchema);