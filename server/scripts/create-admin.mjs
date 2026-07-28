// Create (or promote) a single Admin user from env vars — for a clean production first login.
// There is no self-registration, so this is how the first account is made. Non-destructive.
//
//   ADMIN_EMAIL=you@company.com ADMIN_PASSWORD='a-strong-password' \
//   ADMIN_FIRST=Jane ADMIN_LAST=Doe MONGODB_URI='<atlas uri>' npm run create-admin
//
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../src/config/db.js';
import User from '../src/models/User.js';
import { hashPassword, validatePassword } from '../src/utils/password.js';

const email = (process.env.ADMIN_EMAIL || '').toLowerCase().trim();
const password = process.env.ADMIN_PASSWORD || '';
const firstName = process.env.ADMIN_FIRST || 'Admin';
const lastName = process.env.ADMIN_LAST || 'User';

if (!email || !password) {
  console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD (and MONGODB_URI).');
  process.exit(1);
}
validatePassword(password);

await connectDb();
const passwordHash = await hashPassword(password);
const existing = await User.findOne({ email }).select('+passwordHash');
if (existing) {
  existing.passwordHash = passwordHash;
  existing.active = true;
  if (!existing.roles.includes('Admin')) existing.roles = [...new Set([...existing.roles, 'Admin'])];
  await existing.save();
  console.log(`Updated existing user to active Admin: ${email}`);
} else {
  await User.create({ firstName, lastName, email, passwordHash, roles: ['Admin'] });
  console.log(`Created Admin: ${email}`);
}
await mongoose.disconnect();
process.exit(0);
