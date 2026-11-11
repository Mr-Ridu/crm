// Production entry point for hosts that run `node <startup-file>`
// (cPanel "Setup Node.js App" / Application Manager via Phusion Passenger).
// The app source is TypeScript, so this tiny wrapper registers tsx's
// require-hook first and then loads the real server. No CLI flags needed.
//
// cPanel -> Application startup file:  start.cjs
try {
  require('tsx/cjs');
} catch (err) {
  console.error(
    '[LeadFlow] Could not load tsx. Run `npm install` first so dependencies (incl. tsx) exist.'
  );
  throw err;
}
// node:sqlite ships inside Node itself, but ONLY on Node >= 22.5 — and
// without extra flags only on >= 22.13. Fail here with a clear message
// instead of a cryptic crash deep inside the server (cPanel often defaults
// to an older Node — pick 22.13+ in "Setup Node.js App").
try {
  require('node:sqlite');
} catch (err) {
  console.error(
    `[LeadFlow] This app needs Node.js 22.13 or newer (found ${process.version}). ` +
      'Select a newer Node version and restart the app.'
  );
  process.exit(1);
}
require('./server/index.ts');
