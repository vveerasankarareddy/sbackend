const mongoose = require('mongoose');

// Message Schema for Storing Chats
const chatSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  channelId: { type: mongoose.Schema.Types.ObjectId, ref: 'Channel', required: true },
  messageType: { type: String, enum: ['text', 'image', 'video'], required: true },
  messageContent: { type: String },
  mediaUrl: { type: String },
  timestamp: { type: Date, default: Date.now },
  direction: { type: String, enum: ['inbound', 'outbound'], required: true },
  status: { type: String, enum: ['sent', 'delivered', 'read'], default: 'sent' },
});

module.exports = mongoose.model('Chat', chatSchema);