import mongoose from 'mongoose';

// One completed (or abandoned) run of the timer. The snapshot fields matter: editing a workout
// later must never rewrite what you actually did last month, so name/workoutId/totalPhases are
// copied at write time rather than joined at read time.
const sessionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    kind: { type: String, enum: ['circuit', 'regimen'], required: true },
    workoutId: { type: String, default: null }, // catalog id, e.g. "kb-ladder"
    name: { type: String, required: true, trim: true, maxlength: 120 },
    startedAt: { type: Date, required: true },
    durationSec: { type: Number, required: true, min: 0, max: 86400 },
    completed: { type: Boolean, default: false },
    phasesDone: { type: Number, default: 0, min: 0 },
    totalPhases: { type: Number, default: 0, min: 0 },
    people: { type: Number, default: 1, min: 1, max: 6 },
    // Enough of the circuit to describe the run in History without re-deriving it from a
    // workout that may since have changed.
    ladder: { type: [[Number]], default: [] },
    stations: { type: [String], default: [] },
  },
  { timestamps: true }
);

sessionSchema.index({ userId: 1, startedAt: -1 });

export default mongoose.model('WorkoutSession', sessionSchema);
