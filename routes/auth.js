const express = require('express');
const router = express.Router();
const { MailtrapClient } = require('mailtrap');
const User = require('../models/User');
const UAParser = require('ua-parser-js');
const rateLimit = require('express-rate-limit');
const { createSession } = require('./session');

// Rate limiter for login and signup
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // level minutes
  max: 5,
  message: 'Too many login attempts, please try again later.',
});

const signupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: 'Too many signup attempts, please try again later.',
});

// Generate a unique 9-character userId
const generateUserId = () => {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 9; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
};

// Generate a device fingerprint by hashing device info
const generateDeviceFingerprint = (deviceInfo) => {
  const data = `${deviceInfo.deviceName || ''}${deviceInfo.browser || ''}${deviceInfo.os || ''}${deviceInfo.deviceType || ''}`;
  return require('crypto').createHash('md5').update(data).digest('hex');
};

// Setup Mailtrap client
const mailtrapClient = new MailtrapClient({ token: process.env.MAILTRAP_TOKEN });
const sender = {
  email: process.env.MAILTRAP_SENDER_EMAIL,
  name: process.env.MAILTRAP_SENDER_NAME,
};

// Send verification email
const sendVerificationEmail = async (email, verificationCode) => {
  try {
    await mailtrapClient.send({
      from: sender,
      to: [{ email }],
      subject: "Verify your email for Stringel",
      html: `
        <h1>Welcome to Stringel!</h1>
        <p>Please verify your email by entering this code:</p>
        <h2>${verificationCode}</h2>
        <p>This code will expire in 1 hour.</p>
      `,
      category: "Email Verification",
    });
    return true;
  } catch (error) {
    console.error('Error sending verification email:', error);
    return false;
  }
};

// Register route
router.post('/register', signupLimiter, async (req, res) => {
  try {
    const { email, password, deviceInfo } = req.body;

    if (!req.redisClient || !req.redisClient.isOpen) {
      return res.status(500).json({
        success: false,
        message: 'Server error: Redis client is not connected.'
      });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'Email already exists. Please login instead.',
      });
    }

    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();

    const registrationData = {
      password,
      deviceInfo: {
        deviceName: deviceInfo.deviceName,
        browser: deviceInfo.browser,
        os: deviceInfo.os,
        deviceType: deviceInfo.deviceType,
        location: { country: deviceInfo.location?.country || 'Unknown' },
        lastLogin: deviceInfo.lastLogin ? new Date(deviceInfo.lastLogin).toISOString() : new Date().toISOString(),
      },
      verificationCode,
    };

    await req.redisClient.set(`verify:${email}`, JSON.stringify(registrationData), { EX: 3600 });

    const emailSent = await sendVerificationEmail(email, verificationCode);
    if (!emailSent) {
      return res.status(500).json({
        success: false,
        message: 'Failed to send verification email. Please try again.',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Verification email sent. Please check your inbox.',
    });
  } catch (error) {
    console.error('Registration error:', error.message, error.stack);
    res.status(500).json({
      success: false,
      message: 'Server error during registration. Please try again.',
      error: error.message,
    });
  }
});

