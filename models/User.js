const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// User Schema
const userSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  isVerified: { type: Boolean, default: false },
  deviceFingerprint: { type: String }, // Add device fingerprint field
  deviceInfo: [{
    deviceName: { type: String },
    browser: { type: String },
    os: { type: String },
    deviceType: { type: String },
    location: {
      country: { type: String },
    },
    lastLogin: { type: Date },
  }],
  channelsCount: { type: Number, default: 0 },
  botsCount: { type: Number, default: 0 },
  channels: [{
    channelType: { type: String, enum: ['Instagram', 'Facebook', 'WhatsApp', 'Telegram'], required: true },
    channelUserId: { type: String, required: true },
    accessToken: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  }],
  conversations: [{
    channelId: { type: mongoose.Schema.Types.ObjectId, ref: 'Channel' },
    conversationId: { type: String, required: true },
    startTime: { type: Date, default: Date.now },
    endTime: { type: Date },
    status: { type: String, enum: ['active', 'closed'], default: 'active' },
  }]
});

userSchema.pre('save', async function (next) {
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, 10);
  }
  next();
});

userSchema.methods.comparePassword = async function (password) {
  return await bcrypt.compare(password, this.password);
};

module.exports = mongoose.model('User', userSchema);