// config/redis.js
const redis = require('redis');

// Create Redis client
const client = redis.createClient({
  url: process.env.UPSTASH_REDIS_URL, // e.g., redis://:password@host:port
});

client.on('error', (err) => console.error('Redis Client Error:', err));

// Connect to Redis
(async () => {
  try {
    await client.connect();
    console.log('Connected to Upstash Redis');
  } catch (err) {
    console.error('Failed to connect to Upstash Redis:', err);
  }
})();

// Export an object with methods rather than just the client
module.exports = {
  getClient: () => client,
  set: async (key, value) => await client.set(key, value),
  get: async (key) => await client.get(key),
  del: async (key) => await client.del(key),
  keys: async (pattern) => await client.keys(pattern),
  expire: async (key, seconds) => await client.expire(key, seconds)
};