// Verify email route
router.post('/verify-email', async (req, res) => {
  try {
    const { email, code, deviceInfo } = req.body;

    if (!req.redisClient || !req.redisClient.isOpen) {
      return res.status(500).json({
        success: false,
        message: 'Server error: Redis client is not connected.'
      });
    }

    const registration = await req.redisClient.get(`verify:${email}`);
    if (!registration) {
      return res.status(400).json({
        success: false,
        message: 'Email not found or verification expired. Please register again.',
      });
    }

    let parsedRegistration;
    try {
      parsedRegistration = JSON.parse(registration);
    } catch (error) {
      console.error('Failed to parse registration:', error.message, error.stack);
      return res.status(500).json({
        success: false,
        message: 'Server error during verification. Invalid registration data.',
        error: error.message,
      });
    }

    const { password, verificationCode } = parsedRegistration;

    if (verificationCode !== code) {
      return res.status(400).json({
        success: false,
        message: 'Invalid verification code. Please try again.',
      });
    }

    const parser = new UAParser(deviceInfo.browser);
    const ua = parser.getResult();

    const deviceFingerprint = generateDeviceFingerprint(deviceInfo);
    const userId = generateUserId();
    const lastLogin = deviceInfo.lastLogin ? new Date(deviceInfo.lastLogin).toISOString() : new Date().toISOString();

    const newUser = new User({
      userId,
      email,
      password,
      isVerified: true,
      deviceFingerprint,
      deviceInfo: [{
        deviceName: deviceInfo.deviceName,
        browser: ua.browser.name,
        os: ua.os.name,
        deviceType: ua.device.type || 'desktop',
        location: { country: deviceInfo.location?.country || 'Unknown' },
        lastLogin: lastLogin,
      }],
      botsCount: 0,
      channelsCount: 0,
      settings: {
        timezone: 'UTC',
        language: 'en',
        theme: 'light',
      },
      notificationsPrefs: {
        email: {
          enabled: true,
          types: ['collaboration', 'workflow', 'limit'],
        },
        inApp: {
          enabled: true,
          types: ['change', 'limit'],
        },
        push: {
          enabled: false,
          types: ['error'],
        },
      }
    });

    await newUser.save();

    const userData = {
      userId: newUser.userId,
      email: newUser.email,
      deviceFingerprint: newUser.deviceFingerprint,
      botsCount: newUser.botsCount,
      channelsCount: newUser.channelsCount,
      lastLogin: lastLogin,
    };

    try {
      const { sessionToken, userId: returnedUserId } = await createSession(res, userData, req.redisClient);
      
      await req.redisClient.del(`verify:${email}`);

      res.status(201).json({
        success: true,
        message: 'Email verified successfully. Account created and logged in.',
        userId: returnedUserId,
      });
    } catch (sessionError) {
      console.error('Session creation error:', sessionError.message, sessionError.stack);
      
      // Even if session creation fails, the user account has been created
      // We can still return a success but with a login required message
      res.status(201).json({
        success: true,
        message: 'Email verified and account created. Please log in.',
        userId: userData.userId,
        loginRequired: true,
      });
    }
  } catch (error) {
    console.error('Email verification error:', error.message, error.stack);
    res.status(500).json({
      success: false,
      message: 'Server error during verification. Please try again.',
      error: error.message,
    });
  }
});

// Resend verification email route
router.post('/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;

    if (!req.redisClient || !req.redisClient.isOpen) {
      return res.status(500).json({
        success: false,
        message: 'Server error: Redis client is not connected.'
      });
    }

    const registration = await req.redisClient.get(`verify:${email}`);
    if (!registration) {
      return res.status(400).json({
        success: false,
        message: 'Email not found or verification expired. Please register again.',
      });
    }

    let parsedRegistration;
    try {
      parsedRegistration = JSON.parse(registration);
    } catch (error) {
      console.error('Failed to parse registration:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Server error during verification.',
        error: error.message,
      });
    }

    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();

    const updatedRegistrationData = {
      ...parsedRegistration,
      verificationCode,
    };

    await req.redisClient.set(`verify:${email}`, JSON.stringify(updatedRegistrationData), { EX: 3600 });

    const emailSent = await sendVerificationEmail(email, verificationCode);
    if (!emailSent) {
      return res.status(500).json({
        success: false,
        message: 'Failed to send verification email. Please try again.',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Verification email resent. Please check your inbox.',
    });
  } catch (error) {
    console.error('Resend verification error:', error.message, error.stack);
    res.status(500).json({
      success: false,
      message: 'Server error. Please try again.',
      error: error.message,
    });
  }
});

