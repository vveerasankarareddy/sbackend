const express = require('express');
const router = express.Router();
const axios = require('axios');
const mongoose = require('mongoose');
const UserUpdateService = require('../services/userchannelsupdateservice');

// TelegramChannel model schema definition if not defined elsewhere
const telegramChannelSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  botToken: { type: String, required: true, unique: true },
  botName: { type: String, required: true },
  webhookUrl: { type: String, default: null },
  status: { type: String, enum: ['live', 'working', 'not working'], default: 'working' },
  usage: {
    messagesSent: { type: Number, default: 0 },
    activeUsers: { type: Number, default: 0 },
    errors: { type: Number, default: 0 }
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Register model if it doesn't exist
let TelegramChannel;
try {
  TelegramChannel = mongoose.model('TelegramChannel');
} catch (e) {
  TelegramChannel = mongoose.model('TelegramChannel', telegramChannelSchema);
}

/**
 * Middleware to check if the user is authenticated
 * Uses the session storage pattern: ${userId}:${sessionToken}
 */
const isAuthenticated = async (req, res, next) => {
  try {
    // Get session token from cookies
    const sessionToken = req.cookies.sessionToken;
    
    if (!sessionToken) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }
    
    // Find all sessions with this token (should be only one)
    const allSessions = await req.redisClient.keys('*:' + sessionToken);
    
    if (!allSessions || allSessions.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid or expired session' });
    }
    
    // Get the userId from the first part of the key (before :)
    const redisCacheKey = allSessions[0];
    const userId = redisCacheKey.split(':')[0];
    
    // Verify session data exists
    const sessionData = await req.redisClient.get(redisCacheKey);
    
    if (!sessionData) {
      return res.status(401).json({ success: false, message: 'Invalid or expired session' });
    }
    
    // Parse session data
    const session = JSON.parse(sessionData);
    
    // Attach userId to request for use in route handlers
    req.userId = session.userId;
    req.userEmail = session.email;
    req.sessionToken = sessionToken;
    
    // Refresh session expiry (rolling expiration)
    await req.redisClient.expire(redisCacheKey, 7 * 24 * 60 * 60);
    
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(500).json({ success: false, message: 'Authentication error' });
  }
};

/**
 * Validates a Telegram bot token
 * @param {string} botToken - Token to validate
 * @returns {Promise<boolean>} - Whether the token is valid
 */
async function validateBotToken(botToken) {
  try {
    const response = await axios.get(`https://api.telegram.org/bot${botToken}/getMe`);
    return response.data.ok === true;
  } catch (error) {
    return false;
  }
}

/**
 * Fetches data from a Telegram bot and stores/updates it in the database
 * @param {string} botToken - The bot's token
 * @param {string} userId - ID of the user who owns the bot
 * @param {string} [customBotName] - Optional custom name
 * @returns {Promise<Object>} - The bot data object
 */
