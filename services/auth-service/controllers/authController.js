const bcrypt = require('bcrypt');
const crypto = require('crypto');
const User = require('../models/User');
const Workspace = require('../../workspace/models/Workspace.model');
const { generateSessionToken, generateCsrfToken, storeUserData, getUserData } = require('../services/redisService');

// Generate unique device ID
const generateDeviceId = (deviceInfo, userSpecificInfo = '') => {
  const fingerprint = [
    deviceInfo.deviceType || '',
    deviceInfo.deviceName || '',
    deviceInfo.userAgent || '',
    deviceInfo.platform || '',
    deviceInfo.screenResolution || '',
    deviceInfo.timezone || '',
    deviceInfo.language || '',
    deviceInfo.deviceUniqueId || '',
    userSpecificInfo,
    crypto.randomBytes(8).toString('hex')
  ].join('|');
  return crypto.createHash('sha256').update(fingerprint).digest('hex');
};

// Generate alphanumeric IDs
const generateAlphanumericId = (length = 7) => {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

const generateWorkspaceId = () => generateAlphanumericId(13);

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

    // Generate unique IDs
    let userId, workspaceId;
    do {
      userId = generateAlphanumericId(); // 7 characters
    } while (await User.findOne({ userId }));
    do {
      workspaceId = generateWorkspaceId(); // 13 characters
    } while (await Workspace.findOne({ workspaceId }));

    // Create workspace with empty channels
    const workspace = new Workspace({
      workspaceId,
      name: `${fullName}'s Workspace`,
      owner: userId,
      members: [{ userId, role: 'owner', status: 'active', joinedAt: new Date() }],
      channels: [] // Empty array
    });
    await workspace.save();

    // Hash password and create user with empty channels and agents
    const hashedPassword = await bcrypt.hash(password, 10);
    const deviceId = generateDeviceId(deviceInfo, `${email}|${userId}`);
    const deviceVerificationToken = crypto.randomBytes(32).toString('hex');

    const user = new User({
      userId,
      fullName,
      email,
      passwordHash: hashedPassword,
      workspaceId,
      workspaces: [{ workspaceId, role: 'owner', status: 'active', joinedAt: new Date() }],
      devices: [
        {
          deviceId,
          deviceType: deviceInfo.deviceType,
          deviceName: deviceInfo.deviceName,
          deviceInfo: {
            userAgent: deviceInfo.userAgent,
            platform: deviceInfo.platform,
            screenResolution: deviceInfo.screenResolution,
            timezone: deviceInfo.timezone,
            language: deviceInfo.language
          },
          verificationToken: deviceVerificationToken,
          isVerified: true,
          lastUsed: new Date(),
          isActive: true
        }
      ],
      channels: [], // Empty array
      channelsCount: 0,
      agents: [], // Empty array
      agentsCount: 0,
      createdAt: new Date()
    });
    await user.save();

    // Store user data in Redis
    const sessionToken = generateSessionToken();
    const csrfToken = generateCsrfToken();
    await storeUserData(sessionToken, {
      userId,
      fullName,
      email,
      workspaceId,
      workspaces: [{ workspaceId }],
      workspace: {
        workspaceId,
        name: workspace.name,
        owner: workspace.owner,
        members: workspace.members.map(member => ({
          userId: member.userId,
          role: member.role,
          status: member.status,
          joinedAt: member.joinedAt
        })),
        channels: workspace.channels // Empty array
      },
      deviceId,
      deviceVerified: true,
      createdAt: new Date()
    });

    // Set cookies
    res.clearCookie('sessionToken');
    res.clearCookie('csrfToken');
    res.cookie('sessionToken', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 3600 * 1000 // 1 hour
    });
    res.cookie('csrfToken', csrfToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 3600 * 1000 // 1 hour
    });

    res.status(201).json({
      message: 'Registration successful',
      userId,
      workspaceId,
      deviceId,
      deviceVerified: true
    });
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

    if (user.isAccountLocked) {
      return res.status(403).json({ error: 'Account is locked' });
    }

    // Generate device ID and add to user
    const deviceId = generateDeviceId(deviceInfo, `${email}|${user.userId}`);
    const deviceVerificationToken = crypto.randomBytes(32).toString('hex');

    user.devices.push({
      deviceId,
      deviceType: deviceInfo.deviceType,
      deviceName: deviceInfo.deviceName,
      deviceInfo: {
        userAgent: deviceInfo.userAgent,
        platform: deviceInfo.platform,
        screenResolution: deviceInfo.screenResolution,
        timezone: deviceInfo.timezone,
        language: deviceInfo.language
      },
      verificationToken: deviceVerificationToken,
      isVerified: true,
      lastUsed: new Date(),
      isActive: true
    });

    user.lastLogin = new Date();
    await user.save();

    // Fetch workspace data
    const workspace = await Workspace.findOne({ workspaceId: user.workspaceId });

    // Store user data in Redis
    const sessionToken = generateSessionToken();
    const csrfToken = generateCsrfToken();
    await storeUserData(sessionToken, {
      userId: user.userId,
      fullName: user.fullName,
      email,
      workspaceId: user.workspaceId,
      workspaces: user.workspaces,
      workspace: workspace ? {
        workspaceId: workspace.workspaceId,
        name: workspace.name,
        owner: workspace.owner,
        members: workspace.members.map(member => ({
          userId: member.userId,
          role: member.role,
          status: member.status,
          joinedAt: member.joinedAt
        })),
        channels: workspace.channels
      } : null,
      deviceId,
      deviceVerified: true,
      lastLogin: new Date()
    });

    // Set cookies
    res.clearCookie('sessionToken');
    res.clearCookie('csrfToken');
    res.cookie('sessionToken', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 3600 * 1000 // 1 hour
    });
    res.cookie('csrfToken', csrfToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 3600 * 1000 // 1 hour
    });

    res.status(200).json({
      message: 'Login successful',
      userId: user.userId,
      workspaceId: user.workspaceId,
      deviceVerified: true
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
};

exports.verifyDevice = async (req, res) => {
  try {
    const { userId, verificationToken } = req.body;

    if (!userId || !verificationToken) {
      return res.status(400).json({ error: 'User ID and verification token are required' });
    }

    const user = await User.findOne({ userId });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const deviceIndex = user.devices.findIndex(
      device => device.verificationToken === verificationToken && !device.isVerified
    );

    if (deviceIndex === -1) {
      return res.status(400).json({ error: 'Invalid or expired verification token' });
    }

    user.devices[deviceIndex].isVerified = true;
    user.devices[deviceIndex].verificationToken = null;
    await user.save();

    const sessionToken = req.cookies.sessionToken;
    if (sessionToken) {
      const userData = await getUserData(sessionToken);
      if (userData) {
        userData.deviceVerified = true;
        await storeUserData(sessionToken, userData);
      }
    }

    res.status(200).json({
      message: 'Device verified successfully',
      deviceId: user.devices[deviceIndex].deviceId,
      deviceVerified: true
    });
  } catch (error) {
    console.error('Device verification error:', error);
    res.status(500).json({ error: 'Device verification failed' });
  }
};