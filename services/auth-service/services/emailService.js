const Mailjet = require('node-mailjet');
const fs = require('fs');
const path = require('path');

const sendVerificationEmail = async (email, verificationCode) => {
  console.log('Attempting to send email to:', email);
  console.log('Mailjet API key:', process.env.MAILJET_API_KEY ? 'Set' : 'Missing');
  console.log('Mailjet Secret key:', process.env.MAILJET_SECRET_KEY ? 'Set' : 'Missing');

  if (!process.env.MAILJET_API_KEY || !process.env.MAILJET_SECRET_KEY) {
    throw new Error('Mailjet API key or secret key not configured');
  }

  const mailjet = new Mailjet({
    apiKey: process.env.MAILJET_API_KEY,
    apiSecret: process.env.MAILJET_SECRET_KEY,
  });

  // Load email template
  const templatePath = path.join(__dirname, '../templates/verificationEmail.html');
  let htmlContent;
  try {
    console.log('Reading email template from:', templatePath);
    htmlContent = fs.readFileSync(templatePath, 'utf8');
    htmlContent = htmlContent.replace('{{verificationCode}}', verificationCode);
  } catch (error) {
    console.error('Failed to read email template:', error.message);
    throw new Error('Template loading error');
  }

  const request = {
    Messages: [
      {
        From: {
          Email: 'noreply@stringel.com',
          Name: 'Stringel Authentication',
        },
        To: [
          {
            Email: email,
          },
        ],
        ReplyTo: {
          Email: 'support@stringel.com',
        },
        Subject: 'Verify Your Stringel Account',
        HTMLPart: htmlContent,
        CustomID: `stringel-verification-${Date.now()}`,
      },
    ],
  };

  try {
    const result = await mailjet.post('send', { version: 'v3.1' }).request(request);
    console.log(`Verification email sent to ${email}: Message ID ${result.body.Messages[0].MessageID}`);
    return result;
  } catch (error) {
    console.error(`Failed to send verification email to ${email}:`, error.message);
    console.error('Error details:', error);
    if (error.statusCode === 401) {
      throw new Error('Mailjet unauthorized: Invalid API key or secret key');
    }
    throw new Error('Sending email error');
  }
};

module.exports = { sendVerificationEmail };