async function fetchTelegramBotDataAndStore(botToken, userId, customBotName = null) {
  try {
    // 1. Get bot information using Telegram API
    const botInfo = await axios.get(`https://api.telegram.org/bot${botToken}/getMe`);
    
    if (!botInfo.data.ok) {
      throw new Error('Failed to fetch bot info: ' + botInfo.data.description);
    }
    
    const telegramBotData = botInfo.data.result;
    
    // 2. Get webhook info
    const webhookInfo = await axios.get(`https://api.telegram.org/bot${botToken}/getWebhookInfo`);
    const webhookUrl = webhookInfo.data.ok ? webhookInfo.data.result.url : null;
    
    // 3. Check if webhook is set - if so, we can't use getUpdates directly
    let uniqueUsers = new Set();
    let messageCount = 0;
    let errorCount = 0;

    // Only try to get updates if no webhook is set
    if (!webhookUrl) {
      try {
        const updates = await axios.get(`https://api.telegram.org/bot${botToken}/getUpdates?limit=100`);
        
        if (updates.data.ok) {
          messageCount = updates.data.result.length;
          
          updates.data.result.forEach(update => {
            if (update.message && update.message.from) {
              uniqueUsers.add(update.message.from.id);
            } else if (update.callback_query && update.callback_query.from) {
              uniqueUsers.add(update.callback_query.from.id);
            }
            
            if (update.message && update.message.text === '/error') {
              errorCount++;
            }
          });
        }
      } catch (updateError) {
        console.warn(`Could not get updates for bot ${botToken}: ${updateError.message}`);
        // Continue with the bot registration, just with fewer stats
      }
    }
    
    // 4. Find or create the TelegramChannel document
    let telegramChannel = await TelegramChannel.findOne({ botToken });
    let isNewBot = false;
    
    if (!telegramChannel) {
      // Create new document if it doesn't exist
      isNewBot = true;
      telegramChannel = new TelegramChannel({
        userId,
        botToken,
        botName: customBotName || telegramBotData.first_name,
        webhookUrl,
        usage: {
          messagesSent: messageCount,
          activeUsers: uniqueUsers.size,
          errors: errorCount
        },
        status: webhookUrl ? 'live' : 'working'
      });
    } else {
      // Update existing document
      telegramChannel.botName = customBotName || telegramBotData.first_name;
      telegramChannel.webhookUrl = webhookUrl;
      
      // Only update message count if we successfully retrieved updates
      if (!webhookUrl) {
        telegramChannel.usage.messagesSent += messageCount;
        telegramChannel.usage.activeUsers = Math.max(uniqueUsers.size, telegramChannel.usage.activeUsers);
        telegramChannel.usage.errors += errorCount;
      }
      
      telegramChannel.status = webhookUrl ? 'live' : 'working';
      telegramChannel.updatedAt = Date.now();
    }
    
    // 5. Save the document to the database
    await telegramChannel.save();
    console.log(`Data for bot ${telegramChannel.botName} successfully stored/updated`);
    
    // 6. Update user data if it's a new bot
    if (isNewBot) {
      try {
        await UserUpdateService.handleNewTelegramBot(userId, telegramChannel);
      } catch (userUpdateError) {
        console.error(`Failed to update user data for new bot: ${userUpdateError.message}`);
        // Continue anyway - the bot is still saved
      }
    } else {
      // Sync all Telegram data to keep user document updated
      try {
        await UserUpdateService.syncTelegramChannelsData(userId);
      } catch (syncError) {
        console.error(`Failed to sync user's Telegram data: ${syncError.message}`);
      }
    }
    
    return telegramChannel;
  } catch (error) {
    console.error('Error fetching or storing Telegram bot data:', error.message);
    
    // If the error is related to the bot token being invalid, we still want to record this
    if (error.response && error.response.data && error.response.data.description === 'Unauthorized') {
      // Create or update with error status
      try {
        let telegramChannel = await TelegramChannel.findOne({ botToken });
        
        if (!telegramChannel) {
          telegramChannel = new TelegramChannel({
            userId,
            botToken,
            botName: customBotName || 'Invalid Bot',
            status: 'not working',
            usage: {
              errors: 1
            }
          });
        } else {
          telegramChannel.status = 'not working';
          telegramChannel.usage.errors += 1;
          telegramChannel.updatedAt = Date.now();
        }
        
        await telegramChannel.save();
        console.log(`Error status recorded for invalid bot token`);
        return telegramChannel;
      } catch (dbError) {
        console.error('Failed to record error status in database:', dbError);
        throw dbError;
      }
    }
    
    throw error;
  }
}

/**
 * Retrieves all bots for a specific user
 * @param {string} userId - The user ID
 * @returns {Promise<Array>} - Array of user's bots
 */
async function getUserBots(userId) {
  try {
    const userBots = await TelegramChannel.find({ userId });
    return userBots;
  } catch (error) {
    console.error(`Error retrieving bots for user ${userId}:`, error);
    throw error;
  }
}

/**
 * Update or create a Telegram bot with the provided token
 */
router.post('/telegram/update-bot-token', isAuthenticated, async (req, res) => {
  try {
    const { botToken, botName } = req.body;
    const userId = req.userId;
    
    if (!botToken) {
      return res.status(400).json({ success: false, message: 'Bot token is required' });
    }
    
    // Validate bot token
    const isValid = await validateBotToken(botToken);
    if (!isValid) {
      return res.status(400).json({ success: false, message: 'Invalid Telegram bot token' });
    }
    
    // Fetch data and store in database
    const telegramData = await fetchTelegramBotDataAndStore(botToken, userId, botName);
    
    // Return success with bot info
    res.json({ 
      success: true, 
      message: 'Bot token updated successfully',
      botId: telegramData._id,
      botName: telegramData.botName,
      status: telegramData.status
    });
  } catch (error) {
    console.error('Error updating bot token:', error);
    res.status(500).json({ success: false, message: 'Failed to update bot token' });
  }
});

/**
 * Get data for a specific bot
 */
router.get('/telegram/get-bot-data/:botId', isAuthenticated, async (req, res) => {
  try {
    const { botId } = req.params;
    const userId = req.userId;
    
    // Find the bot and ensure it belongs to the user
    const botData = await TelegramChannel.findOne({ _id: botId, userId });
    
    if (!botData) {
      return res.status(404).json({ success: false, message: 'Bot not found or access denied' });
    }
    
    // Return bot data
    res.json({ success: true, data: botData });
  } catch (error) {
    console.error('Error getting bot data:', error);
    res.status(500).json({ success: false, message: 'Failed to get bot data' });
  }
});

/**
 * Get all bots for the authenticated user
 */
