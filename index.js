require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const homeRoutes = require('./home/home');
const authRoutes = require('./routes/auth');

const app = express();

// Middleware
const allowedOrigins = [
  'http://localhost:3000', // Local development
  process.env.FRONTEND_URL // Production frontend URL (set in .env)
].filter(Boolean); // Remove undefined values (e.g., if FRONTEND_URL is not set)

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);

app.use(express.json()); // Built-in JSON parser (replaces body-parser)

// Routes
app.use('/api/auth', authRoutes);
app.use('/api', homeRoutes);

// Connect to MongoDB
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch((err) => console.error('❌ Failed to connect to MongoDB:', err));

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

// Error handling for server
app.on('error', (err) => {
  console.error('❌ Server error:', err);
});