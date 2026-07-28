import { describe, it, expect, beforeAll } from 'vitest';

// tokens.js reads JWT_SECRET lazily inside secret(); set it before any signing.
beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-please-change';
});

describe('tokens', () => {
  it('signs and verifies an access token carrying sub/roles/email', async () => {
    const { signAccessToken, verifyAccessToken } = await import('../../src/utils/tokens.js');
    const token = signAccessToken({ _id: 'abc123', roles: ['User'], email: 'a@b.com' });
    const payload = verifyAccessToken(token);
    expect(payload.sub).toBe('abc123');
    expect(payload.roles).toEqual(['User']);
    expect(payload.email).toBe('a@b.com');
  });

  it('generates opaque refresh tokens and hashes them stably', async () => {
    const { generateRefreshToken, hashToken } = await import('../../src/utils/tokens.js');
    const t1 = generateRefreshToken();
    const t2 = generateRefreshToken();
    expect(t1).not.toBe(t2); // random
    expect(t1).toMatch(/^[0-9a-f]{96}$/); // 48 bytes hex
    expect(hashToken(t1)).toBe(hashToken(t1)); // stable
    expect(hashToken(t1)).not.toBe(t1); // not the raw value
  });

  it('computes a future refresh expiry', async () => {
    const { refreshExpiryDate } = await import('../../src/utils/tokens.js');
    const now = new Date('2026-01-01T00:00:00Z');
    expect(refreshExpiryDate(now).getTime()).toBeGreaterThan(now.getTime());
  });
});

describe('password', () => {
  it('hashes and verifies with bcrypt', async () => {
    const { hashPassword, verifyPassword } = await import('../../src/utils/password.js');
    const hash = await hashPassword('correcthorse');
    expect(hash).not.toBe('correcthorse');
    expect(await verifyPassword('correcthorse', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });

  it('rejects empty and too-short passwords', async () => {
    const { validatePassword, MIN_PASSWORD_LENGTH } = await import('../../src/utils/password.js');
    expect(() => validatePassword('')).toThrow();
    expect(() => validatePassword('   ')).toThrow();
    expect(() => validatePassword('short')).toThrow();
    expect(() => validatePassword('a'.repeat(MIN_PASSWORD_LENGTH))).not.toThrow();
  });
});

describe('User model', () => {
  it('requires at least one role and enforces the role enum (DB-free validateSync)', async () => {
    const { default: User, ROLES } = await import('../../src/models/User.js');
    expect(ROLES).toEqual(['User', 'Admin']);

    const noRoles = new User({ firstName: 'A', lastName: 'B', email: 'A@B.com', passwordHash: 'x', roles: [] });
    expect(noRoles.validateSync()).toBeTruthy(); // fails validation

    const badRole = new User({ firstName: 'A', lastName: 'B', email: 'a@b.com', passwordHash: 'x', roles: ['Nope'] });
    expect(badRole.validateSync()).toBeTruthy();

    const ok = new User({ firstName: 'A', lastName: 'B', email: 'A@B.com', passwordHash: 'x', roles: ['User'] });
    expect(ok.validateSync()).toBeUndefined();
    expect(ok.email).toBe('a@b.com'); // lowercased setter
  });

  it('role virtual seeds and reads the first role', async () => {
    const { default: User } = await import('../../src/models/User.js');
    const u = new User({ firstName: 'A', lastName: 'B', email: 'a@b.com', passwordHash: 'x', role: 'Admin' });
    expect(u.roles).toEqual(['Admin']);
    expect(u.role).toBe('Admin');
  });
});

describe('RefreshToken model', () => {
  it('requires userId, tokenHash, expiresAt', async () => {
    const { default: RefreshToken } = await import('../../src/models/RefreshToken.js');
    const bad = new RefreshToken({});
    const err = bad.validateSync();
    expect(err.errors.userId).toBeTruthy();
    expect(err.errors.tokenHash).toBeTruthy();
    expect(err.errors.expiresAt).toBeTruthy();
  });
});
