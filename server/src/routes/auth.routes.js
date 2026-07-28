import { Router } from 'express';
import * as auth from '../controllers/auth.controller.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { verifyJWT } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimit.js';

const router = Router();

// Throttle the unauthenticated auth surface. No /register — accounts are admin-provisioned.
const limiter = authLimiter();

router.post('/login', limiter, asyncHandler(auth.login));
router.post('/refresh', asyncHandler(auth.refresh));
router.post('/logout', verifyJWT, asyncHandler(auth.logout));
router.post('/forgot-password', limiter, asyncHandler(auth.forgotPassword));
router.post('/reset-password', limiter, asyncHandler(auth.resetPassword));

export default router;