router.get('/telegram/get-user-bots', isAuthenticated, async (req, res) => {
  try {
    const userId = req.userId;
    
    // Get all bots for this user
    const userBots = await getUserBots(userId);
    
    // Sync Telegram channel count with user profile
    try {
      await UserUpdateService.syncTelegramChannelsCount(userId);
    } catch (syncError) {
      console.warn(`Could not sync channel count: ${syncError.message}`);
      // Continue anyway - we still have the bots data
    }
    
    res.json({ 
      success: true, 
      data: userBots,
      totalBots: userBots.length
    });
  } catch (error) {
    console.error('Error getting user bots:', error);
    res.status(500).json({ success: false, message: 'Failed to get user bots' });
  }
});

/**
 * Delete a specific bot
 */
router.delete('/telegram/delete-bot/:botId', isAuthenticated, async (req, res) => {
  try {
    const { botId } = req.params;
    const userId = req.userId;
    
    // Find and delete the bot, ensuring it belongs to the user
    const result = await TelegramChannel.findOneAndDelete({ _id: botId, userId });
    
    if (!result) {
      return res.status(404).json({ success: false, message: 'Bot not found or access denied' });
    }
    
    // Update user data after bot deletion
    try {
      await UserUpdateService.handleDeletedTelegramBot(userId, botId);
    } catch (userUpdateError) {
      console.error(`Failed to update user data after bot deletion: ${userUpdateError.message}`);
      // Continue anyway - the bot is still deleted
    }
    
    res.json({ success: true, message: 'Bot deleted successfully' });
  } catch (error) {
    console.error('Error deleting bot:', error);
    res.status(500).json({ success: false, message: 'Failed to delete bot' });
  }
});

/**
 * Refresh bot data from Telegram API
 */
router.post('/telegram/refresh-bot/:botId', isAuthenticated, async (req, res) => {
  try {
    const { botId } = req.params;
    const userId = req.userId;
    
    // Find the bot and ensure it belongs to the user
    const botData = await TelegramChannel.findOne({ _id: botId, userId });
    
    if (!botData) {
      return res.status(404).json({ success: false, message: 'Bot not found or access denied' });
    }
    
    // Refresh the bot data
    const refreshedData = await fetchTelegramBotDataAndStore(botData.botToken, userId, botData.botName);
    
    // Perform full sync of user data to ensure consistency
    try {
      await UserUpdateService.fullSyncUserTelegramData(userId);
    } catch (syncError) {
      console.error(`Failed to fully sync user data: ${syncError.message}`);
      // Continue anyway - the bot data is still refreshed
    }
    
    res.json({ 
      success: true, 
      message: 'Bot data refreshed successfully',
      data: refreshedData
    });
  } catch (error) {
    console.error('Error refreshing bot data:', error);
    res.status(500).json({ success: false, message: 'Failed to refresh bot data' });
  }
});

/**
 * Remove webhook for a specific bot (useful when conflict occurs)
 */
router.post('/telegram/remove-webhook/:botId', isAuthenticated, async (req, res) => {
  try {
    const { botId } = req.params;
    const userId = req.userId;
    
    // Find the bot and ensure it belongs to the user
    const botData = await TelegramChannel.findOne({ _id: botId, userId });
    
    if (!botData) {
      return res.status(404).json({ success: false, message: 'Bot not found or access denied' });
    }
    
    // Remove webhook
    const response = await axios.get(`https://api.telegram.org/bot${botData.botToken}/deleteWebhook`);
    
    if (!response.data.ok) {
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to remove webhook',
        description: response.data.description 
      });
    }
    
    // Update bot data
    botData.webhookUrl = null;
    botData.status = 'working';
    botData.updatedAt = Date.now();
    await botData.save();
    
    // Sync Telegram data in user profile
    try {
      await UserUpdateService.syncTelegramChannelsData(userId);
    } catch (syncError) {
      console.error(`Failed to sync user's Telegram data: ${syncError.message}`);
      // Continue anyway - the webhook is still removed
    }
    
    res.json({ 
      success: true, 
      message: 'Webhook removed successfully',
      data: botData
    });
  } catch (error) {
    console.error('Error removing webhook:', error);
    res.status(500).json({ success: false, message: 'Failed to remove webhook' });
  }
});

/**
 * Force sync all Telegram data for the user
 */
router.post('/telegram/sync-user-data', isAuthenticated, async (req, res) => {
  try {
    const userId = req.userId;
    
    // Perform full sync of user data
    const syncResult = await UserUpdateService.fullSyncUserTelegramData(userId);
    
    res.json({
      success: true,
      message: 'User Telegram data synchronized successfully',
      channelsCount: syncResult.userData.channelsCount || 0
    });
  } catch (error) {
    console.error('Error syncing user Telegram data:', error);
    res.status(500).json({ success: false, message: 'Failed to sync user Telegram data' });
  }
});

module.exports = router;