const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { verifySession } = require('../middleware/authMiddleware');

router.post('/register', authController.register);
router.post('/login', authController.login);
router.get('/protected', verifySession, (req, res) => {
  res.json({ message: 'Protected route accessed', userId: req.userId });
});

module.exports = router;