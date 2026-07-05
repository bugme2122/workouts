// framebust.js — clickjacking guard. Loaded synchronously in <head> so it runs
// before any UI paints. This is the host-independent replacement for the CSP
// `frame-ancestors 'none'` / `X-Frame-Options: DENY` HTTP headers, which static
// hosts like GitHub Pages cannot set. Must be an external (self) script: the
// page's meta CSP uses `script-src 'self'` with no 'unsafe-inline', so an inline
// version would be blocked.
if (window.top !== window.self) {
  // We're framed by another page — break out to the top.
  window.top.location = window.self.location;
}
