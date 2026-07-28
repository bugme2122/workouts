import { verifyAccessToken } from '../utils/tokens.js';
import { httpError } from '../utils/httpError.js';

// verifyJWT — decodes the access token and populates req.user from its claims. Runs before
// requireRole on every protected route.
export function verifyJWT(req, res, next) {
  const header = req.headers?.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return next(httpError(401, 'Authentication required.'));
  }
  try {
    const payload = verifyAccessToken(token);
    const roles = payload.roles ?? [];
    req.user = { id: payload.sub, roles, email: payload.email, hasRole: (r) => roles.includes(r) };
    return next();
  } catch {
    return next(httpError(401, 'Session expired. Please log in again.'));
  }
}
