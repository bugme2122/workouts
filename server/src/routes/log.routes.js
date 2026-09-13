import { Router } from 'express';
import { verifyJWT } from '../middleware/auth.js';
import { writeLimiter } from '../middleware/rateLimit.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as log from '../controllers/log.controller.js';

// Mounted at /api, verifyJWT per-route so it never intercepts siblings like /api/health.
const router = Router();
// AFTER verifyJWT (needs req.user to key by account, not IP) and only on the writes that can
// accumulate documents — reads and deletes aren't the exposure this guards against.
const limited = writeLimiter();

router.post('/sessions', verifyJWT, limited, asyncHandler(log.createSession));
router.get('/sessions', verifyJWT, asyncHandler(log.listSessions));
router.delete('/sessions/:id', verifyJWT, asyncHandler(log.removeSession));

router.post('/logs', verifyJWT, limited, asyncHandler(log.createLog));
router.get('/logs', verifyJWT, asyncHandler(log.listLogs));
router.patch('/logs/:id', verifyJWT, asyncHandler(log.updateLog));
router.delete('/logs/:id', verifyJWT, asyncHandler(log.removeLog));

router.get('/stats', verifyJWT, asyncHandler(log.stats));

export default router;
