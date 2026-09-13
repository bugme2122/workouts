import { Router } from 'express';
import { verifyJWT } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { discover } from '../controllers/discover.controller.js';

// Signed-in only: it costs an upstream request, and there is no reason for an anonymous
// visitor to be able to drive it.
const router = Router();
router.get('/discover', verifyJWT, asyncHandler(discover));
export default router;
