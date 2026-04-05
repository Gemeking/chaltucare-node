const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const pool = require('./db');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

// Serialize user for session
passport.serializeUser((user, done) => {
  done(null, user.id);
});

// Deserialize user from session
passport.deserializeUser(async (id, done) => {
  try {
    const result = await pool.query('SELECT id, name, email, role, is_verified FROM users WHERE id = $1', [id]);
    done(null, result.rows[0]);
  } catch (error) {
    done(error, null);
  }
});

// Google OAuth Strategy
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:5000/api/auth/google/callback',
    passReqToCallback: true
  },
  async (req, accessToken, refreshToken, profile, done) => {
    try {
      console.log('Google profile:', profile);
      
      const email = profile.emails[0].value;
      const name = profile.displayName;
      const googleId = profile.id;
      const picture = profile.photos[0]?.value;
      
      // Check if user exists
      const existingUser = await pool.query(
        'SELECT * FROM users WHERE email = $1',
        [email]
      );
      
      let user;
      
      if (existingUser.rows.length > 0) {
        // User exists, update google_id if not set
        user = existingUser.rows[0];
        if (!user.google_id) {
          await pool.query(
            'UPDATE users SET google_id = $1, profile_picture = $2 WHERE id = $3',
            [googleId, picture, user.id]
          );
          user.google_id = googleId;
        }
        return done(null, user);
      } else {
        // Create new user with Google
        const randomPassword = crypto.randomBytes(20).toString('hex');
        const hashedPassword = await bcrypt.hash(randomPassword, 10);
        
        const result = await pool.query(
          `INSERT INTO users (name, email, password, role, is_verified, google_id, profile_picture)
           VALUES ($1, $2, $3, $4, true, $5, $6)
           RETURNING *`,
          [name, email, hashedPassword, 'user', googleId, picture]
        );
        
        user = result.rows[0];
        return done(null, user);
      }
    } catch (error) {
      console.error('Google OAuth error:', error);
      return done(error, null);
    }
  }
));

module.exports = passport;