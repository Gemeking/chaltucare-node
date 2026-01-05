const nodemailer = require('nodemailer');

let transporter;

// Create Ethereal test account
nodemailer.createTestAccount((err, account) => {
  if (err) {
    console.error('❌ Failed to create test email account:', err.message);
    console.log('📧 Email functionality will be disabled');
    return;
  }
  
  console.log('✅ Ethereal test account created:');
  console.log('   Email:', account.user);
  console.log('   Password:', account.pass);
  console.log('   SMTP:', account.smtp.host + ':' + account.smtp.port);
  console.log('   Web Interface: https://ethereal.email/login');
  
  transporter = nodemailer.createTransport({
    host: account.smtp.host,
    port: account.smtp.port,
    secure: account.smtp.secure,
    auth: {
      user: account.user,
      pass: account.pass
    }
  });
  
  // Test connection
  transporter.verify(function(error, success) {
    if (error) {
      console.error('❌ Email transporter failed:', error);
    } else {
      console.log('✅ Email server is ready to send messages');
    }
  });
});

// Create a wrapper function
const sendMail = async (mailOptions) => {
  if (!transporter) {
    console.log('📧 Email transporter not ready. Skipping email...');
    console.log('Would send to:', mailOptions.to);
    console.log('Subject:', mailOptions.subject);
    return Promise.resolve();
  }
  
  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('📧 Email sent successfully!');
    console.log('Preview URL:', nodemailer.getTestMessageUrl(info));
    return info;
  } catch (error) {
    console.error('❌ Email send failed:', error.message);
    // Don't throw error - just log it
    return Promise.resolve();
  }
};

module.exports = { sendMail };