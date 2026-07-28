// base.js — sets the app's base path. Loaded as a classic (non-module) script BEFORE the ES
// modules so window.__BASE__ exists when api.js/auth.js first read it. Under strict CSP
// (script-src 'self') an inline script is forbidden, so the value is delivered as this file:
// in production the Express server serves a generated version with the real BASE_PATH (e.g.
// "/workouts"); this committed default (empty) is what a plain static host / local dev uses.
window.__BASE__ = "";
