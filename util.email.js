const nodemailer = require('nodemailer');

class EmailService {
    constructor() {
        this.transporter = nodemailer.createTransport({
            host: process.env.EMAIL_HOST,
            port: process.env.EMAIL_PORT,
            secure: false,
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        });
    }

    async sendEmail(to, subject, html) {
        try {
            await this.transporter.sendMail({
                from: `"SkillHub" <${process.env.EMAIL_USER}>`,
                to,
                subject,
                html
            });
            console.log(`✅ Email sent to ${to}`);
        } catch (error) {
            console.error('❌ Email error:', error);
        }
    }

    async sendWelcomeEmail(user) {
        const html = `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                    .header { background: linear-gradient(135deg, #2563eb, #1d4ed8); color: white; padding: 30px; text-align: center; }
                    .content { padding: 30px; background: #f9fafb; }
                    .button { display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; }
                    .footer { text-align: center; padding: 20px; font-size: 12px; color: #6b7280; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>🎉 Welcome to SkillHub!</h1>
                    </div>
                    <div class="content">
                        <h2>Hello ${user.name},</h2>
                        <p>Thank you for joining SkillHub - Ethiopia's premier platform for learning and earning!</p>
                        <p>With SkillHub, you can:</p>
                        <ul>
                            <li>📚 Enroll in premium courses</li>
                            <li>👨‍🏫 Teach and earn money</li>
                            <li>💼 Find freelance opportunities</li>
                            <li>💰 Build your career</li>
                        </ul>
                        <p style="text-align: center;">
                            <a href="${process.env.FRONTEND_URL}/dashboard" class="button">Get Started →</a>
                        </p>
                    </div>
                    <div class="footer">
                        <p>© 2024 SkillHub. All rights reserved.</p>
                        <p>Addis Ababa, Ethiopia</p>
                    </div>
                </div>
            </body>
            </html>
        `;
        await this.sendEmail(user.email, 'Welcome to SkillHub! 🚀', html);
    }

    async sendCoursePurchaseEmail(user, course) {
        const html = `
            <div class="container">
                <h2>Course Purchase Confirmed!</h2>
                <p>You have successfully purchased:</p>
                <h3>${course.title}</h3>
                <p>Amount: $${Number(course.price).toFixed(2)} USD</p>
                <a href="${process.env.FRONTEND_URL}/my-courses">Access your course →</a>
            </div>
        `;
        await this.sendEmail(user.email, `Course Purchase: ${course.title}`, html);
    }
}

module.exports = new EmailService();