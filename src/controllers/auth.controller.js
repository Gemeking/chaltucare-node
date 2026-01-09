const pool = require('../config/db');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const transporter = require('../config/mail');

exports.register = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Generate verification token
    const token = crypto.randomBytes(32).toString('hex');

    // Save user in DB
    await pool.query(
      `INSERT INTO users (name, email, password, role, verification_token)
       VALUES ($1, $2, $3, $4, $5)`,
      [name, email, hashedPassword, role, token]
    );

    // Send verification email
    const verifyLink = `http://localhost:5000/api/auth/verify/${token}`;

    await transporter.sendMail({
      to: email,
      subject: 'Verify your ChaltuCare account',
      html: `<p>Click to verify your email:</p><a href="${verifyLink}">${verifyLink}</a>`,
    });

    res.status(201).json({
      message: 'Registration successful. Check your email to verify your account.',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

exports.verifyEmail = async (req, res) => {
  try {
    const { token } = req.params;

    const result = await pool.query(
      `SELECT * FROM users WHERE verification_token = $1`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    await pool.query(
      `UPDATE users SET is_verified = true, verification_token = NULL WHERE verification_token = $1`,
      [token]
    );

    res.json({ message: 'Email verified successfully. You can now log in.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const jwt = require('jsonwebtoken');

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await pool.query(
      `SELECT * FROM users WHERE email = $1`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const user = result.rows[0];

    if (!user.is_verified) {
      return res.status(403).json({ message: 'Please verify your email first' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { id: user.id, role: user.role, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        email: user.email
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.resendVerification = async (req, res) => {
  try {
    const { email } = req.body;

    const result = await pool.query(
      `SELECT * FROM users WHERE email = $1`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = result.rows[0];

    if (user.is_verified) {
      return res.json({ message: 'Email already verified' });
    }

    const token = crypto.randomBytes(32).toString('hex');

    await pool.query(
      `UPDATE users SET verification_token = $1 WHERE email = $2`,
      [token, email]
    );

    const verifyLink = `http://localhost:5000/api/auth/verify/${token}`;

    await transporter.sendMail({
      to: email,
      subject: 'Verify your ChaltuCare account',
      html: `<p>Click to verify:</p><a href="${verifyLink}">${verifyLink}</a>`
    });

    res.json({ message: 'Verification email resent' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Add this to your auth.controller.js
exports.testEmail = async (req, res) => {
  try {
    const testEmail = req.body.email || 'test@example.com';
    
    await transporter.sendMail({
      from: '"Test" <test@example.com>',
      to: testEmail,
      subject: 'Test Email from ChaltuCare',
      text: 'This is a test email.',
    });
    
    res.json({ message: 'Test email sent successfully' });
  } catch (error) {
    console.error('Email test error:', error);
    res.status(500).json({ 
      error: error.message,
      details: 'Check mail configuration'
    });
  }
};