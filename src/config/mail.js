// config/mail.js
const nodemailer = require('nodemailer');

// For Gmail (recommended for testing)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER, // Your Gmail address
    pass: process.env.EMAIL_PASS, // Your Gmail app password (NOT regular password)
  }
});

// OR for development/testing without real emails:
const devTransporter = nodemailer.createTransport({
  host: 'localhost',
  port: 1025,
  ignoreTLS: true,
});

// Use dev for testing, real for production
module.exports = process.env.NODE_ENV === 'development' ? devTransporter : transporter;