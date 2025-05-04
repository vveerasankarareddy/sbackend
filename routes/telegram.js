const express = require('express');
const router = express.Router();
const axios = require('axios');
const mongoose = require('mongoose');

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
 */
const isAuthenticated = async (req, res, next) => {
  try {
    // Get session token from cookies
    const sessionToken = req.cookies.sessionToken;
    
    if (!sessionToken) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }
    
    // Check if session exists in Redis
    const userId = await req.redisClient.get(`session:${sessionToken}`);
    
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Invalid or expired session' });
    }
    
    // Attach userId to request for use in route handlers
    req.userId = userId;
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
    // Instead of trying to get updates when webhook is active (which causes 409 conflict),
    // we'll either get stats another way or disable the webhook first if needed
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
    
    if (!telegramChannel) {
      // Create new document if it doesn't exist
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

module.exports = router;  