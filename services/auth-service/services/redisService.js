const { Redis } = require('@upstash/redis');
const crypto = require('crypto');
require('dotenv').config();

const redis = new Redis({
  url: process.env.REDIS_URL,
  token: process.env.REDIS_TOKEN,
});

redis.ping()
  .then(() => console.log('Connected to Redis'))
  .catch((err) => console.error('Redis connection error:', err));

const generateSessionToken = () => crypto.randomBytes(32).toString('hex');
const generateCsrfToken = () => crypto.randomBytes(16).toString('hex');

const getSession = async (sessionToken) => {
  const key = `session:${sessionToken}`;
  try {
    const data = await redis.get(key);
    return data ? JSON.parse(data) : null;
  } catch (err) {
    console.error('Failed to get session:', err);
    throw err;
  }
};

const deleteSession = async (sessionToken) => {
  const key = `session:${sessionToken}`;
  try {
    await redis.del(key);
    console.log(`Deleted session: ${sessionToken}`);
  } catch (err) {
    console.error('Failed to delete session:', err);
    throw err;
  }
};

const storeUserData = async (sessionToken, userData) => {
  const key = `session:${sessionToken}`;
  try {
    await redis.set(key, JSON.stringify(userData), { ex: 86400 }); // 1 day TTL
    console.log(`Stored user data for session: ${sessionToken}`);

    if (Array.isArray(userData.workspaces)) {
      for (const ws of userData.workspaces) {
        if (ws.workspaceId) {
          await redis.sadd(`workspace:${ws.workspaceId}:members`, userData.userId);
        }
      }
    }

    if (userData.workspace) {
      await storeWorkspaceData(userData.workspace);
    }
  } catch (err) {
    console.error('Failed to store user data:', err);
    throw err;
  }
};

const getUserData = async (sessionToken) => {
  const key = `session:${sessionToken}`;
  try {
    const data = await redis.get(key);
    return data ? JSON.parse(data) : null;
  } catch (err) {
    console.error('Failed to get user data:', err);
    throw err;
  }
};

const storeWorkspaceData = async (workspace) => {
  const key = `workspace:${workspace.workspaceId}`;
  try {
    const existingData = await getWorkspaceData(workspace.workspaceId) || {};
    const cleanedMembers = workspace.members?.map(member => ({
      userId: member.userId,
      role: member.role,
      status: member.status,
      joinedAt: member.joinedAt
    })) || [];

    const mergedData = {
      ...existingData,
      ...workspace,
      members: cleanedMembers,
      lastUpdated: new Date()
    };

    await redis.set(key, JSON.stringify(mergedData), { ex: 604800 }); // 7 days
    console.log(`Stored workspace data: ${workspace.workspaceId}`);

    if (Array.isArray(mergedData.members)) {
      const memberIds = mergedData.members.map(m => m.userId);
      if (memberIds.length > 0) {
        await redis.sadd(`workspace:${workspace.workspaceId}:members`, ...memberIds);
      }
    }
  } catch (err) {
    console.error('Failed to store workspace data:', err);
    throw err;
  }
};

const getWorkspaceData = async (workspaceId) => {
  const key = `workspace:${workspaceId}`;
  try {
    const data = await redis.get(key);
    return data ? JSON.parse(data) : null;
  } catch (err) {
    console.error('Failed to get workspace data:', err);
    throw err;
  }
};

const getWorkspaceMembers = async (workspaceId) => {
  const key = `workspace:${workspaceId}:members`;
  try {
    return await redis.smembers(key);
  } catch (err) {
    console.error('Failed to get workspace members:', err);
    throw err;
  }
};

const logWorkspaceActivity = async (workspaceId, activity) => {
  const key = `workspace:${workspaceId}:activity`;
  try {
    const activityEntry = {
      ...activity,
      timestamp: new Date()
    };
    await redis.lpush(key, JSON.stringify(activityEntry));
    await redis.ltrim(key, 0, 99); // Keep last 100 logs
    await redis.expire(key, 2592000); // 30-day TTL
  } catch (err) {
    console.error('Failed to log workspace activity:', err);
    throw err;
  }
};

const getWorkspaceActivity = async (workspaceId, limit = 20) => {
  const key = `workspace:${workspaceId}:activity`;
  try {
    const logs = await redis.lrange(key, 0, limit - 1);
    return logs.map(item => JSON.parse(item));
  } catch (err) {
    console.error('Failed to get workspace activity:', err);
    throw err;
  }
};

module.exports = {
  generateSessionToken,
  generateCsrfToken,
  getSession,
  deleteSession,
  storeUserData,
  getUserData,
  storeWorkspaceData,
  getWorkspaceData,
  getWorkspaceMembers,
  logWorkspaceActivity,
  getWorkspaceActivity
};