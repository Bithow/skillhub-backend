const axios = require('axios');

class WhatsAppService {
    constructor() {
        this.apiUrl = process.env.WHATSAPP_API_URL;
        this.accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    }

    // Send message to a single number
    async sendToNumber(phoneNumber, message) {
        try {
            // Format phone number (remove +, ensure correct format)
            let cleanNumber = phoneNumber.toString().replace(/\D/g, '');
            if (!cleanNumber.startsWith('251') && cleanNumber.length === 10) {
                cleanNumber = '251' + cleanNumber.substring(1);
            }
            
            const data = {
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to: cleanNumber,
                type: 'text',
                text: { preview_url: false, body: message }
            };
            
            const response = await axios.post(this.apiUrl, data, {
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json'
                }
            });
            
            console.log(`✅ WhatsApp message sent to ${cleanNumber}`);
            return response.data;
        } catch (error) {
            console.error('❌ WhatsApp send error:', error.response?.data || error.message);
            // Fallback: log message (for development without WhatsApp API)
            console.log(`📱 WhatsApp message (simulated) to ${phoneNumber}: ${message.substring(0, 100)}...`);
            return null;
        }
    }

    // Send to admin
    async sendToAdmin(message) {
        return this.sendToNumber(process.env.ADMIN_WHATSAPP, message);
    }

    // Send course purchase confirmation
    async sendCoursePurchaseConfirmation(userPhone, courseTitle, amount, reference) {
        const message = `🎉 *Course Purchase Confirmed!*\n\n📚 Course: ${courseTitle}\n💰 Amount: ${amount} ETB\n📝 Reference: ${reference}\n\nYou can now access your course in your dashboard.\n\nThank you for learning with SkillHub! 🚀`;
        return this.sendToNumber(userPhone, message);
    }

    // Send instructor approval notification
    async sendInstructorApproval(phone, name) {
        const message = `🎉 *Congratulations ${name}!*\n\nYour instructor application has been APPROVED on SkillHub.\n\nYou can now:\n✅ Create and upload courses\n✅ Start earning money\n✅ Build your student community\n\nLogin to your dashboard to get started: ${process.env.FRONTEND_URL}/instructor/dashboard\n\nWelcome to the SkillHub instructor family! 🚀`;
        return this.sendToNumber(phone, message);
    }

    // Send freelancer approval notification
    async sendFreelancerApproval(phone, name) {
        const message = `🎉 *Congratulations ${name}!*\n\nYour freelancer profile has been APPROVED on SkillHub.\n\nClients can now:\n✅ Find and hire you\n✅ View your portfolio\n✅ Contact you directly\n\nLogin to manage your profile: ${process.env.FRONTEND_URL}/freelancer/dashboard\n\nStart getting hired today! 💼`;
        return this.sendToNumber(phone, message);
    }

    // Send payment reminder
    async sendPaymentReminder(phone, reference, amount) {
        const message = `⏰ *Payment Reminder*\n\nTransaction Reference: ${reference}\nAmount: ${amount} ETB\n\nPlease complete your payment to access the course.\n\nSend payment to: 09XX-XXXXXX (Telebirr/CBE)\nThen reply with "PAID ${reference}"`;
        return this.sendToNumber(phone, message);
    }

    // Send withdrawal notification
    async sendWithdrawalNotification(phone, amount, status) {
        const message = status === 'completed' 
            ? `💰 *Withdrawal Completed!*\n\nAmount: ${amount} ETB has been sent to your account.\n\nThank you for being part of SkillHub! 🚀`
            : `❌ *Withdrawal Failed*\n\nAmount: ${amount} ETB\n\nPlease contact support for assistance.`;
        return this.sendToNumber(phone, message);
    }

    // Send OTP for password reset
    async sendResetCode(phone, code) {
        const message = `🔐 *Password Reset Code*\n\nYour verification code is: ${code}\n\nValid for 10 minutes.\n\nIf you didn't request this, please ignore.`;
        return this.sendToNumber(phone, message);
    }
}

module.exports = new WhatsAppService();