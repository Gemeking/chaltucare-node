const pool = require('../config/db');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const transporter = require('../config/mail');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');

// Register user
exports.register = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email, and password are required' });
    }

    // Check if email already exists
    const existing = await pool.query('SELECT id, is_verified FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      if (existing.rows[0].is_verified) {
        return res.status(409).json({ message: 'An account with this email already exists. Please log in.' });
      } else {
        return res.status(409).json({ message: 'Email already registered but not verified. Use "Resend Verification" to get a new link.' });
      }
    }

    // Only patients (role 'user') can self-register.
    // Doctors and admins must be created by an admin via a separate endpoint.
    const role = 'user';

    const hashedPassword = await bcrypt.hash(password, 10);
    const token = crypto.randomBytes(32).toString('hex');

    await pool.query(
      `INSERT INTO users (name, email, password, role, verification_token)
       VALUES ($1, $2, $3, $4, $5)`,
      [name, email, hashedPassword, role, token]
    );

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const verifyLink = `${frontendUrl}/verify-email/${token}`;

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

    // First check if a user with this token exists
    const result = await pool.query(
      `SELECT id, is_verified FROM users WHERE verification_token = $1`,
      [token]
    );

    if (result.rows.length === 0) {
      // Token not found — check if it was already used (account already verified)
      return res.status(400).json({ message: 'This verification link has already been used or is invalid. If you are not yet verified, request a new link below.' });
    }

    if (result.rows[0].is_verified) {
      // Already verified — treat as success
      return res.json({ message: 'Email is already verified. You can log in.' });
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

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const verifyLink = `${frontendUrl}/verify-email/${token}`;

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

// ============================================
// PROFILE METHODS
// ============================================

// Get user profile
exports.getProfile = async (req, res) => {
  try {
    console.log('Getting profile for user:', req.user.id);
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
    console.error('Error in getProfile:', err);
    res.status(500).json({ error: err.message });
  }
};

// Update user profile
exports.updateProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, phone, date_of_birth, address, bio } = req.body;
    
    const updates = [];
    const values = [];
    let paramCount = 1;
    
    if (name !== undefined) {
      updates.push(`name = $${paramCount++}`);
      values.push(name);
    }
    if (phone !== undefined) {
      updates.push(`phone = $${paramCount++}`);
      values.push(phone);
    }
    if (date_of_birth !== undefined) {
      updates.push(`date_of_birth = $${paramCount++}`);
      values.push(date_of_birth);
    }
    if (address !== undefined) {
      updates.push(`address = $${paramCount++}`);
      values.push(address);
    }
    if (bio !== undefined) {
      updates.push(`bio = $${paramCount++}`);
      values.push(bio);
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ message: 'No fields to update' });
    }
    
    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(userId);
    
    const query = `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING id, name, email, role, phone, date_of_birth, address, bio, profile_picture`;
    
    const result = await pool.query(query, values);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    res.json({
      message: 'Profile updated successfully',
      user: result.rows[0]
    });
  } catch (err) {
    console.error('Error updating profile:', err);
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
    console.error('Error uploading profile picture:', err);
    res.status(500).json({ error: err.message });
  }
};

