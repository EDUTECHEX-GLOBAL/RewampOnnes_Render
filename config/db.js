const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
const AdminUser = require('./Admin/models/AdminUser');

dotenv.config();

const seedAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log('MongoDB connected for admin seeding');

    const existing = await AdminUser.findOne({
      email: 'onnestest@gmail.com',
    });

    if (existing) {
      console.log('Admin already exists');
      await mongoose.connection.close();
      process.exit(0);
    }

    const hashedPassword = await bcrypt.hash('1@#$@@!#$', 10);

    const admin = new AdminUser({
      email: 'onnestest@gmail.com',
      password: hashedPassword,
    });

    await admin.save();

    console.log('✅ Admin user created');
    await mongoose.connection.close();
    process.exit(0);
  } catch (err) {
    console.error('❌ Error seeding admin:', err);
    process.exit(1);
  }
};

seedAdmin();