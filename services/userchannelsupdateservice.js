// services/userchannelsupdateservice.js

const User = require('../models/User');
const TelegramChannel = require('../models/telegramschema');
// Redis wrapper
const redisClient = require('../config/redis');

class UserUpdateService {
  /**
   * Private helper: update the Redis session with updated user data
   * Includes essential channel data (names, types, and count)
   * @param {string} userId - User ID
   * @param {Object} userDoc - Updated user document
   */
  static async _updateRedisSession(userId, userDoc) {
    try {
      // Get the client
      const client = redisClient.getClient();
      if (!client.isOpen && typeof client.connect === 'function') {
        await client.connect();
      }

      // Find all sessions for this user (format: userId:sessionToken)
      const sessionKeys = await client.keys(`${userId}:*`);
      if (!sessionKeys || sessionKeys.length === 0) {
        // No sessions to update
        return;
      }

      // Extract all channel information with types for Redis
      const channels = userDoc.channels.map(channel => ({
        name: channel.botName || channel.name,
        type: channel.channelType // Include the channel type
      }));

      const channelCount = userDoc.channelsCount || userDoc.channels.length;

      // Update each session with the channel data including types
      for (const sessionKey of sessionKeys) {
        const sessionData = await client.get(sessionKey);
        if (sessionData) {
          // Parse existing session data
          const sessionObj = JSON.parse(sessionData);
          
          // Update with channel data including types
          const updatedSession = {
            ...sessionObj,
            // Keep all existing session data
            // Add/update channel-related fields with types
            channelsCount: channelCount,
            channels: channels // Include full channel info with types
          };
          
          // Save back to Redis with the same key
          await client.set(sessionKey, JSON.stringify(updatedSession));
        }
      }
      console.log(`Updated Redis sessions for user ${userId} with ${channelCount} channels of various types`);
    } catch (cacheErr) {
      console.error(`Failed to update Redis sessions for user ${userId}:`, cacheErr);
    }
  }