// Change password
exports.changePassword = async (req, res) => {
  try {
    const userId = req.user.id;
    const { currentPassword, newPassword, hasNoPassword } = req.body;
    
    if (!newPassword) {
      return res.status(400).json({ message: 'New password is required' });
    }
    
    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }
    
    // Get current user to check if they have a password
    const userResult = await pool.query(
      `SELECT password, google_id FROM users WHERE id = $1`,
      [userId]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const user = userResult.rows[0];
    const hasExistingPassword = user.password && user.password !== '';
    const isGoogleUser = user.google_id && !hasExistingPassword;
    
    console.log('User info:', { hasExistingPassword, isGoogleUser, hasNoPassword });
    
    // For Google users (no existing password) or if explicitly marked as no password
    if ((isGoogleUser || !hasExistingPassword || hasNoPassword) && !currentPassword) {
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      
      await pool.query(
        `UPDATE users SET password = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [hashedPassword, userId]
      );
      
      return res.json({ 
        message: 'Password set successfully! You can now login with this password.',
        isNewPassword: true 
      });
    }
    
    // Regular user with existing password - need to verify current password
    if (!currentPassword) {
      return res.status(400).json({ message: 'Current password is required' });
    }
    
    const validPassword = await bcrypt.compare(currentPassword, user.password);
    if (!validPassword) {
      return res.status(401).json({ message: 'Current password is incorrect' });
    }
    
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
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

// Check if user has a password set
exports.checkPasswordStatus = async (req, res) => {
  try {
    const userId = req.user.id;
    
    const result = await pool.query(
      `SELECT password, google_id FROM users WHERE id = $1`,
      [userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const user = result.rows[0];
    const hasPassword = user.password && user.password !== '';
    const isGoogleUser = user.google_id && !hasPassword;
    
    res.json({
      hasPassword: hasPassword,
      isGoogleUser: isGoogleUser,
      canSetPassword: !hasPassword
    });
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
    
    const appointmentStats = await pool.query(
      `SELECT 
         COUNT(*) as total_appointments,
         COUNT(CASE WHEN status = 'confirmed' THEN 1 END) as upcoming_appointments,
         COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_appointments
       FROM appointments 
       WHERE patient_id = $1`,
      [userId]
    );
    
    const paymentStats = await pool.query(
      `SELECT 
         COUNT(*) as total_payments,
         COALESCE(SUM(amount), 0) as total_spent
       FROM payments 
       WHERE user_id = $1 AND status = 'completed'`,
      [userId]
    );
    
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

// ============================================
// GOOGLE AUTH METHODS
// ============================================

// Test Google token endpoint
exports.testGoogleToken = async (req, res) => {
  try {
    const { token } = req.body;
    
    console.log('Test Google token received:', token ? 'Yes (length: ' + token.length + ')' : 'No');
    
    if (!token) {
      return res.status(400).json({ error: 'No token provided' });
    }
    
    res.json({ 
      success: true, 
      message: 'Token received, backend is working',
      token_received: true 
    });
  } catch (error) {
    console.error('Test error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Google token verification
exports.verifyGoogleToken = async (req, res) => {
  try {
    console.log('=== Google Token Verification Started ===');
    const { token } = req.body;
    
    console.log('Token received:', token ? 'Yes (length: ' + token.length + ')' : 'No');
    
    if (!token) {
      console.log('No token provided');
      return res.status(400).json({ error: 'No token provided' });
    }
    
    // Check if columns exist before using them
    const columnsCheck = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'users'
    `);
    
    const existingColumns = columnsCheck.rows.map(row => row.column_name);
    console.log('Existing columns:', existingColumns);
    
    console.log('Initializing Google OAuth2 client...');
    console.log('Google Client ID:', process.env.GOOGLE_CLIENT_ID);
    
    const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    
    console.log('Verifying token with Google...');
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID
    });
    
    console.log('Token verified successfully');
    const payload = ticket.getPayload();
    console.log('Google payload:', JSON.stringify(payload, null, 2));
    
    const { email, name, sub: googleId, picture } = payload;
    console.log('Extracted user info:', { email, name, googleId });
    
    // Check if user exists
    let userResult = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );
    
    let user;
    
    if (userResult.rows.length === 0) {
      // Create new user
      console.log('Creating new user...');
      const randomPassword = crypto.randomBytes(20).toString('hex');
      const hashedPassword = await bcrypt.hash(randomPassword, 10);
      
      // Build dynamic insert query based on existing columns
      let insertFields = ['name', 'email', 'password', 'role', 'is_verified'];
      let insertValues = [name, email, hashedPassword, 'user', true];
      let paramCount = 6;
      
      if (existingColumns.includes('google_id')) {
        insertFields.push('google_id');
        insertValues.push(googleId);
        paramCount++;
      }
      if (existingColumns.includes('profile_picture')) {
        insertFields.push('profile_picture');
        insertValues.push(picture);
        paramCount++;
      }
      if (existingColumns.includes('created_at')) {
        insertFields.push('created_at');
        insertValues.push(new Date());
        paramCount++;
      }
      if (existingColumns.includes('updated_at')) {
        insertFields.push('updated_at');
        insertValues.push(new Date());
      }
      
      const placeholders = insertValues.map((_, i) => `$${i + 1}`).join(', ');
      const insertQuery = `INSERT INTO users (${insertFields.join(', ')}) VALUES (${placeholders}) RETURNING id, name, email, role`;
      
      console.log('Insert query:', insertQuery);
      userResult = await pool.query(insertQuery, insertValues);
      user = userResult.rows[0];
      console.log('New user created:', user);
    } else {
      user = userResult.rows[0];
      console.log('Existing user found:', user);
      
      // Update google_id if not set and column exists
      if (existingColumns.includes('google_id') && !user.google_id) {
        const updateQuery = `UPDATE users SET google_id = $1, profile_picture = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3`;
        await pool.query(updateQuery, [googleId, picture, user.id]);
        user.google_id = googleId;
        user.profile_picture = picture;
        console.log('Updated user with Google info');
      }
    }
    
    // Create JWT
    const jwtToken = jwt.sign(
      { id: user.id, role: user.role, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    console.log('JWT created for user:', user.id);
    
    res.json({
      success: true,
      message: 'Google login successful',
      token: jwtToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        profile_picture: user.profile_picture || null
      }
    });
    
  } catch (error) {
    console.error('=== Google Token Verification Error ===');
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Full error:', error);
    res.status(500).json({ error: 'Google authentication failed', details: error.message });
  }
};

