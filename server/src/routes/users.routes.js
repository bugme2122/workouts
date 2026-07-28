import { Router } from 'express';
import { verifyJWT } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as users from '../controllers/users.controller.js';

const router = Router();

router.get('/me', verifyJWT, asyncHandler(users.getMe));

export default router;
