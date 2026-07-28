import mongoose from 'mongoose';

const { Schema } = mongoose;

// Workouts has a simple role set (no Supervisor/Auditor). A user can hold multiple roles; `roles`
// is the source of truth and RBAC checks membership. The `role` virtual preserves single-role
// construction/read convenience.
export const ROLES = ['User', 'Admin'];

const userSchema = new Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    roles: {
      type: [{ type: String, enum: ROLES }],
      required: true,
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: 'A user must have at least one role.',
      },
    },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Convenience virtual: setting `role` seeds `roles`; getting returns the first role.
userSchema
  .virtual('role')
  .get(function () {
    return this.roles?.[0] ?? null;
  })
  .set(function (v) {
    if (v && (!this.roles || this.roles.length === 0)) this.roles = [v];
  });

export default mongoose.model('User', userSchema);
