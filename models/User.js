const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  isVerified: { type: Boolean, default: false },
  
  deviceFingerprint: { type: String },
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
    channelType: {
      type: String,
      enum: ['Instagram', 'Facebook', 'WhatsApp', 'Telegram'],
      required: true,
    },
    channelUserId: { type: String, required: true },
    accessToken: { type: String, required: false },
    botToken: { type: String },   // Optional: for Telegram bots
    botName: { type: String },    // Optional: for Telegram bots
    usage: {
      messagesSent: { type: Number, default: 0 },
      activeUsers: { type: Number, default: 0 },
      errors: { type: Number, default: 0 },
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  }],
  
  bots: [{
    botType: {
      type: String,
      enum: ['Telegram Bot', 'WhatsApp Bot', 'Custom Bot'],
      required: true,
    },
    botName: { type: String, required: true },
    botToken: { type: String },
    channelId: { type: mongoose.Schema.Types.ObjectId, ref: 'Channel' },
    settings: {
      webhook: { type: String },
      welcomeMessage: { type: String },
    },
    usageData: {
      messagesSent: { type: Number, default: 0 },
      activeUsers: { type: Number, default: 0 },
      errors: { type: Number, default: 0 },
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  }],
  
  settings: {
    timezone: { type: String, default: 'UTC' },
    language: { type: String, default: 'en' },
    theme: { type: String, default: 'light' },
    apiKey: { type: String },
  },
  
  notificationsPrefs: {
    email: {
      enabled: { type: Boolean, default: true },
      types: [{ type: String, enum: ['collaboration', 'workflow', 'limit'] }],
    },
    inApp: {
      enabled: { type: Boolean, default: true },
      types: [{ type: String, enum: ['change', 'limit'] }],
    },
    push: {
      enabled: { type: Boolean, default: false },
      types: [{ type: String, enum: ['error'] }],
    },
  }
}, { timestamps: true }); // Adds createdAt and updatedAt automatically

// Hash password before saving
userSchema.pre('save', async function (next) {
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, 10);
  }
  next();
});

// Compare password method
userSchema.methods.comparePassword = async function (password) {
  return await bcrypt.compare(password, this.password);
};

// Create the model only if it hasn't been registered yet
let User;
try {
  User = mongoose.model('User');
} catch (e) {
  User = mongoose.model('User', userSchema);
}

module.exports = User;