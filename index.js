// index.js
require('dotenv').config();
const cluster = require('cluster');
const os = require('os');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');
const promBundle = require('express-prom-bundle');
const winston = require('winston');
const { createClient: createRedisClient } = require('ioredis');

const { initMongo } = require('./config/mongodb');
const { validateSession } = require('./middlewares/validateSession');
const { AppError, errorHandler } = require('./middlewares/errorHandler');
const telegramRoutes = require('./routes/telegram');
const authRoutes = require('./routes/auth');

// —— 1) CONFIG & ENV VALIDATION —————————————————————————————
const {
  MONGODB_URI,
  UPSTASH_REDIS_URL,
  PORT = 5000,
  FRONTEND_URL,
  CLUSTER_MODE = 'false',
  WORKERS = os.cpus().length
} = process.env;

if (!MONGODB_URI || !UPSTASH_REDIS_URL) {
  console.error('❌  Missing required environment variables: MONGODB_URI or UPSTASH_REDIS_URL');
  process.exit(1);
}

// —— 2) LOGGER SETUP (Winston + Morgan) ——————————————————————
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [ new winston.transports.Console() ]
});

const morganStream = {
  write: (msg) => logger.info(msg.trim())
};

// —— 3) PROMETHEUS METRICS ———————————————————————————————
const metricsMiddleware = promBundle({
  includeMethod: true,
  includePath: true,
  metricsPath: '/metrics',
  promClient: { collectDefaultMetrics: {} }
});

// —— 4) REDIS CLIENT (shared state, rate limiting, counters) —————
const redisClient = createRedisClient(UPSTASH_REDIS_URL);
redisClient.on('error', (err) => logger.error('Redis error', err));

// Rate limiter using Redis store
const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 minutes
  max: 100,                   // limit each IP
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisStore({
    sendCommand: (...args) => redisClient.call(...args)
  })
});

// Endpoint counter middleware
const roundRobinMiddleware = async (req, _res, next) => {
  try {
    const key = `counter:${req.method}:${req.baseUrl}${req.path}`;
    const count = await redisClient.incr(key);
    // if you need a worker index for custom logic:
    req.workerIndex = count % parseInt(WORKERS, 10);
  } catch (e) {
    req.workerIndex = 0;
  } finally {
    next();
  }
};

// —— 5) EXPRESS APP FACTORY ——————————————————————————————
function createApp() {
  const app = express();

  // Security & headers
  app.use(helmet());
  app.use(cors({
    origin: FRONTEND_URL,
    credentials: true
  }));
  app.use(cookieParser());
  
  // Observability
  app.use(morgan('combined', { stream: morganStream }));
  app.use(metricsMiddleware);
  
  // Body parsing
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  
  // Rate limiting globally (or mount per-route if preferred)
  app.use(apiRateLimiter);
  
  // Shared state middleware
  app.use((req, _res, next) => {
    req.redis = redisClient;
    next();
  });
  app.use(roundRobinMiddleware);

  // Public routes first
  app.use('/api/auth', authRoutes);

  // Protected routes
  app.use(validateSession);
  app.use('/api/telegram', telegramRoutes);

  // Health check
  app.get('/api/health', async (req, res, next) => {
    try {
      const redisUp = await redisClient.ping() === 'PONG';
      const mongoUp = initMongo.isConnected(); // your helper
      res.json({ success: true, redis: redisUp, mongodb: mongoUp });
    } catch (err) {
      next(new AppError('Health check failed', 500, err));
    }
  });

  // 404 handler
  app.use((req, _res, next) => {
    next(new AppError(`Not Found: ${req.originalUrl}`, 404));
  });

  // Global error handler
  app.use(errorHandler);

  return app;
}

// —— 6) CLUSTER OR SINGLE PROCESS ———————————————————————————
if (CLUSTER_MODE === 'true' && cluster.isMaster) {
  logger.info(`Master ${process.pid} is running — forking ${WORKERS} workers`);
  for (let i = 0; i < WORKERS; i++) {
    cluster.fork();
  }
  cluster.on('exit', (worker) => {
    logger.warn(`Worker ${worker.process.pid} died. Spawning new one…`);
    cluster.fork();
  });
} else {
  // Initialize MongoDB once in each worker / process
  initMongo(MONGODB_URI)
    .then(() => {
      const app = createApp();
      app.listen(PORT, () => {
        logger.info(`Process ${process.pid} listening on port ${PORT}`);
      });
    })
    .catch((err) => {
      logger.error('Failed to connect to MongoDB', err);
      process.exit(1);
    });
}

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info(`Process ${process.pid} shutting down…`);
  try {
    await redisClient.quit();
    await initMongo.disconnect();
    process.exit(0);
  } catch (err) {
    logger.error('Error during shutdown', err);
    process.exit(1);
  }
});
