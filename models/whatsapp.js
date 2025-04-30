const mongoose = require('mongoose');

const whatsappChannelSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  businessNumber: { type: String, required: true },
  apiKey: { type: String, required: true },
  webhookUrl: { type: String },
  usage: {
    messagesSent: { type: Number, default: 0 },
    activeUsers: { type: Number, default: 0 },
    errors: { type: Number, default: 0 },
  },
  workflowIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Workflow' }],
  notificationSettings: {
    enabled: { type: Boolean, default: true },
    alertOnFailure: { type: Boolean, default: true },
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('WhatsAppChannel', whatsappChannelSchema);
