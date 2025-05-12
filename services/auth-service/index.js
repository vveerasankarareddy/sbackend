const express = require('express');
const mongoose = require('mongoose');
const device = require('express-device');
const cors = require('cors');
const authRoutes = require('./routes/authRoutes');
require('dotenv').config();

const app = express();
const PORT = process.env.AUTH_PORT || 5000;

// Enable CORS for frontend
app.use(cors({
  origin: 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Log all incoming requests
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

app.use(express.json());
app.use(device.capture()); // Capture device information
app.use('/auth', authRoutes);

// Error-handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const startServer = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Auth Service: Connected to MongoDB');
    app.listen(PORT, () => {
      console.log(`Auth Service running on port ${PORT}`);
    }).on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use. Try a different port by setting AUTH_PORT in .env or stopping the process using port ${PORT}.`);
        console.error('To find the process, run: lsof -i :5000');
        process.exit(1);
      } else {
        console.error('Server error:', err);
        process.exit(1);
      }
    });
  } catch (error) {
    console.error('Auth Service: Failed to start:', error);
    process.exit(1);
  }
};

startServer();