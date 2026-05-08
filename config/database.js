const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        const uri = process.env.MONGODB_URI;
        if (!uri) {
            console.error('❌ MONGODB_URI environment variable is not set!');
            return;
        }
        console.log('🔗 Connecting to MongoDB...');
        const conn = await mongoose.connect(uri);
        console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
    } catch (error) {
        console.error(`❌ Error: ${error.message}`);
        // Don't exit — let server keep running so health check works
    }
};

module.exports = connectDB;