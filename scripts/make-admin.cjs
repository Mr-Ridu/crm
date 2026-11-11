// Manually create (or promote) an admin account from the terminal.
// The server MUST be stopped first (SQLite file lock).
//
//   node scripts/make-admin.cjs "Your Name" "you@company.com" "StrongPass123"
//
// - If the email exists -> it is promoted to admin and the password is reset.
// - If it is new -> a fresh admin account is created.
// Passwords are scrypt-hashed (same as the app). Minimum 6 characters.
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const path = require('path');
const fs = require('fs');

const [name, email, password] = process.argv.slice(2);
if (!name || !email || !password) {
  console.error('Usage: node scripts/make-admin.cjs "Your Name" "you@company.com" "StrongPass123"');
  process.exit(1);
}
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error('That email does not look valid:', email);
  process.exit(1);
}
if (password.length < 6) {
  console.error('Password must be at least 6 characters.');
  process.exit(1);
}

const dbPath = path.join(__dirname, '..', 'data', 'leadflow.sqlite');
if (!fs.existsSync(dbPath)) {
  console.error('No database found. Start the server once first so it seeds, then stop it and re-run.');
  process.exit(1);
}

function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(plain, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt}$${hash.toString('hex')}`;
}

let db;
try {
  db = new DatabaseSync(dbPath);
} catch (err) {
  console.error('Cannot open database — is the server still running? Stop it first.');
  process.exit(1);
}

const now = new Date().toISOString();
const existing = db
  .prepare('SELECT id, name, role FROM users WHERE LOWER(email) = LOWER(?)')
  .get(email.trim());

if (existing) {
  db.prepare('UPDATE users SET name = ?, password = ?, role = ?, active = 1 WHERE id = ?').run(
    name.trim(),
    hashPassword(password),
    'admin',
    existing.id
  );
  console.log(`Updated #${existing.id} (${existing.name}) -> admin "${email.trim()}" with a new password.`);
} else {
  const colors = ['#4f46e5', '#059669', '#d97706', '#db2777', '#2563eb'];
  const count = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  const r = db
    .prepare(
      `INSERT INTO users (name, email, password, role, phone, telegram_chat_id, avatar_color, active, created_at)
       VALUES (?, ?, ?, 'admin', '', '', ?, 1, ?)`
    )
    .run(name.trim(), email.trim().toLowerCase(), hashPassword(password), colors[count % colors.length], now);
  console.log(`Created admin #${Number(r.lastInsertRowid)} "${email.trim().toLowerCase()}".`);
}
db.close();
console.log('Done. Start the server and sign in with your new credentials.');
