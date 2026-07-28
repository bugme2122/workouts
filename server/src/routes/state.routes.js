import { Router } from 'express';
import { verifyJWT } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as state from '../controllers/state.controller.js';

// Mounted at /api. verifyJWT per-route (not router-wide) so it never intercepts sibling paths like
// /api/health.
const router = Router();

router.get('/state', verifyJWT, asyncHandler(state.getState));
router.put('/state', verifyJWT, asyncHandler(state.putState));
router.get('/presets', verifyJWT, asyncHandler(state.getPresets));
router.put('/presets', verifyJWT, asyncHandler(state.putPresets));
router.delete('/account', verifyJWT, asyncHandler(state.deleteAccount));

export default router;
