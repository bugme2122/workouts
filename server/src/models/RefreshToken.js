import mongoose from 'mongoose';

const { Schema } = mongoose;

// Server-side refresh-token store so tokens can be revoked on logout / password reset. The refresh
// token itself is returned in the login/refresh JSON body (not a cookie). We store only a hash.
const refreshTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// TTL cleanup of expired tokens.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model('RefreshToken', refreshTokenSchema);
