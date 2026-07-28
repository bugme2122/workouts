// Cloudflare Worker: route  flywren-technologies.com/workouts*  to the Railway service, preserving
// the /workouts path (the app is served at /workouts, so no path rewriting is needed).
//
// Setup:
//   1. Deploy this Worker (Workers & Pages > Create > Worker).
//   2. Set RAILWAY_ORIGIN below to your Railway public URL (from the Railway service page).
//   3. Add a Route:  flywren-technologies.com/workouts*  ->  this Worker (zone must be on Cloudflare).
//
// Requests to any other path fall through to your existing origin/site untouched.

const RAILWAY_ORIGIN = 'https://YOUR-APP.up.railway.app'; // <-- replace with your Railway URL

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/workouts' || url.pathname.startsWith('/workouts/')) {
      const target = RAILWAY_ORIGIN + url.pathname + url.search;
      return fetch(new Request(target, request));
    }
    // Not our path — let the rest of the site handle it.
    return fetch(request);
  },
};
