import { httpError } from '../utils/httpError.js';

// requireRole('Admin') — the server-side authorization boundary. Passes if the user holds ANY of
// the allowed roles (users can have multiple). 403 otherwise, BEFORE the controller runs.
export function requireRole(...allowed) {
  return function (req, res, next) {
    if (!req.user) return next(httpError(401, 'Authentication required.'));
    const roles = req.user.roles || [];
    if (!roles.some((r) => allowed.includes(r))) {
      return next(httpError(403, 'You do not have permission to perform this action.'));
    }
    next();
  };
}
