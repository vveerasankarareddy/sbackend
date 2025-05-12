const { getSession } = require('../services/redisService');

const verifySession = async (req, res, next) => {
  const sessionToken = req.headers['authorization'];
  if (!sessionToken) {
    return res.status(401).json({ error: 'Session token required' });
  }
  const userId = await getSession(sessionToken);
  if (!userId) {
    return res.status(401).json({ error: 'Invalid or expired session token' });
  }
  req.userId = userId;
  next();
};

module.exports = { verifySession };