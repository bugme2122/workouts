import mongoose from 'mongoose';

// One logged set-group: "3 x 15 at 25 lb of KB Swings". Optionally attached to the session it
// was performed during, so History can show it under that run.
const setLogSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkoutSession', default: null },
    exercise: { type: String, required: true, trim: true, maxlength: 80 },
    // Lowercased copy, so grouping and filtering by exercise never needs a regex scan. Indexed
    // as part of the compound below, not standalone — the actual query is {userId, exerciseKey}
    // sorted by performedAt, and a lone exerciseKey index can't serve both the filter and the sort.
    exerciseKey: { type: String, required: true },
    sets: { type: Number, default: 1, min: 0, max: 100 },
    reps: { type: Number, default: 0, min: 0, max: 1000 },
    weight: { type: Number, default: 0, min: 0, max: 10000 },
    unit: { type: String, enum: ['lb', 'kg', 'bw'], default: 'lb' },
    note: { type: String, default: '', maxlength: 500 },
    source: { type: String, enum: ['voice', 'manual'], default: 'manual' },
    performedAt: { type: Date, required: true },
  },
  { timestamps: true }
);

setLogSchema.index({ userId: 1, performedAt: -1 });
// Matches GET /api/logs?exercise=... — equality on both fields, sorted by the index's own order.
setLogSchema.index({ userId: 1, exerciseKey: 1, performedAt: -1 });
// Matches GET /api/logs?sessionId=... (the workout-detail and session-expansion lookups).
setLogSchema.index({ userId: 1, sessionId: 1 });

export default mongoose.model('SetLog', setLogSchema);
