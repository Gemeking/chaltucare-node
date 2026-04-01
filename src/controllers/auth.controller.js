const pool = require('../config/db');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const transporter = require('../config/mail');
const jwt = require('jsonwebtoken'); // Only declare once at the top

// Register user
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

// Verify email
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

// Login
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

// Resend verification email
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

// Test email
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

// Get user profile
exports.getProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    
    const result = await pool.query(
      `SELECT id, name, email, role, is_verified, created_at, 
              profile_picture, phone, date_of_birth, address, bio
       FROM users 
       WHERE id = $1`,
      [userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

// Update user profile
exports.updateProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, phone, date_of_birth, address, bio } = req.body;
    
    // Update user profile
    const result = await pool.query(
      `UPDATE users 
       SET name = COALESCE($1, name),
           phone = COALESCE($2, phone),
           date_of_birth = COALESCE($3, date_of_birth),
           address = COALESCE($4, address),
           bio = COALESCE($5, bio),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $6
       RETURNING id, name, email, role, phone, date_of_birth, address, bio, profile_picture`,
      [name, phone, date_of_birth, address, bio, userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    res.json({
      message: 'Profile updated successfully',
      user: result.rows[0]
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

// Upload profile picture
exports.uploadProfilePicture = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const userId = req.user.id;
    const profilePictureUrl = `/uploads/profiles/${req.file.filename}`;
    
    const result = await pool.query(
      `UPDATE users 
       SET profile_picture = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING id, name, profile_picture`,
      [profilePictureUrl, userId]
    );
    
    res.json({
      message: 'Profile picture updated successfully',
      profile_picture: profilePictureUrl,
      user: result.rows[0]
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

// Change password
exports.changePassword = async (req, res) => {
  try {
    const userId = req.user.id;
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current password and new password are required' });
    }
    
    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters' });
    }
    
    // Get current user
    const userResult = await pool.query(
      `SELECT password FROM users WHERE id = $1`,
      [userId]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Verify current password
    const validPassword = await bcrypt.compare(currentPassword, userResult.rows[0].password);
    if (!validPassword) {
      return res.status(401).json({ message: 'Current password is incorrect' });
    }
    
    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    // Update password
    await pool.query(
      `UPDATE users SET password = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [hashedPassword, userId]
    );
    
    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

// Delete account
exports.deleteAccount = async (req, res) => {
  const client = await pool.connect();
  try {
    const userId = req.user.id;
    
    await client.query('BEGIN');
    
    // Delete user data (cascade will handle related records)
    await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
    
    await client.query('COMMIT');
    
    res.json({ message: 'Account deleted successfully' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

// Get user statistics
exports.getUserStats = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get appointment stats
    const appointmentStats = await pool.query(
      `SELECT 
         COUNT(*) as total_appointments,
         COUNT(CASE WHEN status = 'confirmed' THEN 1 END) as upcoming_appointments,
         COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_appointments
       FROM appointments 
       WHERE patient_id = $1`,
      [userId]
    );
    
    // Get payment stats
    const paymentStats = await pool.query(
      `SELECT 
         COUNT(*) as total_payments,
         COALESCE(SUM(amount), 0) as total_spent
       FROM payments 
       WHERE user_id = $1 AND status = 'completed'`,
      [userId]
    );
    
    // Get message stats
    const messageStats = await pool.query(
      `SELECT COUNT(*) as total_messages
       FROM messages 
       WHERE sender_id = $1 OR receiver_id = $1`,
      [userId]
    );
    
    res.json({
      appointments: appointmentStats.rows[0],
      payments: paymentStats.rows[0],
      messages: messageStats.rows[0]
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};