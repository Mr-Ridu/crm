import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { db, initDatabase } from './db.ts';
import type { IntegrationSettings, Role } from '../src/types.ts';
import { DEFAULT_INTEGRATION_SETTINGS } from '../src/types.ts';

initDatabase();

// Drop expired login sessions on every boot (30-day lifetime).
try {
  db.prepare("DELETE FROM sessions WHERE created_at <= datetime('now', '-30 days')").run();
} catch {
  // sessions table may not exist on very first run before init — safe to ignore
}

// Bound the outbound dispatch log (every Telegram/Email send writes a row).
// Without this the table grows forever on busy reminder schedules.
try {
  db.prepare(
    `DELETE FROM outbound_dispatch_logs
     WHERE id NOT IN (SELECT id FROM outbound_dispatch_logs ORDER BY id DESC LIMIT 5000)
        OR created_at <= datetime('now', '-90 days')`
  ).run();
} catch {
  // table may not exist on very first run before init — safe to ignore
}

const app = express();
app.disable('x-powered-by');
// Tiny security headers (no extra dependency). The UI + API are same-origin,
// so SAMEORIGIN framing and no-referrer are safe everywhere here.
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Production auth gate: every /api route EXCEPT login needs a valid
// session token. Unauthenticated requests get 401 before reaching handlers.
app.use('/api', (req, res, next) => {
  if (req.path === '/auth/login') return next();
  const user = getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: 'Login required' });
    return;
  }
  (req as any).authUser = user;
  next();
});

// Helper to resolve current user from header `x-user-id`
interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: Role;
  phone: string;
  telegram_chat_id: string;
  avatar_color: string;
  active: number;
}

function getSessionUser(token: string | undefined): AuthUser | null {
  if (!token) return null;
  // Sessions older than 30 days are expired.
  const sess = db
    .prepare("SELECT user_id FROM sessions WHERE token = ? AND created_at > datetime('now', '-30 days')")
    .get(token) as { user_id: number } | undefined;
  if (!sess) return null;
  const user = db
    .prepare('SELECT id, name, email, role, phone, telegram_chat_id, avatar_color, active FROM users WHERE id = ? AND active = 1')
    .get(sess.user_id) as AuthUser | undefined;
  return user || null;
}

// Authenticated user comes ONLY from a login session token.
// There is no default user: without a valid token this returns null.
function getCurrentUser(req: express.Request): AuthUser | null {
  if ((req as any).authUser) return (req as any).authUser as AuthUser;
  const header = req.headers['authorization'];
  const token = typeof header === 'string' && header.startsWith('Bearer ')
    ? header.slice(7)
    : undefined;
  return getSessionUser(token);
}

import { hashPassword, verifyPassword, passwordNeedsMigration } from './password.ts';

// ---- Login brute-force protection (in-memory, per process) ----
// 10 failed attempts per IP+email within 10 minutes -> 10-minute block.
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_FAILS = 10;
const loginFails = new Map<string, { count: number; firstAt: number; blockedUntil: number }>();

function loginAttemptKey(req: express.Request, email: string): string {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  return `${ip}|${String(email || '').trim().toLowerCase()}`;
}

function pruneLoginFails() {
  if (loginFails.size < 500) return;
  const now = Date.now();
  for (const [k, v] of loginFails) {
    if (v.blockedUntil < now && v.firstAt + LOGIN_WINDOW_MS < now) loginFails.delete(k);
  }
}

function isLoginBlocked(key: string): number {
  const rec = loginFails.get(key);
  if (!rec) return 0;
  const now = Date.now();
  if (rec.blockedUntil > now) return rec.blockedUntil - now;
  if (rec.firstAt + LOGIN_WINDOW_MS < now) loginFails.delete(key);
  return 0;
}

function recordLoginFail(key: string) {
  const now = Date.now();
  const rec = loginFails.get(key);
  if (!rec || rec.firstAt + LOGIN_WINDOW_MS < now) {
    loginFails.set(key, { count: 1, firstAt: now, blockedUntil: 0 });
    return;
  }
  rec.count += 1;
  if (rec.count >= LOGIN_MAX_FAILS) rec.blockedUntil = now + LOGIN_WINDOW_MS;
}

function clearLoginFails(key: string) {
  loginFails.delete(key);
}

function toPublicUser(u: any) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    phone: u.phone,
    telegramChatId: u.telegram_chat_id,
    avatarColor: u.avatar_color,
    active: Boolean(u.active),
    createdAt: u.created_at,
  };
}

function getAccessibleLotIds(user: AuthUser): number[] {
  if (user.role === 'admin') {
    const rows = db.prepare('SELECT id FROM lots').all() as { id: number }[];
    return rows.map((r) => r.id);
  }
  const rows = db
    .prepare('SELECT lot_id FROM lot_access WHERE user_id = ?')
    .all(user.id) as { lot_id: number }[];
  return rows.map((r) => r.lot_id);
}

// Strict isolation: can this user touch this specific lead's lot?
function canAccessLeadLot(user: AuthUser, leadId: number): boolean {
  const lead = db.prepare('SELECT lot_id FROM leads WHERE id = ?').get(Number(leadId)) as
    | { lot_id: number }
    | undefined;
  if (!lead) return false;
  return getAccessibleLotIds(user).includes(lead.lot_id);
}

// Strict isolation: can this user read/update/delete this specific reminder?
// Admin can touch any reminder. A member only their own reminders inside lots they can access.
function canAccessReminder(
  user: AuthUser,
  reminderId: number
): 'ok' | 'not_found' | 'forbidden' {
  const rem = db
    .prepare(
      `SELECT r.id, r.user_id, l.lot_id
       FROM reminders r
       INNER JOIN leads l ON l.id = r.lead_id
       WHERE r.id = ?`
    )
    .get(Number(reminderId)) as { id: number; user_id: number; lot_id: number } | undefined;

  if (!rem) return 'not_found';
  if (user.role === 'admin') return 'ok';
  if (rem.user_id !== user.id) return 'forbidden';
  return getAccessibleLotIds(user).includes(rem.lot_id) ? 'ok' : 'forbidden';
}

function getSettings(): IntegrationSettings {
  const row = db
    .prepare('SELECT value FROM app_settings WHERE key = ?')
    .get('integration_settings') as { value: string } | undefined;
  if (!row) return DEFAULT_INTEGRATION_SETTINGS;
  try {
    return { ...DEFAULT_INTEGRATION_SETTINGS, ...JSON.parse(row.value) };
  } catch {
    return DEFAULT_INTEGRATION_SETTINGS;
  }
}

// Per-user sender credentials: every user sends from their OWN bot / email
// sender — there is no shared credential anymore.
interface SenderCreds {
  telegramEnabled: boolean;
  telegramBotToken: string;
  emailEnabled: boolean;
  emailProvider: string;
  emailApiKey: string;
  emailSmtpHost: string;
  emailFrom: string;
}

function userSenderCreds(u: any): SenderCreds {
  return {
    telegramEnabled: Number(u?.nt_tg_enabled) === 1,
    telegramBotToken: u?.nt_tg_bot_token || '',
    emailEnabled: Number(u?.nt_email_enabled) === 1,
    emailProvider: u?.nt_email_provider || 'resend',
    emailApiKey: u?.nt_email_api_key || '',
    emailSmtpHost: u?.nt_email_smtp_host || '',
    emailFrom: u?.nt_email_from || '',
  };
}

function fullUserRow(id: number): any {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
}

