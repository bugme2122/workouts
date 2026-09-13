import mongoose from 'mongoose';

const { Schema } = mongoose;

// Per-user workout state, replacing Firestore's users/{uid}/state/current + data/presets.
// Config and presets are stored as JSON strings (schema-agnostic; matches the shape the Firestore
// backend already used, { json: JSON.stringify(...) }). One doc per user.
const workoutStateSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    configJson: { type: String, default: null },
    presetsJson: { type: String, default: null },
    // Set only by putState, never by putPresets. The document's own `updatedAt` bumps on EITHER
    // write, so the client's newest-wins sync (decideMigration) was comparing config staleness
    // against a timestamp a presets-only save could also move — a preset saved on device A after
    // a config edit on device B could make B's untouched-but-now-"stale" config lose on sign-in.
    configUpdatedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model('WorkoutState', workoutStateSchema);
