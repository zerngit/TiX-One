const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/tix_one_squads');
        console.log(`[db] MongoDB Connected: ${conn.connection.host}`);
    } catch (error) {
        console.error(`[db] Error: ${error.message}`);
        process.exit(1);
    }
};

module.exports = connectDB;