// Out-of-phone notification dispatcher (Telegram Bot API + Email Webhook/API)
async function dispatchExternalAlert(params: {
  channel: 'telegram' | 'email';
  recipient: string;
  subject: string;
  message: string;
  creds: SenderCreds;
}) {
  const { channel, recipient, subject, message, creds } = params;
  const now = new Date().toISOString();

  if (channel === 'telegram') {
    if (!creds.telegramEnabled || !creds.telegramBotToken || !recipient) {
      db.prepare(
        `INSERT INTO outbound_dispatch_logs (channel, recipient, subject, message, status, error_detail, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        'telegram',
        recipient || '(unconfigured)',
        subject,
        message,
        'skipped_missing_credentials',
        'Your Telegram bot / chat ID is blank — set it in My Alerts to send live Telegram push.',
        now
      );
      return { ok: false, reason: 'Telegram credentials not configured yet' };
    }

    try {
      const url = `https://api.telegram.org/bot${creds.telegramBotToken.trim()}/sendMessage`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({
          chat_id: recipient.trim(),
          text: `🔔 *${subject}*\n\n${message}`,
          parse_mode: 'Markdown',
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.description || `HTTP ${resp.status}`);
      }
      db.prepare(
        `INSERT INTO outbound_dispatch_logs (channel, recipient, subject, message, status, error_detail, created_at)
         VALUES (?, ?, ?, ?, ?, '', ?)`
      ).run('telegram', recipient, subject, message, 'sent', now);
      return { ok: true };
    } catch (err: any) {
      db.prepare(
        `INSERT INTO outbound_dispatch_logs (channel, recipient, subject, message, status, error_detail, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run('telegram', recipient, subject, message, 'error', String(err?.message || err), now);
      return { ok: false, reason: String(err?.message || err) };
    }
  }

  if (channel === 'email') {
    if (!creds.emailEnabled || !creds.emailApiKey || !recipient) {
      db.prepare(
        `INSERT INTO outbound_dispatch_logs (channel, recipient, subject, message, status, error_detail, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        'email',
        recipient || '(unconfigured)',
        subject,
        message,
        'skipped_missing_credentials',
        'Your Email sender key is blank — set it in My Alerts to send live Email alerts.',
        now
      );
      return { ok: false, reason: 'Email credentials not configured yet' };
    }

    try {
      if (creds.emailProvider === 'resend') {
        const resp = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${creds.emailApiKey.trim()}`,
            'Content-Type': 'application/json',
          },
          signal: AbortSignal.timeout(15000),
          body: JSON.stringify({
            from: creds.emailFrom || 'LeadFlow CRM <onboarding@resend.dev>',
            to: [recipient.trim()],
            subject,
            text: message,
          }),
        });
        if (!resp.ok) {
          const errText = await resp.text();
          throw new Error(errText);
        }
      } else if (creds.emailProvider === 'webhook' && creds.emailSmtpHost) {
        const resp = await fetch(creds.emailSmtpHost.trim(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: recipient, subject, message }),
          signal: AbortSignal.timeout(15000),
        });
        if (!resp.ok) throw new Error(`Webhook status ${resp.status}`);
      } else {
        // Never report 'sent' when nothing was actually dispatched.
        db.prepare(
          `INSERT INTO outbound_dispatch_logs (channel, recipient, subject, message, status, error_detail, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(
          'email',
          recipient,
          subject,
          message,
          'skipped_unsupported_provider',
          `Email provider '${creds.emailProvider}' cannot send directly — use Resend API or a webhook URL in My Alerts.`,
          now
        );
        return { ok: false, reason: 'Email provider cannot send directly (use Resend or webhook)' };
      }
      db.prepare(
        `INSERT INTO outbound_dispatch_logs (channel, recipient, subject, message, status, error_detail, created_at)
         VALUES (?, ?, ?, ?, ?, '', ?)`
      ).run('email', recipient, subject, message, 'sent', now);
      return { ok: true };
    } catch (err: any) {
      db.prepare(
        `INSERT INTO outbound_dispatch_logs (channel, recipient, subject, message, status, error_detail, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run('email', recipient, subject, message, 'error', String(err?.message || err), now);
      return { ok: false, reason: String(err?.message || err) };
    }
  }

  return { ok: false };
}

// ==========================================
// 1. AUTH & USERS
// ==========================================

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const key = loginAttemptKey(req, email);
  pruneLoginFails();

  const blockedMs = isLoginBlocked(key);
  if (blockedMs > 0) {
    res.set('Retry-After', String(Math.ceil(blockedMs / 1000)));
    res.status(429).json({ error: 'Too many failed attempts. Try again in a few minutes.' });
    return;
  }

  const user = db
    .prepare(
      'SELECT id, name, email, role, phone, telegram_chat_id, avatar_color, active, created_at, password FROM users WHERE LOWER(email) = LOWER(?)'
    )
    .get(String(email || '').trim()) as any;

  if (!user || !verifyPassword(String(password || ''), user.password)) {
    recordLoginFail(key);
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }
  if (!user.active) {
    res.status(403).json({ error: 'Account is disabled. Contact Admin.' });
    return;
  }

  // Transparent upgrade: legacy plaintext row -> scrypt hash on first good login.
  if (passwordNeedsMigration(user.password)) {
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashPassword(String(password)), user.id);
  }
  clearLoginFails(key);

  // Issue a session token (stored server-side, survives restarts)
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)').run(
    token,
    user.id,
    new Date().toISOString()
  );

  res.json({ token, user: toPublicUser(user) });
});

// Restore a saved session (used on page reload)
app.get('/api/auth/me', (req, res) => {
  const current = getCurrentUser(req);
  if (!current) {
    res.status(401).json({ error: 'Login required' });
    return;
  }
  const full = db
    .prepare('SELECT id, name, email, role, phone, telegram_chat_id, avatar_color, active, created_at FROM users WHERE id = ?')
    .get(current.id) as any;
  res.json({ user: toPublicUser(full) });
});

// Log out on this device (deletes the session token)
app.post('/api/auth/logout', (req, res) => {
  const header = req.headers['authorization'];
  const token = typeof header === 'string' && header.startsWith('Bearer ')
    ? header.slice(7)
    : undefined;
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.json({ success: true });
});

// ---- Own notification credentials (fully per-user, never shared) ----
// A user can only ever read/write THEIR OWN row — ids come from the session.
app.get('/api/profile/notifications', (req, res) => {
  const current = getCurrentUser(req);
  if (!current) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const me = fullUserRow(current.id);
  if (!me) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }
  res.json({
    telegramEnabled: Number(me.nt_tg_enabled) === 1,
    telegramBotToken: me.nt_tg_bot_token || '',
    telegramChatId: me.telegram_chat_id || '',
    emailEnabled: Number(me.nt_email_enabled) === 1,
    emailProvider: me.nt_email_provider || 'resend',
    emailApiKey: me.nt_email_api_key || '',
    emailSmtpHost: me.nt_email_smtp_host || '',
    emailFrom: me.nt_email_from || '',
    loginEmail: me.email || '',
  });
});

app.put('/api/profile/notifications', (req, res) => {
  const current = getCurrentUser(req);
  if (!current) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const b = req.body || {};
  const provider = ['resend', 'webhook'].includes(b.emailProvider) ? b.emailProvider : 'resend';
  try {
    db.prepare(
      `UPDATE users SET
         nt_tg_enabled = ?,
         nt_tg_bot_token = ?,
         telegram_chat_id = ?,
         nt_email_enabled = ?,
         nt_email_provider = ?,
         nt_email_api_key = ?,
         nt_email_smtp_host = ?,
         nt_email_from = ?
       WHERE id = ?`
    ).run(
      b.telegramEnabled ? 1 : 0,
      String(b.telegramBotToken || '').trim(),
      String(b.telegramChatId || '').trim(),
      b.emailEnabled ? 1 : 0,
      provider,
      String(b.emailApiKey || '').trim(),
      String(b.emailSmtpHost || '').trim(),
      String(b.emailFrom || '').trim(),
      current.id
    );
  } catch (err: any) {
    res.status(400).json({ error: 'Could not save (is your database up to date? restart the server once)' });
    return;
  }
  res.json({ success: true });
});

// List all users (Admin Team page + lot-access pickers).
// Contact details (email/phone/chat id) are admin-only — members only need
// names, roles and lot assignments for the pickers to work.
app.get('/api/users', (req, res) => {
  const current = getCurrentUser(req);
  if (!current) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const isAdmin = current.role === 'admin';
  const rows = db
    .prepare(
      'SELECT id, name, email, role, phone, telegram_chat_id, avatar_color, active, created_at FROM users ORDER BY role ASC, id ASC'
    )
    .all() as any[];

  const accessRows = db
    .prepare('SELECT lot_id, user_id FROM lot_access')
    .all() as { lot_id: number; user_id: number }[];

  const result = rows.map((u) => ({
    id: u.id,
    name: u.name,
    email: isAdmin ? u.email : '',
    role: u.role,
    phone: isAdmin ? u.phone : '',
    telegramChatId: isAdmin ? u.telegram_chat_id : '',
    avatarColor: u.avatar_color,
    active: Boolean(u.active),
    createdAt: u.created_at,
    assignedLotIds: accessRows.filter((a) => a.user_id === u.id).map((a) => a.lot_id),
  }));

  res.json(result);
});

app.post('/api/users', (req, res) => {
  const current = getCurrentUser(req);
  if (!current || current.role !== 'admin') {
    res.status(403).json({ error: 'Only Admin can create user accounts' });
    return;
  }

  const { name, email, password, role, phone, telegramChatId, avatarColor, assignedLotIds } = req.body;
  if (!name || !email) {
    res.status(400).json({ error: 'Name and Email are required' });
    return;
  }
  if (!password || String(password).trim() === '') {
    res.status(400).json({ error: 'A password is required for the new account' });
    return;
  }

  const now = new Date().toISOString();
  try {
    const insert = db
      .prepare(
        `INSERT INTO users (name, email, password, role, phone, telegram_chat_id, avatar_color, active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`
      )
      .run(
        name.trim(),
        email.trim().toLowerCase(),
        hashPassword(String(password).trim()),
        role === 'admin' ? 'admin' : 'member',
        phone || '',
        telegramChatId || '',
        avatarColor || '#059669',
        now
      );

    const newUserId = Number(insert.lastInsertRowid);
    if (Array.isArray(assignedLotIds) && assignedLotIds.length > 0) {
      const grant = db.prepare('INSERT OR IGNORE INTO lot_access (lot_id, user_id, granted_at) VALUES (?, ?, ?)');
      for (const lotId of assignedLotIds) {
        grant.run(Number(lotId), newUserId, now);
      }
    }

    res.json({ id: newUserId, success: true });
  } catch (err: any) {
    res.status(400).json({ error: err?.message?.includes('UNIQUE') ? 'Email already exists' : String(err) });
  }
});

app.put('/api/users/:id', (req, res) => {
  const current = getCurrentUser(req);
  if (!current || current.role !== 'admin') {
    res.status(403).json({ error: 'Only Admin can update users' });
    return;
  }

  const targetId = Number(req.params.id);
  const { name, email, password, role, phone, telegramChatId, avatarColor, active, assignedLotIds } = req.body;

  if (role !== undefined && role !== 'admin' && role !== 'member') {
    res.status(400).json({ error: 'Role must be admin or member' });
    return;
  }
  if (email !== undefined && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email))) {
    res.status(400).json({ error: 'That email does not look valid' });
    return;
  }

  // Self-lockout guard: an admin must never demote or disable their own
  // account while they are the last active admin.
  if (targetId === current.id && (role === 'member' || active === false)) {
    const otherAdmins = (
      db
        .prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin' AND active = 1 AND id != ?")
        .get(current.id) as { c: number }
    ).c;
    if (otherAdmins === 0) {
      res.status(400).json({
        error: 'You are the last active admin — promote someone else first',
      });
      return;
    }
  }

  try {
    db.prepare(
      `UPDATE users
       SET name = COALESCE(?, name),
           email = COALESCE(?, email),
           role = COALESCE(?, role),
           phone = COALESCE(?, phone),
           telegram_chat_id = COALESCE(?, telegram_chat_id),
           avatar_color = COALESCE(?, avatar_color),
           active = COALESCE(?, active)
       WHERE id = ?`
    ).run(
      name ?? null,
      email ? String(email).trim().toLowerCase() : null,
      role ?? null,
      phone ?? null,
      telegramChatId ?? null,
      avatarColor ?? null,
      typeof active === 'boolean' ? (active ? 1 : 0) : null,
      targetId
    );
  } catch (err: any) {
    res.status(400).json({ error: err?.message?.includes('UNIQUE') ? 'Email already exists' : 'Could not update user' });
    return;
  }

  if (password && String(password).trim() !== '') {
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashPassword(String(password).trim()), targetId);
  }

  if (Array.isArray(assignedLotIds)) {
    db.prepare('DELETE FROM lot_access WHERE user_id = ?').run(targetId);
    const now = new Date().toISOString();
    const grant = db.prepare('INSERT OR IGNORE INTO lot_access (lot_id, user_id, granted_at) VALUES (?, ?, ?)');
    for (const lotId of assignedLotIds) {
      grant.run(Number(lotId), targetId, now);
    }
  }

  res.json({ success: true });
});

app.delete('/api/users/:id', (req, res) => {
  const current = getCurrentUser(req);
  if (!current || current.role !== 'admin') {
    res.status(403).json({ error: 'Only Admin can delete users' });
    return;
  }
  const targetId = Number(req.params.id);
  if (targetId === current.id) {
    res.status(400).json({ error: 'Cannot delete your own admin account' });
    return;
  }
  const target = db.prepare('SELECT role FROM users WHERE id = ?').get(targetId) as
    | { role: string }
    | undefined;
  if (target?.role === 'admin') {
    const adminCount = (db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin' AND active = 1").get() as { c: number }).c;
    if (adminCount <= 1) {
      res.status(400).json({ error: 'Cannot delete the last admin account' });
      return;
    }
  }
  // Lots uploaded by this user SURVIVE (lots.created_by is ON DELETE SET NULL);
  // their lot_access rows and sessions are cleaned up by CASCADE.
  db.prepare('DELETE FROM users WHERE id = ?').run(targetId);
  res.json({ success: true });
});

// ==========================================
// 2. LOTS & ACCESS CONTROL
// ==========================================

app.get('/api/lots', (req, res) => {
  const current = getCurrentUser(req);
  if (!current) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  let lots: any[] = [];
  if (current.role === 'admin') {
    lots = db
      .prepare(
        `SELECT l.*, u.name as created_by_name
         FROM lots l
         LEFT JOIN users u ON u.id = l.created_by
         ORDER BY l.created_at DESC`
      )
      .all();
  } else {
    lots = db
      .prepare(
        `SELECT l.*, u.name as created_by_name
         FROM lots l
         INNER JOIN lot_access la ON la.lot_id = l.id AND la.user_id = ?
         LEFT JOIN users u ON u.id = l.created_by
         ORDER BY l.created_at DESC`
      )
      .all(current.id);
  }

  const statsRows = db
    .prepare(
      `SELECT
         lot_id,
         COUNT(*) as total,
         SUM(CASE WHEN status = 'New' THEN 1 ELSE 0 END) as new_cnt,
         SUM(CASE WHEN status != 'New' THEN 1 ELSE 0 END) as contacted_cnt,
         SUM(CASE WHEN status IN ('Interested', 'Meeting Scheduled', 'Proposal Sent', 'Closed Won') THEN 1 ELSE 0 END) as converted_cnt
       FROM leads
       GROUP BY lot_id`
    )
    .all() as any[];

  const accessRows = db
    .prepare(
      `SELECT la.lot_id, u.id, u.name, u.email, u.avatar_color
       FROM lot_access la
       INNER JOIN users u ON u.id = la.user_id`
    )
    .all() as any[];

  const columnRows = db
    .prepare(
      `SELECT lot_id, key, label, position FROM lot_columns ORDER BY lot_id ASC, position ASC, id ASC`
    )
    .all() as any[];

  const result = lots.map((l) => {
    const stat = statsRows.find((s) => s.lot_id === l.id);
    const assigned = accessRows
      .filter((a) => a.lot_id === l.id)
      .map((a) => ({
        id: a.id,
        name: a.name,
        email: a.email,
        avatarColor: a.avatar_color,
      }));
    return {
      id: l.id,
      name: l.name,
      description: l.description,
      sourceFileName: l.source_file_name,
      createdBy: l.created_by,
      createdByName: l.created_by_name,
      createdAt: l.created_at,
      leadCount: stat ? Number(stat.total) : 0,
      newCount: stat ? Number(stat.new_cnt) : 0,
      contactedCount: stat ? Number(stat.contacted_cnt) : 0,
      convertedCount: stat ? Number(stat.converted_cnt) : 0,
      assignedUsers: assigned,
      columns: columnRows
        .filter((c) => c.lot_id === l.id)
        .map((c) => ({ key: c.key, label: c.label, position: c.position })),
    };
  });

  res.json(result);
});

app.put('/api/lots/:id/access', (req, res) => {
  const current = getCurrentUser(req);
  if (!current || current.role !== 'admin') {
    res.status(403).json({ error: 'Only Admin can change lot access' });
    return;
  }

  const lotId = Number(req.params.id);
  const { userIds, name, description } = req.body;

  if (name !== undefined || description !== undefined) {
    db.prepare(
      'UPDATE lots SET name = COALESCE(?, name), description = COALESCE(?, description) WHERE id = ?'
    ).run(name ?? null, description ?? null, lotId);
  }

  if (Array.isArray(userIds)) {
    db.prepare('DELETE FROM lot_access WHERE lot_id = ?').run(lotId);
    const now = new Date().toISOString();
    const grant = db.prepare('INSERT OR IGNORE INTO lot_access (lot_id, user_id, granted_at) VALUES (?, ?, ?)');
    for (const uid of userIds) {
      grant.run(lotId, Number(uid), now);
    }
  }

  res.json({ success: true });
});

app.delete('/api/lots/:id', (req, res) => {
  const current = getCurrentUser(req);
  if (!current || current.role !== 'admin') {
    res.status(403).json({ error: 'Only Admin can delete a data lot' });
    return;
  }
  const lotId = Number(req.params.id);
  db.prepare('DELETE FROM lots WHERE id = ?').run(lotId);
  res.json({ success: true });
});

// ==========================================
// 3. DUPLICATE CHECK & BULK IMPORT (XLSX / CSV / ODS)
// ==========================================

function normalizePhone(p: string): string {
  return String(p || '').replace(/[^0-9]/g, '');
}

app.post('/api/lots/check-duplicates', (req, res) => {
  const current = getCurrentUser(req);
  if (!current || current.role !== 'admin') {
    res.status(403).json({ error: 'Only Admin can upload leads' });
    return;
  }

  const { rows } = req.body as { rows: any[] };
  if (!Array.isArray(rows)) {
    res.status(400).json({ error: 'rows array required' });
    return;
  }
  // DoS guard: the whole leads table is scanned per request — keep it bounded.
  if (rows.length > 25000) {
    res.status(400).json({ error: 'Too many rows at once (max 25,000). Split the file and import in parts.' });
    return;
  }

  const existingLeads = db
    .prepare(
      `SELECT l.id, l.business_name, l.phone, l.email, l.lot_id, lt.name as lot_name
       FROM leads l
       LEFT JOIN lots lt ON lt.id = l.lot_id`
    )
    .all() as any[];

  const phoneMap = new Map<string, any>();
  const nameMap = new Map<string, any>();

  for (const ex of existingLeads) {
    const normP = normalizePhone(ex.phone);
    if (normP.length >= 7) {
      phoneMap.set(normP, ex);
    }
    const normName = String(ex.business_name || '').trim().toLowerCase();
    if (normName.length > 2) {
      nameMap.set(normName, ex);
    }
  }

  const duplicates: {
    rowIndex: number;
    businessName: string;
    phone: string;
    matchedBy: 'phone' | 'businessName';
    existingLotName: string;
    existingLeadId: number;
  }[] = [];

  rows.forEach((r, idx) => {
    const normP = normalizePhone(r.phone || r.whatsapp || '');
    const normN = String(r.businessName || '').trim().toLowerCase();
    if (normP.length >= 7 && phoneMap.has(normP)) {
      const match = phoneMap.get(normP);
      duplicates.push({
        rowIndex: idx,
        businessName: r.businessName,
        phone: r.phone,
        matchedBy: 'phone',
        existingLotName: match.lot_name || `Lot #${match.lot_id}`,
        existingLeadId: match.id,
      });
    } else if (normN.length > 2 && nameMap.has(normN)) {
      const match = nameMap.get(normN);
      duplicates.push({
        rowIndex: idx,
        businessName: r.businessName,
        phone: r.phone,
        matchedBy: 'businessName',
        existingLotName: match.lot_name || `Lot #${match.lot_id}`,
        existingLeadId: match.id,
      });
    }
  });

  res.json({ duplicates });
});

