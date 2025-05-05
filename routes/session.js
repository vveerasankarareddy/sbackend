const crypto = require('crypto');

// Generate a secure random session token
const generateSessionToken = () => {
  return crypto.randomBytes(48).toString('hex');
};

// Create a new session and set cookie
const createSession = async (res, userData, redisClient) => {
  try {
    if (!redisClient || !redisClient.isOpen) {
      throw new Error('Redis client is not connected');
    }

    const sessionToken = generateSessionToken();
    const sessionData = {
      userId: userData.userId,
      email: userData.email,
      deviceFingerprint: userData.deviceFingerprint,
      lastLogin: userData.lastLogin,
      createdAt: new Date().toISOString(),
    };

    // Store session in Redis with the key as userId:sessionToken
    await redisClient.set(`${userData.userId}:${sessionToken}`, JSON.stringify(sessionData), { EX: 7 * 24 * 60 * 60 });

    // Set secure HTTP-only cookie
    res.cookie('sessionToken', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
    });

    return { sessionToken, userId: userData.userId };
  } catch (error) {
    console.error('Session creation error:', error.message, error.stack);
    throw new Error('Failed to create session');
  }
};

// Validate session middleware
const validateSession = async (req, res, next) => {
  try {
    const sessionToken = req.cookies.sessionToken;

    if (!sessionToken) {
      req.userId = null;
      return next();
    }

    // Extract userId from the sessionToken cookie if possible
    // This is a workaround since we need userId to construct the Redis key
    const allSessions = await req.redisClient.keys('*:' + sessionToken);
    if (!allSessions || allSessions.length === 0) {
      req.userId = null;
      return next();
    }

    // Get the userId from the first part of the key (before :)
    const redisCacheKey = allSessions[0];
    const userId = redisCacheKey.split(':')[0];

    const sessionData = await req.redisClient.get(redisCacheKey);
    if (!sessionData) {
      req.userId = null;
      return next();
    }

    const session = JSON.parse(sessionData);
    req.userId = session.userId;
    req.userEmail = session.email;
    req.sessionToken = sessionToken;

    // Refresh session expiry (rolling expiration)
    await req.redisClient.expire(redisCacheKey, 7 * 24 * 60 * 60);

    next();
  } catch (error) {
    console.error('Session validation error:', error.message, error.stack);
    req.userId = null;
    next();
  }
};

// Authentication middleware - requires valid session
const requireAuth = async (req, res, next) => {
  if (!req.userId) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required. Please log in.',
    });
  }
  next();
};

module.exports = {
  createSession,
  validateSession,
  requireAuth,
};