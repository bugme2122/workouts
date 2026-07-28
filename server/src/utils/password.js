import bcrypt from 'bcryptjs';
import { httpError } from './httpError.js';

// bcrypt cost factor 12. bcryptjs is a pure-JS drop-in for bcrypt (no native build).
const COST = 12;

export const MIN_PASSWORD_LENGTH = 10;

// Reject empty/whitespace and too-short passwords. Throws httpError(400) on failure.
export function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.trim().length === 0) {
    throw httpError(400, 'A password is required.');
  }
  if (pw.length < MIN_PASSWORD_LENGTH) {
    throw httpError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
}

export function hashPassword(plain) {
  return bcrypt.hash(plain, COST);
}

export function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}