app.post('/api/lots/import', (req, res) => {
  const current = getCurrentUser(req);
  if (!current || current.role !== 'admin') {
    res.status(403).json({ error: 'Only Admin can import data lots' });
    return;
  }

  const {
    targetLotId,
    lotName,
    lotDescription,
    sourceFileName,
    assignedUserIds,
    leads,
    duplicateMode, // 'import_all' | 'skip_duplicates'
  } = req.body;

  if (!Array.isArray(leads) || leads.length === 0) {
    res.status(400).json({ error: 'No leads provided to import' });
    return;
  }
  // DoS guard: a single request must not hold the DB write lock for minutes.
  if (leads.length > 25000) {
    res.status(400).json({ error: 'Too many leads at once (max 25,000). Split the file and import in parts.' });
    return;
  }

  const now = new Date();
  const isoNow = now.toISOString();
  const defaultImportedAt = now.toISOString().slice(0, 16).replace('T', ' ');

  let finalLotId = Number(targetLotId || 0);

  if (!finalLotId) {
    const lotRes = db
      .prepare(
        `INSERT INTO lots (name, description, source_file_name, created_by, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        (lotName || `Imported Lot (${defaultImportedAt})`).trim(),
        (lotDescription || '').trim(),
        sourceFileName || 'spreadsheet.xlsx',
        current.id,
        isoNow
      );
    finalLotId = Number(lotRes.lastInsertRowid);
  }

  if (Array.isArray(assignedUserIds)) {
    const grant = db.prepare('INSERT OR IGNORE INTO lot_access (lot_id, user_id, granted_at) VALUES (?, ?, ?)');
    for (const uid of assignedUserIds) {
      grant.run(finalLotId, Number(uid), isoNow);
    }
  }

  // Per-lot custom columns: every heading that did not match one of the 15
  // core fields is stored against this lot, so each lot shows its own list.
  const incomingColumns = Array.isArray(req.body.columns)
    ? (req.body.columns as any[]).filter(
        (c) => c && typeof c.key === 'string' && typeof c.label === 'string'
      )
    : [];
  if (incomingColumns.length > 200) {
    res.status(400).json({ error: 'Too many custom columns (max 200 per file).' });
    return;
  }

  const columnMode = req.body.columnMode === 'replace' ? 'replace' : 'merge';
  if (columnMode === 'replace') {
    db.prepare('DELETE FROM lot_columns WHERE lot_id = ?').run(finalLotId);
  }
  const existingColumnKeys = new Set(
    (
      db.prepare('SELECT key FROM lot_columns WHERE lot_id = ?').all(finalLotId) as {
        key: string;
      }[]
    ).map((c) => c.key)
  );
  const maxPosRow = db
    .prepare('SELECT COALESCE(MAX(position), -1) as max_pos FROM lot_columns WHERE lot_id = ?')
    .get(finalLotId) as { max_pos: number };
  let nextColumnPos = Number(maxPosRow?.max_pos ?? -1) + 1;
  const insertColumn = db.prepare(
    'INSERT OR IGNORE INTO lot_columns (lot_id, key, label, position, created_at) VALUES (?, ?, ?, ?, ?)'
  );
  for (const col of incomingColumns) {
    const colKey = String(col.key).slice(0, 80);
    if (existingColumnKeys.has(colKey)) continue;
    insertColumn.run(finalLotId, colKey, String(col.label).slice(0, 120), nextColumnPos++, isoNow);
    existingColumnKeys.add(colKey);
  }

  // If skip_duplicates, build lookup set
  const existingPhones = new Set<string>();
  const existingNames = new Set<string>();
  if (duplicateMode === 'skip_duplicates') {
    const exRows = db.prepare('SELECT phone, business_name FROM leads').all() as any[];
    for (const ex of exRows) {
      const p = normalizePhone(ex.phone);
      if (p.length >= 7) existingPhones.add(p);
      const n = String(ex.business_name || '').trim().toLowerCase();
      if (n.length > 2) existingNames.add(n);
    }
  }

  const insertLead = db.prepare(`
    INSERT INTO leads (
      lot_id, business_name, phone, initial_comment, custom_message, email, website, facebook, whatsapp,
      address, city, niche, rating, reviews, status, source, imported_at,
      color_tag, handled_by_user_id, last_contacted_at, created_at, updated_at, extra_data
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)
  `);

  const insertInitialComment = db.prepare(`
    INSERT INTO lead_comments (lead_id, user_id, content, color_tag, status_snapshot, is_imported_initial, created_at)
    VALUES (?, ?, ?, 'none', 'Imported', 1, ?)
  `);

  let importedCount = 0;
  let skippedCount = 0;

  // One transaction for the whole batch: without it every INSERT commits
  // separately and a 10k-row file takes minutes instead of seconds.
  db.exec('BEGIN');
  try {
  // Slightly increment created_at so newest imported leads sort cleanly at the top
  leads.forEach((row: any, index: number) => {
    const normP = normalizePhone(row.phone || row.whatsapp || '');
    const normN = String(row.businessName || '').trim().toLowerCase();

    if (duplicateMode === 'skip_duplicates') {
      if ((normP.length >= 7 && existingPhones.has(normP)) || (normN.length > 2 && existingNames.has(normN))) {
        skippedCount++;
        return;
      }
    }

    const rowTime = new Date(now.getTime() + index * 10).toISOString();
    const initialComment = String(row.comment || row.initialComment || '').trim();
    const statusVal = String(row.status || '').trim() || 'New';
    const importedAtVal = String(row.importedAt || '').trim() || defaultImportedAt;

    const resLead = insertLead.run(
      finalLotId,
      String(row.businessName || '').trim() || 'Unnamed Business',
      String(row.phone || '').trim(),
      initialComment,
      String(row.customMessage || '').trim(),
      String(row.email || '').trim(),
      String(row.website || '').trim(),
      String(row.facebook || '').trim(),
      String(row.whatsapp || row.phone || '').trim(),
      String(row.address || '').trim(),
      String(row.city || '').trim(),
      String(row.niche || '').trim(),
      String(row.rating || '').trim(),
      String(row.reviews || '').trim(),
      statusVal,
      String(row.source || sourceFileName || 'Excel Upload').trim(),
      importedAtVal,
      String(row.colorTag || 'none'),
      rowTime,
      rowTime,
      JSON.stringify(row.extra && typeof row.extra === 'object' ? row.extra : {})
    );

    const leadId = Number(resLead.lastInsertRowid);
    if (initialComment) {
      insertInitialComment.run(leadId, current.id, initialComment, rowTime);
    }
    importedCount++;
  });
  db.exec('COMMIT');
  } catch (err: any) {
    try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
    res.status(400).json({ error: 'Import failed halfway — nothing was saved. ' + String(err?.message || err) });
    return;
  }

  res.json({
    success: true,
    lotId: finalLotId,
    importedCount,
    skippedCount,
  });
});

// ==========================================
// 4. LEADS LIST, DETAILS & APPEND-ONLY COMMENTS
// ==========================================

// ---- Shared leads-list query building (list, count, export) ----
const LEAD_SELECT = `
         l.*,
         lt.name as lot_name,
         u.name as handled_by_user_name,
         u.avatar_color as handled_by_avatar_color,
         (SELECT COUNT(*) FROM lead_comments lc WHERE lc.lead_id = l.id) as comment_count,
         (SELECT lc.content FROM lead_comments lc WHERE lc.lead_id = l.id ORDER BY lc.created_at DESC, lc.id DESC LIMIT 1) as latest_comment,
         (SELECT cu.name FROM lead_comments lc INNER JOIN users cu ON cu.id = lc.user_id WHERE lc.lead_id = l.id ORDER BY lc.created_at DESC, lc.id DESC LIMIT 1) as latest_comment_by,
         (SELECT lc.created_at FROM lead_comments lc WHERE lc.lead_id = l.id ORDER BY lc.created_at DESC, lc.id DESC LIMIT 1) as latest_comment_at,
         (SELECT r.remind_at FROM reminders r WHERE r.lead_id = l.id AND r.status = 'pending' ORDER BY r.remind_at ASC LIMIT 1) as next_reminder_at,
         (SELECT r.title FROM reminders r WHERE r.lead_id = l.id AND r.status = 'pending' ORDER BY r.remind_at ASC LIMIT 1) as next_reminder_title,
         (SELECT r.reminder_type FROM reminders r WHERE r.lead_id = l.id AND r.status = 'pending' ORDER BY r.remind_at ASC LIMIT 1) as next_reminder_type`;

function parseExtraData(raw: unknown): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function mapLeadRow(r: any) {
  return {
    id: r.id,
    lotId: r.lot_id,
    lotName: r.lot_name,
    businessName: r.business_name,
    phone: r.phone,
    initialComment: r.initial_comment,
    customMessage: r.custom_message || '',
    email: r.email,
    website: r.website,
    facebook: r.facebook,
    whatsapp: r.whatsapp,
    address: r.address,
    city: r.city,
    niche: r.niche,
    rating: r.rating,
    reviews: r.reviews,
    status: r.status,
    source: r.source,
    importedAt: r.imported_at,
    colorTag: r.color_tag,
    handledByUserId: r.handled_by_user_id,
    handledByUserName: r.handled_by_user_name,
    handledByAvatarColor: r.handled_by_avatar_color,
    lastContactedAt: r.last_contacted_at,
    lastOutreachChannel: r.last_outreach_channel || null,
    lastOutreachAt: r.last_outreach_at || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    commentCount: Number(r.comment_count || 0),
    latestComment: r.latest_comment || r.initial_comment || '',
    latestCommentBy: r.latest_comment_by || '',
    latestCommentAt: r.latest_comment_at || '',
    nextReminderAt: r.next_reminder_at || null,
    nextReminderTitle: r.next_reminder_title || null,
    nextReminderType: r.next_reminder_type || null,
    extra: parseExtraData(r.extra_data),
  };
}

function resolveLeadLotScope(
  accessibleLotIds: number[],
  req: express.Request
): { targetLotIds: number[] } | { error: string } {
  const requestedLotId = req.query.lotId ? Number(req.query.lotId) : null;
  if (requestedLotId) {
    if (!accessibleLotIds.includes(requestedLotId)) {
      return { error: 'You do not have access to this lot' };
    }
    return { targetLotIds: [requestedLotId] };
  }
  return { targetLotIds: accessibleLotIds };
}

function buildLeadsFilter(
  req: express.Request,
  targetLotIds: number[]
): { whereClause: string; filterParams: any[]; orderClause: string } {
  const q = (name: string): string => String(req.query[name] || '').trim();
  const search = q('search');
  const fStatus = q('status');
  const fColor = q('colorTag');
  const fCity = q('city');
  const fNiche = q('niche');
  const fSource = q('source');
  const fHandledBy = q('handledBy'); // 'unassigned' | user id | user name
  const fMinRating = q('minRating');
  const fHasReminder = q('hasReminder') === '1' || q('hasReminder') === 'true';
  const fNewOnly = q('newOnly') === '1' || q('newOnly') === 'true';
  const fMessaged = q('messaged');
  const sortBy = q('sort') || 'newest';

  const conditions: string[] = [`l.lot_id IN (${targetLotIds.map(() => '?').join(',')})`];
  const filterParams: any[] = [...targetLotIds];

  if (search) {
    const like = `%${search}%`;
    conditions.push(
      `(l.business_name LIKE ? OR l.phone LIKE ? OR l.whatsapp LIKE ? OR l.email LIKE ? OR l.city LIKE ? OR l.niche LIKE ? OR l.address LIKE ? OR l.source LIKE ? OR l.initial_comment LIKE ? OR l.custom_message LIKE ? OR lt.name LIKE ?)`
    );
    for (let i = 0; i < 11; i++) filterParams.push(like);
  }
  if (fStatus && fStatus !== 'ALL') {
    conditions.push(`l.status = ?`);
    filterParams.push(fStatus);
  }
  if (fColor && fColor !== 'ALL') {
    conditions.push(`l.color_tag = ?`);
    filterParams.push(fColor);
  }
  if (fCity && fCity !== 'ALL') {
    conditions.push(`l.city = ?`);
    filterParams.push(fCity);
  }
  if (fNiche && fNiche !== 'ALL') {
    conditions.push(`l.niche = ?`);
    filterParams.push(fNiche);
  }
  if (fSource && fSource !== 'ALL') {
    conditions.push(`l.source = ?`);
    filterParams.push(fSource);
  }
  if (fHandledBy && fHandledBy !== 'ALL') {
    if (fHandledBy === 'unassigned' || fHandledBy === 'Unassigned') {
      conditions.push(`l.handled_by_user_id IS NULL`);
    } else if (/^\d+$/.test(fHandledBy)) {
      conditions.push(`l.handled_by_user_id = ?`);
      filterParams.push(Number(fHandledBy));
    } else {
      conditions.push(`u.name = ?`);
      filterParams.push(fHandledBy);
    }
  }
  if (fMinRating && !Number.isNaN(Number(fMinRating))) {
    conditions.push(`CAST(NULLIF(l.rating, '') AS REAL) >= ?`);
    filterParams.push(Number(fMinRating));
  }
  if (fHasReminder) {
    conditions.push(
      `EXISTS (SELECT 1 FROM reminders r WHERE r.lead_id = l.id AND r.status = 'pending')`
    );
  }
  if (fNewOnly) {
    conditions.push(`l.status = 'New'`);
  }
  if (fMessaged === '1' || fMessaged === 'true') {
    conditions.push(`l.last_outreach_at IS NOT NULL`);
  } else if (fMessaged === '0' || fMessaged === 'false') {
    conditions.push(`l.last_outreach_at IS NULL`);
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  let orderClause = `ORDER BY l.created_at DESC, l.id DESC`;
  if (sortBy === 'rating_desc') {
    orderClause = `ORDER BY CAST(NULLIF(l.rating, '') AS REAL) DESC, l.id DESC`;
  } else if (sortBy === 'reviews_desc') {
    orderClause = `ORDER BY CAST(NULLIF(l.reviews, '') AS REAL) DESC, l.id DESC`;
  } else if (sortBy === 'reminder_asc') {
    orderClause = `ORDER BY CASE WHEN next_reminder_at IS NULL THEN 1 ELSE 0 END, next_reminder_at ASC, l.id DESC`;
  }

  return { whereClause, filterParams, orderClause };
}

function escapeCsvCell(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

app.get('/api/leads', (req, res) => {
  const current = getCurrentUser(req);
  if (!current) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const accessibleLotIds = getAccessibleLotIds(current);
  const isPaged = req.query.page !== undefined || req.query.pageSize !== undefined;
  if (accessibleLotIds.length === 0) {
    if (isPaged) {
      const ps = Math.min(500, Math.max(1, Number(req.query.pageSize) || 100));
      res.json({ data: [], total: 0, page: 1, pageSize: ps, totalPages: 1 });
    } else {
      res.json([]);
    }
    return;
  }

  const scope = resolveLeadLotScope(accessibleLotIds, req);
  if ('error' in scope) {
    res.status(403).json({ error: scope.error });
    return;
  }
  const targetLotIds = scope.targetLotIds;

  const { whereClause, filterParams, orderClause } = buildLeadsFilter(req, targetLotIds);

  // Paginated mode (used by the Leads table): ?page=1&pageSize=100
  if (req.query.page !== undefined || req.query.pageSize !== undefined) {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(500, Math.max(1, Number(req.query.pageSize) || 100));
    const offset = (page - 1) * pageSize;

    const totalRow = db
      .prepare(
        `SELECT COUNT(*) as total
         FROM leads l
         INNER JOIN lots lt ON lt.id = l.lot_id
         LEFT JOIN users u ON u.id = l.handled_by_user_id
         ${whereClause}`
      )
      .get(...filterParams) as { total: number };
    const total = Number(totalRow?.total || 0);

    const rows = db
      .prepare(
        `SELECT ${LEAD_SELECT}
         FROM leads l
         INNER JOIN lots lt ON lt.id = l.lot_id
         LEFT JOIN users u ON u.id = l.handled_by_user_id
         ${whereClause}
         ${orderClause}
         LIMIT ? OFFSET ?`
      )
      .all(...filterParams, pageSize, offset) as any[];

    res.json({
      data: rows.map(mapLeadRow),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    });
    return;
  }

  // Legacy mode: full filtered array (kept for older callers).
  const rows = db
    .prepare(
      `SELECT ${LEAD_SELECT}
       FROM leads l
       INNER JOIN lots lt ON lt.id = l.lot_id
       LEFT JOIN users u ON u.id = l.handled_by_user_id
       ${whereClause}
       ${orderClause}`
    )
    .all(...filterParams) as any[];

  res.json(rows.map(mapLeadRow));
});

// Filter dropdown options + total, scoped to the same lot access rules.
// NOTE: must stay above '/api/leads/:id' or Express would treat 'facets' as an id.
app.get('/api/leads/facets', (req, res) => {
  const current = getCurrentUser(req);
  if (!current) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const accessibleLotIds = getAccessibleLotIds(current);
  if (accessibleLotIds.length === 0) {
    res.json({ cities: [], niches: [], sources: [], handlers: [], total: 0 });
    return;
  }

  const requestedLotId = req.query.lotId ? Number(req.query.lotId) : null;
  let targetLotIds = accessibleLotIds;
  if (requestedLotId) {
    if (!accessibleLotIds.includes(requestedLotId)) {
      res.status(403).json({ error: 'You do not have access to this lot' });
      return;
    }
    targetLotIds = [requestedLotId];
  }

  const placeholders = targetLotIds.map(() => '?').join(',');
  const distinct = (col: string, limit = 500): string[] =>
    (
      db
        .prepare(
          `SELECT DISTINCT ${col} as v FROM leads WHERE lot_id IN (${placeholders}) AND ${col} IS NOT NULL AND TRIM(${col}) <> '' ORDER BY ${col} ASC LIMIT ${limit}`
        )
        .all(...targetLotIds) as { v: string }[]
    ).map((r) => r.v);

  const handlers = db
    .prepare(
      `SELECT DISTINCT u.id as id, u.name as name
       FROM leads l
       INNER JOIN users u ON u.id = l.handled_by_user_id
       WHERE l.lot_id IN (${placeholders})
       ORDER BY u.name ASC LIMIT 500`
    )
    .all(...targetLotIds) as { id: number; name: string }[];

  const totalRow = db
    .prepare(`SELECT COUNT(*) as total FROM leads WHERE lot_id IN (${placeholders})`)
    .get(...targetLotIds) as { total: number };

  const colorRows = db
    .prepare(
      `SELECT color_tag as tag, COUNT(*) as n FROM leads WHERE lot_id IN (${placeholders}) GROUP BY color_tag`
    )
    .all(...targetLotIds) as { tag: string; n: number }[];
  const colorCounts: Record<string, number> = {};
  for (const r of colorRows) colorCounts[r.tag || 'none'] = Number(r.n);

  res.json({
    cities: distinct('city'),
    niches: distinct('niche'),
    sources: distinct('source'),
    handlers,
    colorCounts,
    total: Number(totalRow?.total || 0),
  });
});

// Streaming CSV export with the SAME filters as the list endpoint.
// Rows are written in chunks so RAM stays flat even at 100k+ rows.
// NOTE: must stay above '/api/leads/:id' or Express would treat 'export' as an id.
app.get('/api/leads/export', (req, res) => {
  const current = getCurrentUser(req);
  if (!current) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const format = String(req.query.format || 'csv').toLowerCase();
  if (format !== 'csv') {
    res.status(400).json({ error: 'Only format=csv is supported for streaming export' });
    return;
  }

  const accessibleLotIds = getAccessibleLotIds(current);
  const scope = resolveLeadLotScope(accessibleLotIds, req);
  if ('error' in scope) {
    res.status(403).json({ error: scope.error });
    return;
  }
  if (scope.targetLotIds.length === 0) {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="leads_export_empty.csv"');
    res.end('﻿Business Name,Phone,Comment,Customized Message,Email,Website,Facebook,WhatsApp,Address,City,Niche,Rating,Reviews,Status,Source,Imported At,Color Tag,Data Lot,Handled By,Total Comments,Next Reminder\n');
    return;
  }

  const { whereClause, filterParams, orderClause } = buildLeadsFilter(req, scope.targetLotIds);

  // A single-lot export also carries that lot's custom spreadsheet columns.
  const customColumns =
    scope.targetLotIds.length === 1
      ? (db
          .prepare(
            'SELECT key, label FROM lot_columns WHERE lot_id = ? ORDER BY position ASC, id ASC'
          )
          .all(scope.targetLotIds[0]) as { key: string; label: string }[])
      : [];

  const totalRow = db
    .prepare(
      `SELECT COUNT(*) as total
       FROM leads l
       INNER JOIN lots lt ON lt.id = l.lot_id
       LEFT JOIN users u ON u.id = l.handled_by_user_id
       ${whereClause}`
    )
    .get(...filterParams) as { total: number };
  const total = Number(totalRow?.total || 0);

  // Sanity cap for a one-shot download (streaming keeps RAM flat regardless).
  const EXPORT_HARD_CAP = 500000;
  if (total > EXPORT_HARD_CAP) {
    res.status(400).json({ error: `Too many rows (${total}). Narrow the filters and export in parts.` });
    return;
  }

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="leads_export_${stamp}.csv"`);

  res.write(
    '﻿Business Name,Phone,Comment,Customized Message,Email,Website,Facebook,WhatsApp,Address,City,Niche,Rating,Reviews,Status,Source,Imported At,Color Tag,Data Lot,Handled By,Total Comments,Next Reminder' +
      customColumns.map((c) => `,${escapeCsvCell(c.label)}`).join('') +
      '\n'
  );

  const CHUNK = 2000;
  try {
    for (let offset = 0; offset < total; offset += CHUNK) {
      const rows = db
        .prepare(
          `SELECT ${LEAD_SELECT}
           FROM leads l
           INNER JOIN lots lt ON lt.id = l.lot_id
           LEFT JOIN users u ON u.id = l.handled_by_user_id
           ${whereClause}
           ${orderClause}
           LIMIT ? OFFSET ?`
        )
        .all(...filterParams, CHUNK, offset) as any[];
      for (const r of rows) {
        const m = mapLeadRow(r);
        res.write(
          [
            m.businessName,
            m.phone,
            m.latestComment,
            m.customMessage,
            m.email,
            m.website,
            m.facebook,
            m.whatsapp,
            m.address,
            m.city,
            m.niche,
            m.rating,
            m.reviews,
            m.status,
            m.source,
            m.importedAt,
            m.colorTag,
            m.lotName,
            m.handledByUserName || 'Unassigned',
            m.commentCount,
            m.nextReminderAt ? new Date(m.nextReminderAt).toLocaleString() : '',
            ...customColumns.map((c) => m.extra[c.key] || ''),
          ]
            .map(escapeCsvCell)
            .join(',') + '\n'
        );
      }
    }
    res.end();
  } catch (err) {
    // Headers already sent — destroy so the client sees a truncation, not a silent cut.
    res.destroy(err as Error);
  }
});

app.get('/api/leads/:id', (req, res) => {
  const current = getCurrentUser(req);
  if (!current) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const leadId = Number(req.params.id);
  const accessibleLotIds = getAccessibleLotIds(current);

  const lead = db
    .prepare(
      `SELECT l.*, lt.name as lot_name, u.name as handled_by_user_name, u.avatar_color as handled_by_avatar_color
       FROM leads l
       INNER JOIN lots lt ON lt.id = l.lot_id
       LEFT JOIN users u ON u.id = l.handled_by_user_id
       WHERE l.id = ?`
    )
    .get(leadId) as any;

  if (!lead) {
    res.status(404).json({ error: 'Lead not found' });
    return;
  }

  if (!accessibleLotIds.includes(lead.lot_id)) {
    res.status(403).json({ error: 'You do not have access to this lead lot' });
    return;
  }

  const comments = db
    .prepare(
      `SELECT lc.*, u.name as user_name, u.role as user_role, u.avatar_color as user_avatar_color
       FROM lead_comments lc
       INNER JOIN users u ON u.id = lc.user_id
       WHERE lc.lead_id = ?
       ORDER BY lc.created_at DESC, lc.id DESC`
    )
    .all(leadId) as any[];

  const reminders = db
    .prepare(
      `SELECT r.*, u.name as user_name
       FROM reminders r
       INNER JOIN users u ON u.id = r.user_id
       WHERE r.lead_id = ?
       ORDER BY r.remind_at ASC`
    )
    .all(leadId) as any[];

  const lotColumns = db
    .prepare(
      'SELECT key, label, position FROM lot_columns WHERE lot_id = ? ORDER BY position ASC, id ASC'
    )
    .all(lead.lot_id) as { key: string; label: string; position: number }[];

  res.json({
    lead: {
      id: lead.id,
      lotId: lead.lot_id,
      lotName: lead.lot_name,
      businessName: lead.business_name,
      phone: lead.phone,
      initialComment: lead.initial_comment,
      customMessage: lead.custom_message || '',
      email: lead.email,
      website: lead.website,
      facebook: lead.facebook,
      whatsapp: lead.whatsapp,
      address: lead.address,
      city: lead.city,
      niche: lead.niche,
      rating: lead.rating,
      reviews: lead.reviews,
      status: lead.status,
      source: lead.source,
      importedAt: lead.imported_at,
      colorTag: lead.color_tag,
      handledByUserId: lead.handled_by_user_id,
      handledByUserName: lead.handled_by_user_name,
      handledByAvatarColor: lead.handled_by_avatar_color,
      lastContactedAt: lead.last_contacted_at,
      createdAt: lead.created_at,
      updatedAt: lead.updated_at,
      extra: parseExtraData(lead.extra_data),
    },
    columns: lotColumns,
    comments: comments.map((c) => ({
      id: c.id,
      leadId: c.lead_id,
      userId: c.user_id,
      userName: c.user_name,
      userRole: c.user_role,
      userAvatarColor: c.user_avatar_color,
      content: c.content,
      colorTag: c.color_tag,
      statusSnapshot: c.status_snapshot,
      isImportedInitial: Boolean(c.is_imported_initial),
      createdAt: c.created_at,
    })),
    reminders: reminders.map((r) => ({
      id: r.id,
      leadId: r.lead_id,
      businessName: lead.business_name,
      leadPhone: lead.phone,
      leadWhatsapp: lead.whatsapp,
      lotId: lead.lot_id,
      lotName: lead.lot_name,
      userId: r.user_id,
      userName: r.user_name,
      title: r.title,
      note: r.note,
      remindAt: r.remind_at,
      reminderType: r.reminder_type,
      status: r.status,
      notifyAdmin: Boolean(r.notify_admin),
      notifiedInApp: Boolean(r.notified_in_app),
      notifiedExternal: Boolean(r.notified_external),
      createdAt: r.created_at,
    })),
  });
});

// Update lead fields (color, status, or any of the 15 columns)
app.put('/api/leads/:id', (req, res) => {
  const current = getCurrentUser(req);
  if (!current) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const leadId = Number(req.params.id);
  const accessibleLotIds = getAccessibleLotIds(current);
  const existing = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId) as any;

  if (!existing || !accessibleLotIds.includes(existing.lot_id)) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }

  const b = req.body;
  const now = new Date().toISOString();

  // Automatically tag handled_by_user_id when a rep updates color/status or interacts
  const handledBy =
    b.handledByUserId !== undefined ? b.handledByUserId : existing.handled_by_user_id || current.id;

  db.prepare(
    `UPDATE leads SET
       business_name = COALESCE(?, business_name),
       phone = COALESCE(?, phone),
       custom_message = COALESCE(?, custom_message),
       email = COALESCE(?, email),
       website = COALESCE(?, website),
       facebook = COALESCE(?, facebook),
       whatsapp = COALESCE(?, whatsapp),
       address = COALESCE(?, address),
       city = COALESCE(?, city),
       niche = COALESCE(?, niche),
       rating = COALESCE(?, rating),
       reviews = COALESCE(?, reviews),
       status = COALESCE(?, status),
       source = COALESCE(?, source),
       color_tag = COALESCE(?, color_tag),
       handled_by_user_id = ?,
       last_contacted_at = ?,
       updated_at = ?
     WHERE id = ?`
  ).run(
    b.businessName ?? null,
    b.phone ?? null,
    b.customMessage ?? null,
    b.email ?? null,
    b.website ?? null,
    b.facebook ?? null,
    b.whatsapp ?? null,
    b.address ?? null,
    b.city ?? null,
    b.niche ?? null,
    b.rating ?? null,
    b.reviews ?? null,
    b.status ?? null,
    b.source ?? null,
    b.colorTag ?? null,
    handledBy,
    now,
    now,
    leadId
  );

  res.json({ success: true });
});

