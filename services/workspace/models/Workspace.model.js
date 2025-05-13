const mongoose = require('mongoose');

const WorkspaceSchema = new mongoose.Schema({
  workspaceId: {
    type: String,
    unique: true,
    required: true,
    match: [/^[a-zA-Z0-9]{13}$/, 'Invalid workspace ID format']
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  owner: {
    type: String,
    required: true,
    match: /^[a-zA-Z0-9]{7}$/
  },
  members: [{
    userId: {
      type: String,
      required: true,
      match: /^[a-zA-Z0-9]{7}$/
    },
    role: {
      type: String,
      enum: ['owner', 'admin', 'member', 'viewer'],
      default: 'member'
    },
    status: {
      type: String,
      enum: ['active', 'invited', 'suspended'],
      default: 'active'
    },
    joinedAt: {
      type: Date,
      default: Date.now
    },
    _id: false // Disable _id for members
  }],
  channels: [{
    channelId: {
      type: String,
      required: true,
      match: /^[a-zA-Z0-9]{10}$/
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    createdAt: {
      type: Date,
      default: Date.now
    },
    _id: false // Disable _id for channels
  }]
}, {
  timestamps: true
});

// Validation to ensure owner is always a member with owner role
WorkspaceSchema.pre('save', function(next) {
  const ownerExists = this.members.some(member =>
    member.userId === this.owner && member.role === 'owner'
  );

  if (!ownerExists) {
    this.members.push({
      userId: this.owner,
      role: 'owner',
      status: 'active',
      joinedAt: new Date()
    });
  }

  next();
});

// Ensure unique workspace name per owner
WorkspaceSchema.index({ name: 1, owner: 1 }, { unique: true });

module.exports = mongoose.model('Workspace', WorkspaceSchema);