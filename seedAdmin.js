// seedAdmin.js

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
const AdminUser = require('./Admin/models/AdminUser');

dotenv.config();

const seedAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);

    console.log('MongoDB connected');

    const email = 'onnestest@gmail.com';
    const password = '%Test*(1987!';

    const existing = await AdminUser.findOne({ email });

    if (existing) {
      console.log('Admin already exists');
      await mongoose.disconnect();
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const admin = new AdminUser({
      email: email,
      password: hashedPassword,
    });

    await admin.save();

    console.log('✅ Admin user created');
    console.log('Email:', email);

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('❌ Error seeding admin:', err);
    await mongoose.disconnect();
    process.exit(1);
  }
};

seedAdmin();