// Record that an outreach channel (WhatsApp / Email / Phone / Messenger) was
// opened for this lead, so the table can show what has already been sent.
app.post('/api/leads/:id/outreach', (req, res) => {
  const current = getCurrentUser(req);
  if (!current) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const leadId = Number(req.params.id);
  const channel = String(req.body?.channel || '').toLowerCase();
  const allowed = ['whatsapp', 'email', 'phone', 'messenger'];
  if (!allowed.includes(channel)) {
    res.status(400).json({ error: 'Unknown channel' });
    return;
  }

  const accessibleLotIds = getAccessibleLotIds(current);
  const existing = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId) as any;
  if (!existing || !accessibleLotIds.includes(existing.lot_id)) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE leads SET last_outreach_channel = ?, last_outreach_at = ?, updated_at = ? WHERE id = ?`
  ).run(channel, now, now, leadId);

  res.json({ success: true, channel, at: now, userId: current.id });
});

// Add a NEW comment (never overwrites old comments!) + optionally update colorTag & status at the same time
app.post('/api/leads/:id/comments', (req, res) => {
  const current = getCurrentUser(req);
  if (!current) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const leadId = Number(req.params.id);
  const accessibleLotIds = getAccessibleLotIds(current);
  const existing = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId) as any;

  if (!existing || !accessibleLotIds.includes(existing.lot_id)) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }

  const { content, colorTag, status } = req.body;
  if (!content || !String(content).trim()) {
    res.status(400).json({ error: 'Comment text cannot be empty' });
    return;
  }

  const now = new Date().toISOString();
  const finalColor = colorTag || existing.color_tag || 'none';
  const finalStatus = status || existing.status || 'Contacted';

  // Insert as brand new row in lead_comments
  const insertRes = db
    .prepare(
      `INSERT INTO lead_comments (lead_id, user_id, content, color_tag, status_snapshot, is_imported_initial, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?)`
    )
    .run(leadId, current.id, String(content).trim(), finalColor, finalStatus, now);

  // Also update the lead's colorTag, status, handled_by_user_id, and last_contacted_at
  db.prepare(
    `UPDATE leads
     SET color_tag = ?,
         status = ?,
         handled_by_user_id = ?,
         last_contacted_at = ?,
         updated_at = ?
     WHERE id = ?`
  ).run(finalColor, finalStatus, current.id, now, now, leadId);

  res.json({
    id: Number(insertRes.lastInsertRowid),
    success: true,
  });
});

// ==========================================
// 5. REMINDERS (IN-APP + PHONE PUSH + GOOGLE CALENDAR + TELEGRAM/EMAIL)
// ==========================================

app.get('/api/reminders', (req, res) => {
  const current = getCurrentUser(req);
  if (!current) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  let rows: any[] = [];
  if (current.role === 'admin') {
    // Admin sees all reminders where notify_admin = 1 OR created by Admin
    rows = db
      .prepare(
        `SELECT r.*, l.business_name, l.phone as lead_phone, l.whatsapp as lead_whatsapp, l.lot_id, lt.name as lot_name, u.name as user_name
         FROM reminders r
         INNER JOIN leads l ON l.id = r.lead_id
         INNER JOIN lots lt ON lt.id = l.lot_id
         INNER JOIN users u ON u.id = r.user_id
         WHERE r.notify_admin = 1 OR r.user_id = ?
         ORDER BY r.remind_at ASC`
      )
      .all(current.id);
  } else {
    const accessibleLotIds = getAccessibleLotIds(current);
    if (accessibleLotIds.length === 0) {
      res.json([]);
      return;
    }
    const placeholders = accessibleLotIds.map(() => '?').join(',');
    rows = db
      .prepare(
        `SELECT r.*, l.business_name, l.phone as lead_phone, l.whatsapp as lead_whatsapp, l.lot_id, lt.name as lot_name, u.name as user_name
         FROM reminders r
         INNER JOIN leads l ON l.id = r.lead_id
         INNER JOIN lots lt ON lt.id = l.lot_id
         INNER JOIN users u ON u.id = r.user_id
         WHERE r.user_id = ? AND l.lot_id IN (${placeholders})
         ORDER BY r.remind_at ASC`
      )
      .all(current.id, ...accessibleLotIds);
  }

  res.json(
    rows.map((r) => ({
      id: r.id,
      leadId: r.lead_id,
      businessName: r.business_name,
      leadPhone: r.lead_phone,
      leadWhatsapp: r.lead_whatsapp,
      lotId: r.lot_id,
      lotName: r.lot_name,
      userId: r.user_id,
      userName: r.user_name,
      title: r.title,
      note: r.note,
      remindAt: r.remind_at,
      reminderType: r.reminder_type,
      status: r.status,
      notifyAdmin: Boolean(r.notify_admin),
      notifiedInApp: Boolean(r.notified_in_app),
      notifiedExternal: Boolean(r.notified_external),
      createdAt: r.created_at,
    }))
  );
});

app.post('/api/reminders', async (req, res) => {
  const current = getCurrentUser(req);
  if (!current) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { leadId, title, note, remindAt, reminderType, notifyAdmin, updateLeadStatus } = req.body;
  if (!leadId || !title || !remindAt) {
    res.status(400).json({ error: 'leadId, title, and remindAt are required' });
    return;
  }

  // A member may only schedule reminders on leads inside lots you granted them access to
  if (!canAccessLeadLot(current, Number(leadId))) {
    res.status(403).json({ error: 'Access denied to this lead lot' });
    return;
  }

  const now = new Date().toISOString();
  const insert = db
    .prepare(
      `INSERT INTO reminders (lead_id, user_id, title, note, remind_at, reminder_type, status, notify_admin, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
    )
    .run(
      Number(leadId),
      current.id,
      String(title).trim(),
      String(note || '').trim(),
      remindAt,
      reminderType || 'call',
      notifyAdmin === false ? 0 : 1,
      now
    );

  if (updateLeadStatus) {
    const newStatus = reminderType === 'meeting' ? 'Meeting Scheduled' : 'Call Back Later';
    db.prepare('UPDATE leads SET status = ?, handled_by_user_id = ?, updated_at = ? WHERE id = ?').run(
      newStatus,
      current.id,
      now,
      Number(leadId)
    );
  }

  res.json({ id: Number(insert.lastInsertRowid), success: true });
});

