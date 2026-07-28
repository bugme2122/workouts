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
  },
  { timestamps: true }
);

export default mongoose.model('WorkoutState', workoutStateSchema);