// Get user's current plan based on their latest confirmed appointment
// Get user's current plan based on their latest confirmed appointment
// Get user's current plan based on their latest confirmed appointment
exports.getUserPlan = async (req, res) => {
  try {
    const userId = req.user.id;
    
    console.log('Getting plan for user:', userId);
    
    // Get ALL active confirmed+paid appointments (not expired)
    // Then pick the best plan: video-enabled first, then most recent date
    const result = await pool.query(
      `SELECT p.*, a.appointment_date, a.status, a.payment_status, a.doctor_id, a.id as appointment_id
       FROM appointments a
       JOIN plans p ON p.id = a.plan_id
       WHERE a.patient_id = $1
       AND a.status = 'confirmed'
       AND a.payment_status = 'paid'
       AND a.appointment_date >= CURRENT_DATE
       ORDER BY a.appointment_date DESC`,
      [userId]
    );

    console.log('Active confirmed appointment query result:', result.rows.length);

    if (result.rows.length > 0) {
      // Pick best plan: prefer video-enabled over no-video, then most-recent date
      let bestRow = result.rows[0];
      for (const row of result.rows) {
        let f = row.features;
        if (typeof f === 'string') { try { f = JSON.parse(f); } catch { f = {}; } }
        let bf = bestRow.features;
        if (typeof bf === 'string') { try { bf = JSON.parse(bf); } catch { bf = {}; } }
        // Upgrade to this row if it has video and the current best doesn't
        if (f.video && !bf.video) { bestRow = row; }
      }
      const plan = bestRow;
      let features = plan.features;
      if (typeof features === 'string') {
        try {
          features = JSON.parse(features);
        } catch (e) {
          features = { chat: true, video: false, file_sharing: true };
        }
      }
      
      // Ensure chat is always true for any active plan
      features.chat = true;
      
      return res.json({
        hasActivePlan: true,
        plan: {
          id: plan.id,
          name: plan.name,
          price: plan.price,
          features: features,
          valid_until: plan.appointment_date,
          status: plan.status,
          payment_status: plan.payment_status,
          doctor_id: plan.doctor_id,
          appointment_id: plan.appointment_id
        }
      });
    }
    
    // Check for pending appointments (waiting for doctor approval)
    const pendingResult = await pool.query(
      `SELECT p.*, a.appointment_date, a.status, a.payment_status, a.doctor_id, a.id as appointment_id,
              d.name as doctor_name
       FROM appointments a
       JOIN plans p ON p.id = a.plan_id
       JOIN users d ON d.id = a.doctor_id
       WHERE a.patient_id = $1 
       AND a.status = 'pending'
       AND a.payment_status = 'pending_verification'
       ORDER BY a.appointment_date DESC
       LIMIT 1`,
      [userId]
    );
    
    if (pendingResult.rows.length > 0) {
      const pending = pendingResult.rows[0];
      return res.json({
        hasActivePlan: false,
        plan: null,
        pendingApproval: true,
        message: 'Your payment is pending doctor approval. You will be able to chat once approved.',
        doctor_id: pending.doctor_id,
        doctor_name: pending.doctor_name,
        appointment_id: pending.appointment_id
      });
    }
    
    // Check for expired appointments (past date)
    const expiredResult = await pool.query(
      `SELECT p.*, a.appointment_date, a.status, a.payment_status
       FROM appointments a
       JOIN plans p ON p.id = a.plan_id
       WHERE a.patient_id = $1 
       AND a.status = 'confirmed'
       AND a.payment_status = 'paid'
       AND a.appointment_date < CURRENT_DATE
       ORDER BY a.appointment_date DESC
       LIMIT 1`,
      [userId]
    );
    
    if (expiredResult.rows.length > 0) {
      return res.json({
        hasActivePlan: false,
        plan: null,
        expired: true,
        message: 'Your consultation period has ended. Please book a new appointment to continue chatting.',
        expired_date: expiredResult.rows[0].appointment_date
      });
    }
    
    return res.json({ 
      hasActivePlan: false, 
      plan: null,
      features: { chat: true, video: false, file_sharing: true },
      message: 'No active appointment found'
    });
    
  } catch (error) {
    console.error('Error getting user plan:', error);
    res.status(500).json({ error: error.message });
  }
};