app.put('/api/reminders/:id', (req, res) => {
  const current = getCurrentUser(req);
  if (!current) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const reminderId = Number(req.params.id);
  const { status, remindAt, notifiedInApp } = req.body;

  const access = canAccessReminder(current, reminderId);
  if (access === 'not_found') {
    res.status(404).json({ error: 'Reminder not found' });
    return;
  }
  if (access === 'forbidden') {
    res.status(403).json({ error: 'Access denied to this reminder' });
    return;
  }

  db.prepare(
    `UPDATE reminders
     SET status = COALESCE(?, status),
         remind_at = COALESCE(?, remind_at),
         notified_in_app = COALESCE(?, notified_in_app)
     WHERE id = ?`
  ).run(
    status ?? null,
    remindAt ?? null,
    typeof notifiedInApp === 'boolean' ? (notifiedInApp ? 1 : 0) : null,
    reminderId
  );

  res.json({ success: true });
});

app.delete('/api/reminders/:id', (req, res) => {
  const current = getCurrentUser(req);
  if (!current) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const access = canAccessReminder(current, Number(req.params.id));
  if (access === 'not_found') {
    res.status(404).json({ error: 'Reminder not found' });
    return;
  }
  if (access === 'forbidden') {
    res.status(403).json({ error: 'Access denied to this reminder' });
    return;
  }

  db.prepare('DELETE FROM reminders WHERE id = ?').run(Number(req.params.id));
  res.json({ success: true });
});

