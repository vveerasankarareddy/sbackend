// server/templates/verification-email.js
exports.verificationEmailTemplate = (verificationCode) => {
    return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Verify Your Email</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          line-height: 1.6;
          color: #333;
          max-width: 600px;
          margin: 0 auto;
          padding: 20px;
        }
        .container {
          background-color: #f9f9f9;
          border-radius: 5px;
          padding: 20px;
          border: 1px solid #ddd;
        }
        .header {
          text-align: center;
          padding-bottom: 10px;
          border-bottom: 1px solid #ddd;
          margin-bottom: 20px;
        }
        .code {
          font-size: 24px;
          font-weight: bold;
          text-align: center;
          background-color: #eee;
          padding: 10px;
          border-radius: 5px;
          margin: 20px 0;
          letter-spacing: 5px;
        }
        .footer {
          margin-top: 30px;
          font-size: 12px;
          color: #777;
          text-align: center;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Welcome to Stringel!</h1>
        </div>
        <p>Thank you for signing up. To complete your registration, please verify your email address by entering the following code:</p>
        <div class="code">${verificationCode}</div>
        <p>This verification code will expire in 1 hour.</p>
        <p>If you didn't create an account with us, you can safely ignore this email.</p>
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} Stringel. All rights reserved.</p>
          <p>This is an automated message, please do not reply.</p>
        </div>
      </div>
    </body>
    </html>
    `;
  };
  
  // server/templates/welcome-email.js
  exports.welcomeEmailTemplate = (firstName) => {
    return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Welcome to Stringel</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          line-height: 1.6;
          color: #333;
          max-width: 600px;
          margin: 0 auto;
          padding: 20px;
        }
        .container {
          background-color: #f9f9f9;
          border-radius: 5px;
          padding: 20px;
          border: 1px solid #ddd;
        }
        .header {
          text-align: center;
          padding-bottom: 10px;
          border-bottom: 1px solid #ddd;
          margin-bottom: 20px;
        }
        .button {
          display: block;
          width: 200px;
          background-color: #18181B;
          color: white;
          text-align: center;
          padding: 10px;
          margin: 20px auto;
          border-radius: 5px;
          text-decoration: none;
        }
        .footer {
          margin-top: 30px;
          font-size: 12px;
          color: #777;
          text-align: center;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Welcome to Stringel!</h1>
        </div>
        <p>Hello ${firstName},</p>
        <p>Thank you for verifying your email and joining Stringel. We're excited to have you on board!</p>
        <p>You can now log in to your account and start exploring all the features we offer.</p>
        <a href="https://yourdomain.com/login" class="button">Login to Your Account</a>
        <p>If you have any questions or need assistance, please don't hesitate to contact our support team.</p>
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} Stringel. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
    `;
  };