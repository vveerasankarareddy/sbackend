const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const redis = require('../config/redis');

// Generate a unique session token
const generateSessionToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

// Middleware to validate session token from cookie
const validateSession = async (req, res, next) => {
  try {
    const sessionToken = req.cookies.sessionToken;
    if (!sessionToken) {
      return res.status(401).json({ success: false, message: 'Unauthorized: No session token' });
    }

    const sessionData = await redis.get(`session:${sessionToken}`);
    if (!sessionData) {
      return res.status(401).json({ success: false, message: 'Session expired or invalid' });
    }

    req.session = JSON.parse(sessionData);
    next();
  } catch (error) {
    console.error('Session validation error:', error.message, error.stack);
    res.status(500).json({ success: false, message: 'Server error during session validation', error: error.message });
  }
};

// Create a session and set cookie
const createSession = async (res, userData) => {
  const sessionToken = generateSessionToken();
  const sessionData = {
    userId: userData.userId,
    email: userData.email,
    deviceFingerprint: userData.deviceFingerprint,
    botsCount: userData.botsCount,
    channelsCount: userData.channelsCount,
    lastLogin: userData.lastLogin,
  };

  await redis.set(`session:${sessionToken}`, JSON.stringify(sessionData), { EX: 604800 }); // 7 days

  res.cookie('sessionToken', sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 604800000, // 7 days in milliseconds
  });

  return { sessionToken, userId: userData.userId };
};

// Session check route
router.get('/check', validateSession, (req, res) => {
  res.json({
    success: true,
    user: { email: req.session.email, userId: req.session.userId },
  });
});

// Logout route
router.post('/logout', validateSession, async (req, res) => {
  try {
    const sessionToken = req.cookies.sessionToken;
    await redis.del(`session:${sessionToken}`);
    res.clearCookie('sessionToken');
    res.json({ success: true, message: 'Logged out' });
  } catch (error) {
    console.error('Logout error:', error.message, error.stack);
    res.status(500).json({
      success: false,
      message: 'Server error during logout',
      error: error.message,
    });
  }
});

module.exports = { router, createSession, validateSession };