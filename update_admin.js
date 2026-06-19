const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('./models/User');

// Load environment variables
dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;
const adminEmail = process.env.ADMIN_EMAIL || 'sanah@bnbgirl.com';
const adminPassword = process.env.ADMIN_PASSWORD || 'sanah123';

if (!MONGODB_URI) {
  console.error('ERROR: MONGODB_URI is not defined in your environment variables.');
  process.exit(1);
}

async function run() {
  try {
    console.log('Connecting to database...');
    await mongoose.connect(MONGODB_URI);
    console.log('Connected!');

    // 1. Create or update the new admin user
    console.log(`Setting up admin user: ${adminEmail}...`);
    let admin = await User.findOne({ username: adminEmail });
    if (!admin) {
      // Check if they exist under the old username 'admin'
      admin = await User.findOne({ username: 'admin' });
      if (admin) {
        admin.username = adminEmail;
        admin.password = adminPassword;
        admin.role = 'admin';
        await admin.save();
        console.log(`Updated old admin user to ${adminEmail}`);
      } else {
        admin = new User({
          username: adminEmail,
          password: adminPassword,
          role: 'admin'
        });
        await admin.save();
        console.log(`Created new admin user: ${adminEmail}`);
      }
    } else {
      admin.password = adminPassword;
      admin.role = 'admin';
      await admin.save();
      console.log(`Verified/Updated admin password for ${adminEmail}`);
    }

    // 2. Delete the old default admin user if it is different from the new admin email
    if (adminEmail !== 'admin') {
      console.log("Removing old 'admin' user from database...");
      const result = await User.deleteMany({ username: 'admin' });
      console.log(`Deleted ${result.deletedCount} occurrences of old 'admin' user.`);
    }

    console.log('Admin seeding completed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('Seeding failed with error:', err.message);
    process.exit(1);
  }
}

run();