// Trigger Out-of-Phone dispatch for a reminder (or test notification from Settings)
app.post('/api/notifications/dispatch', async (req, res) => {
  const current = getCurrentUser(req);
  if (!current) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const settings = getSettings();
  const { reminderId, testChannel } = req.body;

  if (testChannel) {
    // Test uses YOUR OWN sender credentials and sends to YOURSELF.
    const me = fullUserRow(current.id);
    const creds = userSenderCreds(me);
    const subject = `LeadFlow CRM Test Alert (${testChannel.toUpperCase()})`;
    const message = `This is a test reminder notification triggered by ${current.name}. Out-of-phone notifications are connected!`;
    const recipient =
      testChannel === 'telegram' ? me.telegram_chat_id || '' : current.email;

    const result = await dispatchExternalAlert({
      channel: testChannel,
      recipient,
      subject,
      message,
      creds,
    });
    res.json(result);
    return;
  }

  if (reminderId) {
    const rem = db
      .prepare(
        `SELECT r.*, l.business_name, l.phone as lead_phone, u.name as rep_name, u.email as rep_email, u.telegram_chat_id as rep_tg
         FROM reminders r
         INNER JOIN leads l ON l.id = r.lead_id
         INNER JOIN users u ON u.id = r.user_id
         WHERE r.id = ?`
      )
      .get(Number(reminderId)) as any;

    if (!rem) {
      res.status(404).json({ error: 'Reminder not found' });
      return;
    }

    // Only the owning rep (or Admin) may push a reminder off-device
    const access = canAccessReminder(current, Number(reminderId));
    if (access === 'forbidden') {
      res.status(403).json({ error: 'Access denied to this reminder' });
      return;
    }

    const subject = `Upcoming ${rem.reminder_type.toUpperCase()}: ${rem.business_name}`;
    const message = `${rem.title}\nLead: ${rem.business_name} (${rem.lead_phone})\nRep: ${rem.rep_name}\nScheduled: ${new Date(rem.remind_at).toLocaleString()}\nNote: ${rem.note || 'None'}`;

    // Sent from the reminder OWNER's own bot / email sender.
    const ownerCreds = userSenderCreds(fullUserRow(rem.user_id));
    const results: any[] = [];
    if (ownerCreds.telegramEnabled) {
      if (rem.rep_tg) {
        results.push(
          await dispatchExternalAlert({
            channel: 'telegram',
            recipient: rem.rep_tg,
            subject,
            message,
            creds: ownerCreds,
          })
        );
      }
      if (rem.notify_admin && settings.telegramAdminChatId) {
        results.push(
          await dispatchExternalAlert({
            channel: 'telegram',
            recipient: settings.telegramAdminChatId,
            subject: `[Admin Copy] ${subject}`,
            message,
            creds: ownerCreds,
          })
        );
      }
    }

    if (ownerCreds.emailEnabled) {
      if (rem.rep_email) {
        results.push(
          await dispatchExternalAlert({
            channel: 'email',
            recipient: rem.rep_email,
            subject,
            message,
            creds: ownerCreds,
          })
        );
      }
      if (rem.notify_admin && settings.emailAdminAddress) {
        results.push(
          await dispatchExternalAlert({
            channel: 'email',
            recipient: settings.emailAdminAddress,
            subject: `[Admin Copy] ${subject}`,
            message,
            creds: ownerCreds,
          })
        );
      }
    }

    db.prepare('UPDATE reminders SET notified_external = 1 WHERE id = ?').run(Number(reminderId));
    res.json({ success: true, results });
    return;
  }

  res.status(400).json({ error: 'Provide reminderId or testChannel' });
});

