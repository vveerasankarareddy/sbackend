const redis = require('redis');

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

module.exports = client;