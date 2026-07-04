// firebase-backend.js — Firestore cloud store for a signed-in user. Lazy-loaded.
// Config/presets are stored as a JSON STRING field because Firestore rejects
// nested arrays (our config.ladder is [[on,off],...]).
import { FB_SDK } from "./firebase-config.js";
import { firebaseApp } from "./auth.js";

let _db = null;
async function db() {
  if (_db) return _db;
  const { getFirestore } = await import(`${FB_SDK}/firebase-firestore.js`);
  _db = getFirestore(firebaseApp());
  return _db;
}
export function cloudBackend(uid) {
  const cfgPath = `users/${uid}/state/current`;
  const presetsPath = `users/${uid}/data/presets`;
  return {
    async loadConfig() {
      const d = await db();
      const { doc, getDoc } = await import(`${FB_SDK}/firebase-firestore.js`);
      const snap = await getDoc(doc(d, cfgPath));
      return snap.exists() && snap.data().json ? JSON.parse(snap.data().json) : null;
    },
    async saveConfig(c) {
      const d = await db();
      const { doc, setDoc } = await import(`${FB_SDK}/firebase-firestore.js`);
      await setDoc(doc(d, cfgPath), { json: JSON.stringify(c) });
    },
    async loadPresets() {
      const d = await db();
      const { doc, getDoc } = await import(`${FB_SDK}/firebase-firestore.js`);
      const snap = await getDoc(doc(d, presetsPath));
      return snap.exists() && snap.data().json ? JSON.parse(snap.data().json) : {};
    },
    async savePresets(o) {
      const d = await db();
      const { doc, setDoc } = await import(`${FB_SDK}/firebase-firestore.js`);
      await setDoc(doc(d, presetsPath), { json: JSON.stringify(o) });
    },
    async deleteAll() {
      const d = await db();
      const { doc, deleteDoc } = await import(`${FB_SDK}/firebase-firestore.js`);
      await deleteDoc(doc(d, cfgPath));
      await deleteDoc(doc(d, presetsPath));
    },
  };
}
