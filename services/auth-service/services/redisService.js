const { Redis } = require('@upstash/redis');
const crypto = require('crypto');
require('dotenv').config();

const redis = new Redis({
  url: process.env.REDIS_URL,
  token: process.env.REDIS_TOKEN,
});

// Test Redis connection
redis.ping().then(() => {
  console.log('Connected to Redis');
}).catch((error) => {
  console.error('Redis connection error:', error);
});

// Generate session token
const generateSessionToken = () => crypto.randomBytes(32).toString('hex'); // 64-char

// Generate CSRF token
const generateCsrfToken = () => crypto.randomBytes(16).toString('hex'); // 32-char

// Retrieve session data
const getSession = async (sessionToken) => {
  const key = `session:${sessionToken}`;
  try {
    const data = await redis.get(key);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error('Failed to get session:', error);
    throw error;
  }
};

// Delete session data
const deleteSession = async (sessionToken) => {
  const key = `session:${sessionToken}`;
  try {
    await redis.del(key);
    console.log(`Deleted session: ${sessionToken}`);
  } catch (error) {
    console.error('Failed to delete session:', error);
    throw error;
  }
};

// Store user data using session token
const storeUserData = async (sessionToken, userData) => {
  const key = `session:${sessionToken}`;
  try {
    await redis.set(key, JSON.stringify(userData), { ex: 86400 }); // 24-hour TTL
    console.log(`Stored user data for session: ${sessionToken}`);
  } catch (error) {
    console.error('Failed to store user data:', error);
    throw error;
  }
};

// Retrieve user data using session token
const getUserData = async (sessionToken) => {
  const key = `session:${sessionToken}`;
  try {
    const data = await redis.get(key);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error('Failed to get user data:', error);
    throw error;
  }
};

module.exports = {
  generateSessionToken,
  generateCsrfToken,
  getSession,
  deleteSession,
  storeUserData,
  getUserData,
};