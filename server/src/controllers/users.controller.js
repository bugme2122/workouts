import User from '../models/User.js';
import { serializeUser } from '../utils/serializers.js';
import { httpError } from '../utils/httpError.js';

// GET /api/users/me — the client uses this on load to restore the signed-in profile after a
// silent refresh.
export async function getMe(req, res) {
  const user = await User.findById(req.user.id);
  if (!user) throw httpError(404, 'User not found.');
  res.json(serializeUser(user));
}
