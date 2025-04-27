const mongoose = require('mongoose');

// Channel Schema for Storing Channel Specific Data
const channelSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  channelType: { type: String, enum: ['Instagram', 'Facebook', 'WhatsApp', 'Telegram'], required: true },
  channelUserId: { type: String, required: true },
  accessToken: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Channel', channelSchema);