// Admin: create a doctor or admin account
exports.createStaffUser = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { name, email, password, role } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({ message: 'Name, email, password, and role are required' });
    }

    if (!['doctor', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Role must be doctor or admin' });
    }

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already in use' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (name, email, password, role, is_verified, created_at, updated_at)
       VALUES ($1, $2, $3, $4, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING id, name, email, role, is_verified, created_at`,
      [name, email, hashedPassword, role]
    );

    res.status(201).json({ message: 'Staff account created successfully', user: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

// Admin: update any user's role
exports.updateUserRole = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { id } = req.params;
    const { role } = req.body;

    if (!['user', 'doctor', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const result = await pool.query(
      `UPDATE users SET role = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2
       RETURNING id, name, email, role`,
      [role, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: 'Role updated', user: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

// Get user's assigned doctor
// Get user's assigned doctor
exports.getAssignedDoctor = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get the most recent confirmed appointment
    const result = await pool.query(
      `SELECT d.id, d.name, d.email, d.role, a.plan_id, p.name as plan_name, p.features, a.status, a.payment_status
       FROM appointments a
       JOIN users d ON d.id = a.doctor_id
       JOIN plans p ON p.id = a.plan_id
       WHERE a.patient_id = $1 
       AND a.status = 'confirmed'
       AND a.payment_status = 'paid'
       ORDER BY a.appointment_date DESC
       LIMIT 1`,
      [userId]
    );
    
    console.log('Assigned doctor query result:', result.rows.length);
    
    if (result.rows.length === 0) {
      // Check for pending approval
      const pendingResult = await pool.query(
        `SELECT d.id, d.name, d.email, d.role, a.plan_id, p.name as plan_name, p.features, a.status, a.payment_status
         FROM appointments a
         JOIN users d ON d.id = a.doctor_id
         JOIN plans p ON p.id = a.plan_id
         WHERE a.patient_id = $1 
         AND a.status = 'pending'
         AND a.payment_status = 'pending_verification'
         ORDER BY a.appointment_date DESC
         LIMIT 1`,
        [userId]
      );
      
      if (pendingResult.rows.length > 0) {
        return res.json({ 
          hasAssignedDoctor: false, 
          doctor: null,
          pendingApproval: true,
          doctor_name: pendingResult.rows[0].name,
          doctor_id: pendingResult.rows[0].id
        });
      }
      
      return res.json({ hasAssignedDoctor: false, doctor: null });
    }
    
    const doctor = result.rows[0];
    let features = doctor.features;
    if (typeof features === 'string') {
      try {
        features = JSON.parse(features);
      } catch (e) {
        features = { chat: true, video: false, file_sharing: true };
      }
    }
    
    res.json({
      hasAssignedDoctor: true,
      doctor: {
        id: doctor.id,
        name: doctor.name,
        email: doctor.email,
        role: doctor.role,
        plan_id: doctor.plan_id,
        plan_name: doctor.plan_name,
        features: features,
        appointment_status: doctor.status
      }
    });
  } catch (error) {
    console.error('Error getting assigned doctor:', error);
    res.status(500).json({ error: error.message });
  }
};