app.get('/api/notifications/logs', (req, res) => {
  // Logs contain lead phone numbers — admin only.
  const current = getCurrentUser(req);
  if (!current || current.role !== 'admin') {
    res.status(403).json({ error: 'Only Admin can view dispatch logs' });
    return;
  }
  const rows = db
    .prepare('SELECT * FROM outbound_dispatch_logs ORDER BY id DESC LIMIT 30')
    .all();
  res.json(rows);
});

// ==========================================
// 6. SETTINGS & ADMIN ANALYTICS
// ==========================================

// Secret keys must never reach non-admin browsers.
function sanitizeSettingsForRole(settings: IntegrationSettings, role: Role): IntegrationSettings {
  if (role === 'admin') return settings;
  return {
    ...settings,
    telegramBotToken: '',
    telegramAdminChatId: '',
    emailApiKeyOrSmtpPass: '',
    emailAdminAddress: '',
    googleClientSecret: '',
    vapidPrivateKey: '',
  };
}

app.get('/api/settings', (req, res) => {
  const current = getCurrentUser(req);
  if (!current) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  res.json(sanitizeSettingsForRole(getSettings(), current.role));
});

app.put('/api/settings', (req, res) => {
  const current = getCurrentUser(req);
  if (!current || current.role !== 'admin') {
    res.status(403).json({ error: 'Only Admin can update integration settings' });
    return;
  }

  const updated: IntegrationSettings = {
    ...getSettings(),
    ...req.body,
  };

  db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run(
    'integration_settings',
    JSON.stringify(updated)
  );

  res.json(updated);
});

