// Wipes the SQLite database so the next server boot re-seeds a brand-new one
// (admin + demo team, empty lots). The server MUST be stopped first.
//
//   1. Stop the server (Ctrl+C / taskkill)
//   2. npm run db:fresh
//   3. Start the server again
//
// WARNING: this permanently deletes ALL leads, lots, users, reminders and
// settings. Back up data/leadflow.sqlite first if anything matters.
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
for (const f of ['leadflow.sqlite', 'leadflow.sqlite-wal', 'leadflow.sqlite-shm']) {
  const p = path.join(dataDir, f);
  try {
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
      console.log('deleted', p);
    }
  } catch (err) {
    console.error(`cannot delete ${p} — is the server still running?`, String(err));
    process.exit(1);
  }
}
console.log('done. Start the server to seed a fresh database.');
