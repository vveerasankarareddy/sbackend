const express = require('express');
const router = express.Router();
const User = require('../models/User');
const TelegramChannel = require('../models/telegram');
const axios = require('axios');
const { validateSession } = require('./session');

// Utility to validate Telegram bot token format
const validateBotTokenFormat = (botToken) => {
  const botTokenRegex = /^\d{8,10}:[A-Za-z0-9_-]{35}$/;
  return botTokenRegex.test(botToken);
};

// Utility to sanitize webhook URL
const sanitizeWebhookUrl = (url) => {
  if (!url) return '';
  try {
    new URL(url);
    return url;
  } catch (error) {
    console.warn('Invalid webhookUrl, defaulting to empty string:', url);
    return '';
  }
};

// Function to validate Telegram bot token via API
const validateTelegramBotToken = async (botToken) => {
  try {
    const response = await axios.get(`https://api.telegram.org/bot${botToken}/getMe`, { timeout: 5000 });
    if (response.data.ok && response.data.result) {
      return { isValid: true, botName: response.data.result.username };
    }
    return { isValid: false, message: 'Invalid bot token response' };
  } catch (error) {
    console.error('Telegram bot token validation failed:', {
      message: error.message,
      response: error.response?.data,
      stack: error.stack,
    });
    return { isValid: false, message: 'Failed to validate bot token' };
  }
};

// Function to check for duplicate bot token
const checkDuplicateBotToken = async (botToken) => {
  try {
    const existingChannel = await TelegramChannel.findOne({ botToken }).exec();
    if (existingChannel) {
      console.log('Duplicate bot token found in TelegramChannel:', botToken);
      return true;
    }
    const userWithToken = await User.findOne({ 'channels.botToken': botToken }).exec();
    if (userWithToken) {
      console.log('Duplicate bot token found in User channels:', botToken);
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error checking duplicate bot token:', {
      message: error.message,
      stack: error.stack,
    });
    throw new Error('Failed to check for duplicate bot token');
  }
};

// Function to update channel count in User and Redis
const updateChannelCount = async (redisClient, userId, sessionToken) => {
  try {
    const user = await User.findOne({ userId }).exec();
    if (!user) throw new Error(`User not found for channel count update: ${userId}`);

    const channelsCount = user.channels.length;
    console.log('Calculated channels count:', channelsCount);

    await User.findOneAndUpdate(
      { userId },
      { $set: { channelsCount } },
      { new: true, runValidators: true }
    ).exec();

    const sessionData = await redisClient.get(`session:${sessionToken}`);
    if (!sessionData) throw new Error('Session not found in Redis for update');

    let session;
    try {
      session = JSON.parse(sessionData);
    } catch (error) {
      throw new Error('Failed to parse Redis session data');
    }

    session.channelsCount = channelsCount;
    await redisClient.setEx(`session:${sessionToken}`, 604800, JSON.stringify(session));
    console.log('Redis updated with channelsCount:', channelsCount);
  } catch (error) {
    console.error('Error updating channel count:', {
      message: error.message,
      stack: error.stack,
    });
    throw error;
  }
};

// Main route for updating bot token and creating channel
router.post('/telegram/update-bot-token', validateSession, async (req, res) => {
  const requestStartTime = Date.now();
  const requestId = mongoose.Types.ObjectId().toHexString();
  console.log(`[Request ${requestId}] Starting /telegram/update-bot-token on worker ${req.workerIndex}`);

  try {
    const { botToken, webhookUrl } = req.body;
    const { redisClient, db } = req;

    if (!redisClient) throw new Error('Redis client unavailable');
    if (!sessionToken) throw new Error('Session token missing');

    if (!botToken || !validateBotTokenFormat(botToken)) {
      throw new Error('Invalid bot token format');
    }

    const sanitizedWebhookUrl = sanitizeWebhookUrl(webhookUrl);

    const sessionData = await redisClient.get(`session:${sessionToken}`);
    if (!sessionData) throw new Error('Session expired or invalid');

    let session;
    try {
      session = JSON.parse(sessionData);
    } catch (error) {
      throw new Error('Invalid session data');
    }

    const redisUserId = session.userId;
    console.log(`[Request ${requestId}] Retrieved userId from Redis:`, redisUserId);

    const user = await User.findOne({ userId: redisUserId }).exec();
    if (!user) throw new Error('User not found');

    const dbUserId = user.userId;
    console.log(`[Request ${requestId}] Using userId from database:`, dbUserId);

    const tokenValidation = await validateTelegramBotToken(botToken);
    if (!tokenValidation.isValid) throw new Error(tokenValidation.message);

    const botName = tokenValidation.botName;

    const isDuplicate = await checkDuplicateBotToken(botToken);
    if (isDuplicate) throw new Error('This bot token is already in use');

    const sessionMongo = await db.startSession();
    try {
      await sessionMongo.withTransaction(async () => {
        const updatedUser = await User.findOneAndUpdate(
          { userId: dbUserId },
          {
            $push: {
              channels: {
                channelType: 'Telegram',
                channelUserId: dbUserId,
                botToken,
                botName,
                usage: { messagesSent: 0, activeUsers: 0, errors: 0 },
              }
            },
            $inc: { botsCount: 1 }
          },
          { new: true, runValidators: true, session: sessionMongo }
        ).exec();

        if (!updatedUser) throw new Error('User update failed');

        const telegramChannel = new TelegramChannel({
          userId: dbUserId,
          channelUserId: dbUserId,
          botToken,
          botName,
          webhookUrl: sanitizedWebhookUrl,
          status: 'working'
        });

        await telegramChannel.save({ session: sessionMongo });
      });

      await updateChannelCount(redisClient, dbUserId, sessionToken);

      console.log(`[Request ${requestId}] Successfully created channel in ${Date.now() - requestStartTime}ms`);
      res.status(200).json({ success: true, message: 'Bot token updated and channel created', botName });
    } catch (error) {
      throw error;
    } finally {
      await sessionMongo.endSession();
    }
  } catch (error) {
    console.error(`[Request ${requestId}] Server error in /telegram/update-bot-token:`, {
      message: error.message,
      stack: error.stack,
      duration: `${Date.now() - requestStartTime}ms`,
      worker: req.workerIndex,
    });
    res.status(error.message.includes('already in use') ? 400 : 500).json({
      success: false,
      message: error.message || 'Server error',
    });
  }
});

module.exports = router;