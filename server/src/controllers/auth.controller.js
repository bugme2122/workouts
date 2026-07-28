import * as authService from '../services/auth.service.js';
import { config } from '../config.js';

// Admin-provisioned accounts (no self-registration): there is no register endpoint. Audit logging
// is deferred for v1 (spec §11) — the hooks can be added later without changing this surface.

export async function login(req, res) {
  const result = await authService.login(req.body || {});
  res.status(200).json(result);
}

export async function refresh(req, res) {
  const tokens = await authService.refresh(req.body || {});
  res.status(200).json(tokens);
}

export async function logout(req, res) {
  await authService.logout(req.body || {});
  res.status(204).end();
}

export async function forgotPassword(req, res) {
  const { user, token } = await authService.forgotPassword(req.body || {});
  // Dev-only convenience: log the reset link ONLY for the stub provider outside production, so a
  // real reset token can't leak into shared/prod logs.
  if (user && config.emailProvider === 'stub' && !config.isProd) {
    console.log(`[auth] password reset token for ${user.email}: ${token}`);
  }
  res.status(200).json({ message: 'If that email exists, a reset link has been sent.' });
}

export async function resetPassword(req, res) {
  await authService.resetPassword(req.body || {});
  res.status(200).json({ message: 'Password updated.' });
}
