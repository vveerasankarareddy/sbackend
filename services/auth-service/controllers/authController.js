const bcrypt = require('bcrypt');
const crypto = require('crypto');
const User = require('../models/User');
const { generateSessionToken, generateCsrfToken, storeUserData } = require('../services/redisService');

const generateDeviceId = (deviceType, deviceName) => {
  return crypto.createHash('sha256').update(`${deviceType}:${deviceName}`).digest('hex');
};

exports.register = async (req, res) => {
  try {
    const { fullName, email, password, deviceInfo } = req.body;

    // Validate required fields
    if (!fullName || fullName.trim() === '') {
      return res.status(400).json({ error: 'Full name is required' });
    }
    if (!email || email.trim() === '') {
      return res.status(400).json({ error: 'Email is required' });
    }
    if (!password || password.trim() === '') {
      return res.status(400).json({ error: 'Password is required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    if (!deviceInfo || !deviceInfo.deviceType || deviceInfo.deviceType.trim() === '') {
      return res.status(400).json({ error: 'Device type is required' });
    }
    if (!deviceInfo || !deviceInfo.deviceName || deviceInfo.deviceName.trim() === '') {
      return res.status(400).json({ error: 'Device name is required' });
    }

    // Check for existing user
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Hash password and create user
    const hashedPassword = await bcrypt.hash(password, 10);
    const deviceId = generateDeviceId(deviceInfo.deviceType, deviceInfo.deviceName);
    const user = new User({
      fullName,
      email,
      passwordHash: hashedPassword,
      devices: [
        {
          deviceId,
          deviceType: deviceInfo.deviceType,
          deviceName: deviceInfo.deviceName,
          lastUsed: new Date(),
        },
      ],
      channels: [],
      channelsCount: 0,
      agents: [],
      agentsCount: 0,
    });
    await user.save();

    // Store user data in Redis with session token
    const sessionToken = generateSessionToken();
    const csrfToken = generateCsrfToken();
    await storeUserData(sessionToken, {
      fullName,
      email,
      deviceType: deviceInfo.deviceType,
      deviceName: deviceInfo.deviceName,
      createdAt: new Date(),
    });

    // Clear old cookies and set new ones
    res.clearCookie('sessionToken');
    res.clearCookie('csrfToken');
    res.cookie('sessionToken', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 3600 * 1000, // 1 hour
    });
    res.cookie('csrfToken', csrfToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 3600 * 1000, // 1 hour
    });

    res.status(201).json({ message: 'Registration successful' });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password, deviceInfo } = req.body;

    // Validate required fields
    if (!email || email.trim() === '') {
      return res.status(400).json({ error: 'Email is required' });
    }
    if (!password || password.trim() === '') {
      return res.status(400).json({ error: 'Password is required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    if (!deviceInfo || !deviceInfo.deviceType || deviceInfo.deviceType.trim() === '') {
      return res.status(400).json({ error: 'Device type is required' });
    }
    if (!deviceInfo || !deviceInfo.deviceName || deviceInfo.deviceName.trim() === '') {
      return res.status(400).json({ error: 'Device name is required' });
    }

    // Authenticate user
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Update device info
    const deviceId = generateDeviceId(deviceInfo.deviceType, deviceInfo.deviceName);
    const deviceIndex = user.devices.findIndex((d) => d.deviceId === deviceId);
    if (deviceIndex === -1) {
      user.devices.push({
        deviceId,
        deviceType: deviceInfo.deviceType,
        deviceName: deviceInfo.deviceName,
        lastUsed: new Date(),
      });
    } else {
      user.devices[deviceIndex].lastUsed = new Date();
      user.devices[deviceIndex].isActive = true;
    }
    user.lastLogin = new Date();
    await user.save();

    // Store user data in Redis with session token
    const sessionToken = generateSessionToken();
    const csrfToken = generateCsrfToken();
    await storeUserData(sessionToken, {
      fullName: user.fullName,
      email,
      deviceType: deviceInfo.deviceType,
      deviceName: deviceInfo.deviceName,
      lastLogin: new Date(),
    });

    // Clear old cookies and set new ones
    res.clearCookie('sessionToken');
    res.clearCookie('csrfToken');
    res.cookie('sessionToken', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 3600 * 1000, // 1 hour
    });
    res.cookie('csrfToken', csrfToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 3600 * 1000, // 1 hour
    });

    res.status(200).json({ message: 'Login successful' });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
};