import { Router } from 'express';
import { verifyJWT } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as log from '../controllers/log.controller.js';

// Mounted at /api, verifyJWT per-route so it never intercepts siblings like /api/health.
const router = Router();

router.post('/sessions', verifyJWT, asyncHandler(log.createSession));
router.get('/sessions', verifyJWT, asyncHandler(log.listSessions));
router.delete('/sessions/:id', verifyJWT, asyncHandler(log.removeSession));

router.post('/logs', verifyJWT, asyncHandler(log.createLog));
router.get('/logs', verifyJWT, asyncHandler(log.listLogs));
router.delete('/logs/:id', verifyJWT, asyncHandler(log.removeLog));

router.get('/stats', verifyJWT, asyncHandler(log.stats));

export default router;
