const mongoose = require('mongoose');

const telegramChannelSchema = new mongoose.Schema({
  userId: { type: String, required: true }, // Changed to String to match the custom userId
  botToken: { type: String, required: true, unique: true },
  botName: { type: String },
  webhookUrl: { type: String },
  
  usage: {
    messagesSent: { type: Number, default: 0 },
    activeUsers: { type: Number, default: 0 },
    errors: { type: Number, default: 0 },
  },
  
  workflowCount: { type: Number, default: 0 },
  automationCount: { type: Number, default: 0 },
  
  // Channel status to track if it's working, not working, or live
  status: {
    type: String,
    enum: ['working', 'not working', 'live'],
    default: 'working', // Default to 'working' until explicitly set
  },
  
  workflows: [
    {
      name: { type: String, required: true },
      description: { type: String },
      isActive: { type: Boolean, default: true },
      nodes: [
        {
          id: { type: String, required: true },
          type: { type: String, required: true },
          data: { type: mongoose.Schema.Types.Mixed },
          position: {
            x: { type: Number },
            y: { type: Number },
          },
        },
      ],
      edges: [
        {
          source: { type: String, required: true },
          target: { type: String, required: true },
        },
      ],
      createdAt: { type: Date, default: Date.now },
      updatedAt: { type: Date, default: Date.now },
    },
  ],
  
  automations: [
    {
      name: { type: String, required: true },
      trigger: {
        type: { type: String, required: true },
        value: { type: mongoose.Schema.Types.Mixed },
      },
      actions: [
        {
          type: { type: String, required: true },
          payload: { type: mongoose.Schema.Types.Mixed },
        },
      ],
      isActive: { type: Boolean, default: true },
      createdAt: { type: Date, default: Date.now },
      updatedAt: { type: Date, default: Date.now },
    },
  ],
  
  notificationSettings: {
    enabled: { type: Boolean, default: true },
    alertOnFailure: { type: Boolean, default: true },
  },
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Create the model only if it hasn't been registered yet
let TelegramChannel;
try {
  // If the model is already registered, mongoose.model() will throw an error
  TelegramChannel = mongoose.model('TelegramChannel');
} catch (e) {
  // If the model doesn't exist yet, register it
  TelegramChannel = mongoose.model('TelegramChannel', telegramChannelSchema);
}

module.exports = TelegramChannel;