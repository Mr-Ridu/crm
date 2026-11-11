import crypto from 'node:crypto';

// Password hashing with scrypt (Node built-in — no extra dependency).
// Stored format: scrypt$N$r$p$saltHex$hashHex. Old plaintext rows are
// verified once and transparently re-hashed on successful login.
export function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(plain, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt}$${hash.toString('hex')}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  if (!plain || !stored) return false;
  if (!stored.startsWith('scrypt$')) return stored === plain; // legacy row
  const parts = stored.split('$');
  if (parts.length !== 6) return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  const expected = Buffer.from(parts[5], 'hex');
  const actual = crypto.scryptSync(plain, parts[4], expected.length, { N, r, p });
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export function passwordNeedsMigration(stored: string): boolean {
  return !stored.startsWith('scrypt$');
}