  /**
   * Synchronizes a user's Telegram channel count with their profile
   * @param {string} userId
   */
  static async syncTelegramChannelsCount(userId) {
    try {
      const telegramChannelsCount = await TelegramChannel.countDocuments({ userId });
      const user = await User.findOne({ userId });
      if (!user) {
        throw new Error(`User not found with ID: ${userId}`);
      }

      // Only update if the count has changed
      if (user.channelsCount !== telegramChannelsCount) {
        user.channelsCount = telegramChannelsCount;
        await user.save();

        // Update Redis sessions with channel data including types
        await this._updateRedisSession(userId, user);

        console.log(`Updated user ${userId} channel count to ${telegramChannelsCount}`);
      } else {
        console.log(`User ${userId} channel count already up to date (${telegramChannelsCount})`);
      }
      
      return {
        success: true,
        userId,
        channelsCount: telegramChannelsCount
      };
    } catch (error) {
      console.error(`Error syncing channel count for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Updates user's channels array with latest Telegram bot data
   * @param {string} userId
   */
  static async syncTelegramChannelsData(userId) {
    try {
      const telegramChannels = await TelegramChannel.find({ userId });
      const user = await User.findOne({ userId });
      if (!user) {
        throw new Error(`User not found with ID: ${userId}`);
      }

      // Get existing Telegram channels as Map for quick lookup
      const existingChannels = new Map();
      user.channels.forEach((channel, index) => {
        if (channel.channelType === 'Telegram') {
          existingChannels.set(channel.channelUserId, {
            index,
            data: channel
          });
        }
      });

      // Track if any changes were made
      let hasChanges = false;

      // Create new channels array - starting with non-Telegram channels
      const updatedChannels = user.channels.filter(c => c.channelType !== 'Telegram');
      
      // Add Telegram channels, checking for changes
      for (const tc of telegramChannels) {
        const tcId = tc._id.toString();
        const channelData = {
          channelType: 'Telegram',
          channelUserId: tcId,
          botToken: tc.botToken,
          botName: tc.botName,
          usage: {
            messagesSent: tc.usage.messagesSent,
            activeUsers: tc.usage.activeUsers,
            errors: tc.usage.errors
          },
          createdAt: tc.createdAt,
          updatedAt: tc.updatedAt
        };

        // Check if this channel already exists and if data has changed
        const existing = existingChannels.get(tcId);
        if (!existing) {
          // New channel
          updatedChannels.push(channelData);
          hasChanges = true;
        } else {
          // Compare data to see if anything changed
          const oldData = existing.data;
          if (
            oldData.botName !== channelData.botName ||
            oldData.usage.messagesSent !== channelData.usage.messagesSent ||
            oldData.usage.activeUsers !== channelData.usage.activeUsers ||
            oldData.usage.errors !== channelData.usage.errors ||
            oldData.updatedAt.getTime() !== channelData.updatedAt.getTime()
          ) {
            // Data changed - add the updated version
            updatedChannels.push(channelData);
            hasChanges = true;
          } else {
            // No changes - keep the original
            updatedChannels.push(oldData);
          }
        }
      }

      // Only update if there are changes
      if (hasChanges || user.channels.length !== updatedChannels.length) {
        user.channels = updatedChannels;
        user.channelsCount = updatedChannels.length;
        await user.save();

        // Update Redis sessions with channel data including types
        await this._updateRedisSession(userId, user);

        console.log(`Updated user ${userId} with ${telegramChannels.length} Telegram channels`);
      } else {
        console.log(`User ${userId} Telegram channels already up to date`);
      }

      return {
        success: true,
        userId,
        channelsCount: user.channelsCount,
        telegramChannelsCount: telegramChannels.length
      };
    } catch (error) {
      console.error(`Error syncing channel data for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Performs a full sync of both channel count and data
   * @param {string} userId
   */
  static async fullSyncUserTelegramData(userId) {
    try {
      await this.syncTelegramChannelsData(userId);

      // Re-fetch user (excluding sensitive fields)
      const user = await User.findOne({ userId }).select('-password');

      // Update Redis sessions with channel data including types
      await this._updateRedisSession(userId, user);

      return {
        success: true,
        message: 'User data synchronized successfully',
        userData: user
      };
    } catch (error) {
      console.error(`Error performing full sync for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Updates user data when a new Telegram bot is added
   * @param {string} userId
   * @param {Object} telegramChannel
   */
  static async handleNewTelegramBot(userId, telegramChannel) {
    try {
      const user = await User.findOne({ userId });
      if (!user) {
        throw new Error(`User not found with ID: ${userId}`);
      }

      // Check if this bot token already exists in the user's channels
      const telegramChannelId = telegramChannel._id.toString();
      const botExists = user.channels.some(
        c => c.channelType === 'Telegram' && c.channelUserId === telegramChannelId
      );

      if (!botExists) {
        user.channels.push({
          channelType: 'Telegram',
          channelUserId: telegramChannelId,
          botToken: telegramChannel.botToken,
          botName: telegramChannel.botName,
          usage: {
            messagesSent: telegramChannel.usage.messagesSent,
            activeUsers: telegramChannel.usage.activeUsers,
            errors: telegramChannel.usage.errors
          },
          createdAt: telegramChannel.createdAt,
          updatedAt: telegramChannel.updatedAt
        });

        user.channelsCount = user.channels.length;
        await user.save();

        // Update Redis sessions with channel data including types
        await this._updateRedisSession(userId, user);

        console.log(`Added new Telegram bot ${telegramChannel.botName} to user ${userId}`);
      } else {
        console.log(`Telegram bot ${telegramChannel.botName} already exists for user ${userId}`);
      }

      return {
        success: true,
        message: botExists ? 'Bot already exists' : 'User updated with new Telegram bot',
        channelsCount: user.channelsCount
      };
    } catch (error) {
      console.error(`Error handling new Telegram bot for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Updates user data when a Telegram bot is deleted
   * @param {string} userId
   * @param {string} botId
   */
  static async handleDeletedTelegramBot(userId, botId) {
    try {
      const user = await User.findOne({ userId });
      if (!user) {
        throw new Error(`User not found with ID: ${userId}`);
      }

      const idx = user.channels.findIndex(
        c => c.channelType === 'Telegram' && c.channelUserId === botId
      );
      
      if (idx !== -1) {
        // Only make changes if the bot exists
        user.channels.splice(idx, 1);
        user.channelsCount = user.channels.length;
        await user.save();

        // Update Redis sessions with channel data including types
        await this._updateRedisSession(userId, user);

        console.log(`Removed Telegram bot ${botId} from user ${userId}`);
      } else {
        console.log(`Telegram bot ${botId} not found for user ${userId}`);
      }

      return {
        success: true,
        message: idx !== -1 ? 'User updated after Telegram bot deletion' : 'Bot not found',
        channelsCount: user.channelsCount
      };
    } catch (error) {
      console.error(`Error handling deleted Telegram bot for user ${userId}:`, error);
      throw error;
    }
  }
}

module.exports = UserUpdateService;