// auth.js — Google auth via Firebase, lazy-loaded so guests/offline never fetch it.
import { firebaseConfig, FB_SDK } from "./firebase-config.js";

let _app = null, _auth = null, _provider = null;
async function ensure() {
  if (_auth) return _auth;
  const { initializeApp } = await import(`${FB_SDK}/firebase-app.js`);
  const { getAuth, GoogleAuthProvider } = await import(`${FB_SDK}/firebase-auth.js`);
  _app = initializeApp(firebaseConfig);
  _auth = getAuth(_app);
  _provider = new GoogleAuthProvider();
  return _auth;
}
export function firebaseApp() { return _app; }

export async function initAuth(onChange) {
  const auth = await ensure();
  const { onAuthStateChanged } = await import(`${FB_SDK}/firebase-auth.js`);
  onAuthStateChanged(auth, onChange);
}
export async function signInWithGoogle() {
  const auth = await ensure();
  const { signInWithPopup } = await import(`${FB_SDK}/firebase-auth.js`);
  return signInWithPopup(auth, _provider);
}
export async function signOutUser() {
  const auth = await ensure();
  const { signOut } = await import(`${FB_SDK}/firebase-auth.js`);
  return signOut(auth);
}
