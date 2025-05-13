const mongoose = require('mongoose');

// Device sub-schema
const deviceSchema = new mongoose.Schema({
  deviceId: {
    type: String,
    required: true,
    // No uniqueness here, as we want multiple users to be able to share the same device ID
  },
  deviceType: {
    type: String,
    required: true
  },
  deviceName: {
    type: String,
    required: true
  },
  deviceInfo: {
    userAgent: String,
    platform: String,
    screenResolution: String,
    timezone: String,
    language: String
  },
  verificationToken: {
    type: String,
    default: null
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  lastUsed: {
    type: Date,
    default: Date.now
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});


// Workspace access sub-schema
const workspaceAccessSchema = new mongoose.Schema({
  workspaceId: {
    type: String,
    required: true,
    match: /^[a-zA-Z0-9]{13}$/ // ✅ Updated to match Workspace schema
  },
  role: {
    type: String,
    enum: ['owner', 'admin', 'member', 'viewer'],
    default: 'member'
  },
  status: {
    type: String,
    enum: ['active', 'suspended', 'invited'],
    default: 'active'
  },
  joinedAt: {
    type: Date,
    default: Date.now
  }
});

// User schema
const userSchema = new mongoose.Schema({
  userId: {
    type: String,
    unique: true,
    required: true,
    match: /^[a-zA-Z0-9]{7}$/
  },
  fullName: {
    type: String,
    required: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    validate: {
      validator: function (value) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
      },
      message: 'Invalid email format'
    }
  },
  passwordHash: {
    type: String,
    required: true
  },
  workspaceId: { // ✅ Updated to allow 13-char workspace IDs
    type: String,
    required: true,
    match: /^[a-zA-Z0-9]{13}$/,
    index: true
  },
  devices: [deviceSchema],
  workspaces: [workspaceAccessSchema],
  isAccountLocked: {
    type: Boolean,
    default: false
  },
  lockUntil: {
    type: Date
  },
  failedLoginAttempts: {
    type: Number,
    default: 0
  },
  lastFailedLogin: {
    type: Date
  },
  channels: [{ type: String }],
  channelsCount: {
    type: Number,
    default: 0
  },
  agents: [{ type: String }],
  agentsCount: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  lastLogin: {
    type: Date
  }
}, {
  timestamps: true
});

// Hooks
userSchema.pre('save', function (next) {
  if (this.lockUntil && this.lockUntil < Date.now()) {
    this.isAccountLocked = false;
    this.lockUntil = null;
    this.failedLoginAttempts = 0;
  }
  next();
});

// Methods
userSchema.methods.incrementFailedLogin = function () {
  const maxFailedAttempts = 5;
  this.failedLoginAttempts += 1;
  this.lastFailedLogin = new Date();

  if (this.failedLoginAttempts >= maxFailedAttempts) {
    this.isAccountLocked = true;
    this.lockUntil = new Date(Date.now() + 15 * 60 * 1000); // lock for 15 min
  }

  return this.save();
};

userSchema.methods.resetLoginAttempts = function () {
  this.failedLoginAttempts = 0;
  this.lastFailedLogin = null;
  this.isAccountLocked = false;
  this.lockUntil = null;
  return this.save();
};

module.exports = mongoose.model('User', userSchema);