app.get('/api/analytics', (req, res) => {
  const current = getCurrentUser(req);
  if (!current) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  // Per-member breakdowns are admin-only (the UI only shows this tab to admins).
  if (current.role !== 'admin') {
    res.status(403).json({ error: 'Only Admin can view analytics' });
    return;
  }

  const accessibleLotIds = getAccessibleLotIds(current);
  if (accessibleLotIds.length === 0) {
    res.json({
      totalLeads: 0,
      newLeads: 0,
      contactedLeads: 0,
      meetingsScheduled: 0,
      interestedLeads: 0,
      pendingReminders: 0,
      byStatus: [],
      byColor: [],
      byMember: [],
    });
    return;
  }

  const placeholders = accessibleLotIds.map(() => '?').join(',');

  const summary = db
    .prepare(
      `SELECT
         COUNT(*) as total_leads,
         SUM(CASE WHEN status = 'New' THEN 1 ELSE 0 END) as new_leads,
         SUM(CASE WHEN status != 'New' THEN 1 ELSE 0 END) as contacted_leads,
         SUM(CASE WHEN status = 'Meeting Scheduled' THEN 1 ELSE 0 END) as meetings_scheduled,
         SUM(CASE WHEN status IN ('Interested', 'Proposal Sent', 'Closed Won') THEN 1 ELSE 0 END) as interested_leads
       FROM leads
       WHERE lot_id IN (${placeholders})`
    )
    .get(...accessibleLotIds) as any;

  const byStatus = db
    .prepare(
      `SELECT status, COUNT(*) as count
       FROM leads
       WHERE lot_id IN (${placeholders})
       GROUP BY status
       ORDER BY count DESC`
    )
    .all(...accessibleLotIds);

  const byColor = db
    .prepare(
      `SELECT color_tag as colorTag, COUNT(*) as count
       FROM leads
       WHERE lot_id IN (${placeholders})
       GROUP BY color_tag
       ORDER BY count DESC`
    )
    .all(...accessibleLotIds);

  const byMember = db
    .prepare(
      `SELECT
         u.id,
         u.name,
         u.role,
         u.avatar_color as avatarColor,
         (SELECT COUNT(*) FROM lot_access la WHERE la.user_id = u.id) as assignedLots,
         (SELECT COUNT(*) FROM leads l WHERE l.handled_by_user_id = u.id) as leadsHandled,
         (SELECT COUNT(*) FROM lead_comments lc WHERE lc.user_id = u.id AND lc.is_imported_initial = 0) as commentsAdded,
         (SELECT COUNT(*) FROM leads l WHERE l.handled_by_user_id = u.id AND l.status IN ('Interested', 'Meeting Scheduled', 'Proposal Sent', 'Closed Won')) as hotOrMeetings,
         (SELECT COUNT(*) FROM reminders r WHERE r.user_id = u.id AND r.status = 'pending') as pendingReminders
       FROM users u
       ORDER BY leadsHandled DESC`
    )
    .all();

  res.json({
    totalLeads: Number(summary?.total_leads || 0),
    newLeads: Number(summary?.new_leads || 0),
    contactedLeads: Number(summary?.contacted_leads || 0),
    meetingsScheduled: Number(summary?.meetings_scheduled || 0),
    interestedLeads: Number(summary?.interested_leads || 0),
    byStatus,
    byColor,
    byMember,
  });
});

// One-click database backup for hosts without shell access (cPanel).
// Streams a consistent snapshot (VACUUM INTO) — safe to download while live.
app.get('/api/admin/backup', (req, res) => {
  const current = getCurrentUser(req);
  if (!current || current.role !== 'admin') {
    res.status(403).json({ error: 'Only Admin can download backups' });
    return;
  }
  const stamp = new Date().toISOString().slice(0, 10);
  const tmpFile = path.join(
    process.cwd(),
    `leadflow-backup-${stamp}-${Date.now()}.sqlite`
  );
  try {
    db.exec(`VACUUM INTO '${tmpFile.replace(/'/g, "''")}'`);
  } catch (err: any) {
    res.status(500).json({ error: 'Backup failed: ' + String(err?.message || err) });
    return;
  }
  res.download(tmpFile, `leadflow-backup-${stamp}.sqlite`, (err) => {
    fs.unlink(tmpFile, () => {});
    if (err && !res.headersSent) {
      res.status(500).json({ error: 'Download interrupted' });
    }
  });
});

// ---- Production: serve the built Vite frontend (dist/) from the same process ----
// cPanel / VPS deploy: run `npm run build`, upload the `dist` folder next to the
// server, and this one Node process serves both the UI and /api. In local dev
// this block stays dormant unless a dist/ folder exists.
const distDir = process.env.DIST_DIR || path.join(process.cwd(), 'dist');
if (fs.existsSync(path.join(distDir, 'index.html'))) {
  // index.html / manifest / SW must never cache (else deploys show stale UI);
  // hashed /assets/* files are immutable and cache for a year.
  app.use(
    express.static(distDir, {
      index: false,
      setHeaders: (res, filePath) => {
        const base = path.basename(filePath);
        if (
          base === 'index.html' ||
          base === 'manifest.json' ||
          base === 'sw.js' ||
          filePath.endsWith('.html')
        ) {
          res.setHeader('Cache-Control', 'no-cache');
        } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    })
  );
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    // Never cache the app shell — otherwise users see the old UI after a deploy.
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

// JSON error responses (a raw HTML error page would break resp.json() clients).
// biome-ignore lint/suspicious/noExplicitAny -- express error-middleware signature
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = Number(err?.status || err?.statusCode) || 400;
  res.status(status).json({ error: err?.message || 'Bad request' });
});

// PORT is what cPanel (CloudLinux/Phusion Passenger) and most PaaS hosts set;
// API_PORT keeps working for local/dev setups.
const portEnv = String(process.env.PORT || '').trim();
const parsedPort = Number(portEnv || process.env.API_PORT || 3001);
const PORT =
  Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort < 65536 ? parsedPort : 3001;

// Passenger (cPanel "Setup Node.js App") can hand over a unix socket PATH in
// PORT instead of a number. Listening on a number there makes the proxy return
// 503, so bind to whatever we were given.
if (portEnv && !/^\d+$/.test(portEnv)) {
  app.listen(portEnv, () => {
    console.log(`LeadFlow CRM listening on socket ${portEnv}`);
  });
} else {
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`LeadFlow CRM running on http://127.0.0.1:${PORT}`);
  });
}
