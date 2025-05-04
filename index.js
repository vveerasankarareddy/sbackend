require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const redis = require('redis');
const os = require('os');
const cluster = require('cluster');

const telegramRoutes = require('./routes/telegram');

// Environment validation
if (!process.env.MONGODB_URI || !process.env.UPSTASH_REDIS_URL || !process.env.PORT) {
  console.error('Missing required environment variables: MONGODB_URI, UPSTASH_REDIS_URL, or PORT');
  process.exit(1);
}

const PORT = process.env.PORT || 5000;
const workers = process.env.WORKERS ? parseInt(process.env.WORKERS, 10) : os.cpus().length;

if (cluster.isMaster) {
  console.log(`Master process ${process.pid} is running`);
  console.log(`Forking ${workers} workers...`);
  for (let i = 0; i < workers; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} died. Spawning a new one...`);
    cluster.fork();
  });

} else {
  const app = express();

  // MongoDB connection with updated options (removed deprecated flags)
  mongoose.connect(process.env.MONGODB_URI);
  
  const db = mongoose.connection;
  db.on('error', (err) => console.error('MongoDB connection error:', err));
  db.once('open', () => console.log(`Worker ${process.pid}: Connected to MongoDB`));

  // Redis client setup
  const redisClient = redis.createClient({
    url: process.env.UPSTASH_REDIS_URL,
  });

  redisClient.on('error', (err) => console.error('Redis Client Error:', err));
  redisClient.on('connect', () => console.log(`Worker ${process.pid}: Connected to Upstash Redis`));

  // Connect to Redis
  (async () => {
    await redisClient.connect();
  })();

  // Round-robin middleware simulation (for logging only in a clustered setup)
  const endpointCounters = {
    '/api/telegram/update-bot-token': 0,
    '/api/telegram/get-bot-data': 0,
    '/api/telegram/get-user-bots': 0,
    '/api/telegram/delete-bot': 0,
    '/api/telegram/refresh-bot': 0,
  };

  const roundRobinMiddleware = (req, res, next) => {
    const endpoint = req.path;
    if (endpointCounters[endpoint] === undefined) {
      endpointCounters[endpoint] = 0;
    }
    const workerIndex = endpointCounters[endpoint] % workers;
    endpointCounters[endpoint] = (endpointCounters[endpoint] + 1) % workers;
    req.workerIndex = workerIndex;
    console.log(`Worker ${process.pid} routing ${endpoint} to virtual worker ${workerIndex}`);
    next();
  };

  // Middleware
  const allowedOrigins = [process.env.FRONTEND_URL || 'http://localhost:3000'].filter(Boolean);
  app.use(cors({
    origin: allowedOrigins,
    credentials: true,
  }));
  app.use(express.json());
  app.use(cookieParser());
  app.use((req, res, next) => {
    req.redisClient = redisClient;
    req.db = db;
    next();
  });
  app.use(roundRobinMiddleware);

  // Routes
  app.use('/api', telegramRoutes);

  // Health check route
  app.get('/api/health', async (req, res) => {
    try {
      const redisStatus = await redisClient.ping();
      const mongoStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
      res.json({
        success: true,
        redis: redisStatus === 'PONG',
        mongodb: mongoStatus === 'connected',
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Global error handler
  app.use((err, req, res, next) => {
    console.error('Global error handler:', {
      message: err.message,
      stack: err.stack,
      path: req.path,
      worker: req.workerIndex,
    });
    res.status(500).json({ success: false, message: 'Internal server error' });
  });

  const server = app.listen(PORT, () => {
    console.log(`Worker ${process.pid} running on port ${PORT}`);
  });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log(`Worker ${process.pid} shutting down...`);
    await redisClient.quit();
    await mongoose.disconnect();
    server.close(() => {
      process.exit(0);
    });
  });
}