// Login route
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password, deviceInfo } = req.body;

    if (!req.redisClient || !req.redisClient.isOpen) {
      return res.status(500).json({
        success: false,
        message: 'Server error: Redis client is not connected.'
      });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Email not found. Please register.',
      });
    }

    if (!user.isVerified) {
      const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
      await req.redisClient.set(`verify:${email}`, JSON.stringify({
        password: user.password,
        deviceInfo: {
          deviceName: deviceInfo.deviceName,
          browser: deviceInfo.browser,
          os: deviceInfo.os,
          deviceType: deviceInfo.deviceType,
          location: { country: deviceInfo.location?.country || 'Unknown' },
          lastLogin: deviceInfo.lastLogin ? new Date(deviceInfo.lastLogin).toISOString() : new Date().toISOString(),
        },
        verificationCode,
      }), { EX: 3600 });

      await sendVerificationEmail(email, verificationCode);
      return res.status(400).json({
        success: false,
        message: 'Email not verified. A new verification email has been sent.',
      });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Invalid password. Please try again.',
      });
    }

    const parser = new UAParser(deviceInfo.browser);
    const ua = parser.getResult();

    const deviceFingerprint = generateDeviceFingerprint(deviceInfo);
    const lastLogin = deviceInfo.lastLogin ? new Date(deviceInfo.lastLogin).toISOString() : new Date().toISOString();

    if (user.deviceFingerprint !== deviceFingerprint) {
      user.deviceFingerprint = deviceFingerprint;
    }

    const existingDevice = user.deviceInfo.find(d => d.deviceName === deviceInfo.deviceName);
    if (existingDevice) {
      existingDevice.lastLogin = new Date();
    } else {
      user.deviceInfo.push({
        deviceName: deviceInfo.deviceName,
        browser: ua.browser.name,
        os: ua.os.name,
        deviceType: ua.device.type || 'desktop',
        location: { country: deviceInfo.location?.country || 'Unknown' },
        lastLogin: lastLogin,
      });
    }
    await user.save();

    const userData = {
      userId: user.userId,
      email: user.email,
      deviceFingerprint: user.deviceFingerprint,
      botsCount: user.botsCount,
      channelsCount: user.channelsCount,
      lastLogin: lastLogin,
    };

    try {
      const { userId: returnedUserId } = await createSession(res, userData, req.redisClient);

      res.status(200).json({
        success: true,
        message: 'Login successful',
        userId: returnedUserId,
      });
    } catch (sessionError) {
      console.error('Session creation error during login:', sessionError.message, sessionError.stack);
      
      // Return a partial success but let client know there's a session issue
      res.status(200).json({
        success: true,
        message: 'Authenticated successfully, but session creation failed. Some features may be limited.',
        userId: userData.userId,
        sessionWarning: true,
      });
    }
  } catch (error) {
    console.error('Login error:', error.message, error.stack);
    res.status(500).json({
      success: false,
      message: 'Server error during login. Please try again.',
      error: error.message,
    });
  }
});

// Logout route
router.post('/logout', async (req, res) => {
  try {
    // Clear the session cookie
    res.clearCookie('sessionToken');
    
    // If we have userId and sessionToken, also remove from Redis
    if (req.userId && req.sessionToken && req.redisClient && req.redisClient.isOpen) {
      await req.redisClient.del(`${req.userId}:${req.sessionToken}`);
    }
    
    res.status(200).json({
      success: true,
      message: 'Logged out successfully',
    });
  } catch (error) {
    console.error('Logout error:', error.message, error.stack);
    res.status(500).json({
      success: false,
      message: 'Server error during logout. Please try again.',
      error: error.message,
    });
  }
});

// Get user profile route
router.get('/profile', async (req, res) => {
  try {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized. Please login.',
      });
    }

    const user = await User.findOne({ userId: req.userId }).select('-password');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found.',
      });
    }

    res.status(200).json({
      success: true,
      user: {
        userId: user.userId,
        email: user.email,
        deviceInfo: user.deviceInfo,
        botsCount: user.botsCount,
        channelsCount: user.channelsCount,
        settings: user.settings,
        notificationsPrefs: user.notificationsPrefs,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    });
  } catch (error) {
    console.error('Get profile error:', error.message, error.stack);
    res.status(500).json({
      success: false,
      message: 'Server error. Please try again.',
      error: error.message,
    });
  }
});

// Update user profile route
router.put('/profile', async (req, res) => {
  try {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized. Please login.',
      });
    }

    const { settings, notificationsPrefs } = req.body;

    const user = await User.findOne({ userId: req.userId });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found.',
      });
    }

    if (settings) {
      user.settings = {
        ...user.settings,
        ...settings,
      };
    }

    if (notificationsPrefs) {
      user.notificationsPrefs = {
        ...user.notificationsPrefs,
        ...notificationsPrefs,
      };
    }

    await user.save();

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        userId: user.userId,
        email: user.email,
        settings: user.settings,
        notificationsPrefs: user.notificationsPrefs,
      },
    });
  } catch (error) {
    console.error('Update profile error:', error.message, error.stack);
    res.status(500).json({
      success: false,
      message: 'Server error. Please try again.',
      error: error.message,
    });
  }
});

module.exports = router;