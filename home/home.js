const express = require('express');
const router = express.Router();
const User = require('../models/User');
const redis = require('../config/redis');

router.get('/home', async (req, res) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    const userId = req.query.userId;

    if (!token || !userId) {
      return res.status(401).json({ success: false, message: 'Not logged in or session expired' });
    }

    const userData = await redis.get(`user:${userId}`);
    if (!userData) {
      return res.status(401).json({ success: false, message: 'Session expired' });
    }

    const parsedUserData = JSON.parse(userData);
    if (parsedUserData.sessionToken !== token) {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }

    // Fetch user from MongoDB to ensure data is up-to-date
    const user = await User.findOne({ email: parsedUserData.email });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Prepare response data
    const responseData = {
      success: true,
      data: {
        name: user.email.split('@')[0], // Extract name from email
        botsCount: user.botsCount || 0,
        channelsCount: user.channelsCount || 0,
        aiSpend: user.aiSpend || 0,
        botsLimit: 10,
        channelsLimit: 5,
        aiBudget: 100,
      },
    };

    // Update Redis with the latest data
    const updatedUserData = {
      email: user.email,
      deviceFingerprint: user.deviceFingerprint,
      botsCount: user.botsCount,
      channelsCount: user.channelsCount,
      lastLogin: parsedUserData.lastLogin,
      sessionToken: parsedUserData.sessionToken,
    };
    await redis.set(`user:${userId}`, JSON.stringify(updatedUserData), { EX: 604800 });

    res.status(200).json(responseData);
  } catch (error) {
    console.error('Error fetching user data:', error.message, error.stack);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching user data',
      error: error.message,
    });
  }
});

module.exports = router;