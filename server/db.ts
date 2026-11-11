import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { DEFAULT_INTEGRATION_SETTINGS } from '../src/types.ts';
import { hashPassword } from './password.ts';

const dataDir = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'leadflow.sqlite');
export const db = new DatabaseSync(dbPath);

// Enable WAL and foreign keys
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
`);

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      phone TEXT NOT NULL DEFAULT '',
      telegram_chat_id TEXT NOT NULL DEFAULT '',
      avatar_color TEXT NOT NULL DEFAULT '#4f46e5',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS lots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      source_file_name TEXT NOT NULL DEFAULT '',
      created_by INTEGER,
      created_at TEXT NOT NULL,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS lot_access (
      lot_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      granted_at TEXT NOT NULL,
      PRIMARY KEY (lot_id, user_id),
      FOREIGN KEY (lot_id) REFERENCES lots(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lot_id INTEGER NOT NULL,
      business_name TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      initial_comment TEXT NOT NULL DEFAULT '',
      custom_message TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      website TEXT NOT NULL DEFAULT '',
      facebook TEXT NOT NULL DEFAULT '',
      whatsapp TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      niche TEXT NOT NULL DEFAULT '',
      rating TEXT NOT NULL DEFAULT '',
      reviews TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'New',
      source TEXT NOT NULL DEFAULT '',
      imported_at TEXT NOT NULL DEFAULT '',
      color_tag TEXT NOT NULL DEFAULT 'none',
      handled_by_user_id INTEGER,
      last_contacted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (lot_id) REFERENCES lots(id) ON DELETE CASCADE,
      FOREIGN KEY (handled_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_leads_lot_id ON leads(lot_id);
    CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);
    CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
    CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_leads_city ON leads(city);
    CREATE INDEX IF NOT EXISTS idx_leads_niche ON leads(niche);
    CREATE INDEX IF NOT EXISTS idx_leads_source ON leads(source);
    CREATE INDEX IF NOT EXISTS idx_leads_color_tag ON leads(color_tag);
    CREATE INDEX IF NOT EXISTS idx_leads_handled_by ON leads(handled_by_user_id);
    CREATE INDEX IF NOT EXISTS idx_leads_business_name ON leads(business_name);

    -- Extra spreadsheet columns for this lot (headings outside the 15 core
    -- columns). Each lot keeps its own layout, independent of other lots.
    CREATE TABLE IF NOT EXISTS lot_columns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lot_id INTEGER NOT NULL,
      key TEXT NOT NULL,
      label TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      UNIQUE (lot_id, key),
      FOREIGN KEY (lot_id) REFERENCES lots(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_lot_columns_lot_id ON lot_columns(lot_id);

    CREATE TABLE IF NOT EXISTS lead_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      color_tag TEXT NOT NULL DEFAULT '',
      status_snapshot TEXT NOT NULL DEFAULT '',
      is_imported_initial INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_lead_comments_lead_id ON lead_comments(lead_id);

    CREATE TABLE IF NOT EXISTS reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      remind_at TEXT NOT NULL,
      reminder_type TEXT NOT NULL DEFAULT 'call',
      status TEXT NOT NULL DEFAULT 'pending',
      notify_admin INTEGER NOT NULL DEFAULT 1,
      notified_in_app INTEGER NOT NULL DEFAULT 0,
      notified_external INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_reminders_remind_at ON reminders(remind_at);
    CREATE INDEX IF NOT EXISTS idx_reminders_user_id ON reminders(user_id);
    CREATE INDEX IF NOT EXISTS idx_reminders_lead_id ON reminders(lead_id);

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS outbound_dispatch_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel TEXT NOT NULL,
      recipient TEXT NOT NULL,
      subject TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL,
      error_detail TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
  `);

  // Older databases were created with lots.created_by ON DELETE CASCADE
  // (deleting a user wiped their lots). Rebuild once with SET NULL instead.
  try {
    const fkRows = db.prepare(`PRAGMA foreign_key_list('lots')`).all() as any[];
    const createdByFk = fkRows.find((r) => r.from === 'created_by');
    if (createdByFk && String(createdByFk.on_delete).toUpperCase() === 'CASCADE') {
      db.exec('PRAGMA foreign_keys = OFF');
      try {
        db.exec(`
          CREATE TABLE lots_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            source_file_name TEXT NOT NULL DEFAULT '',
            created_by INTEGER,
            created_at TEXT NOT NULL,
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
          );
          INSERT INTO lots_new (id, name, description, source_file_name, created_by, created_at)
            SELECT id, name, description, source_file_name, created_by, created_at FROM lots;
          DROP TABLE lots;
          ALTER TABLE lots_new RENAME TO lots;
        `);
      } finally {
        db.exec('PRAGMA foreign_keys = ON');
      }
    }
  } catch {
    // If the check/rebuild fails, leave the schema untouched.
  }

  // Per-user notification credentials (Telegram bot + Email sender live on the
  // user row — no shared credentials. Added via migration for old databases.)
  try {
    const cols = db.prepare(`PRAGMA table_info('users')`).all() as any[];
    const names = new Set(cols.map((c) => c.name));
    const wanted: [string, string][] = [
      ['nt_tg_enabled', 'INTEGER NOT NULL DEFAULT 0'],
      ['nt_tg_bot_token', "TEXT NOT NULL DEFAULT ''"],
      ['nt_email_enabled', 'INTEGER NOT NULL DEFAULT 0'],
      ['nt_email_provider', "TEXT NOT NULL DEFAULT 'resend'"],
      ['nt_email_api_key', "TEXT NOT NULL DEFAULT ''"],
      ['nt_email_smtp_host', "TEXT NOT NULL DEFAULT ''"],
      ['nt_email_from', "TEXT NOT NULL DEFAULT ''"],
    ];
    for (const [col, def] of wanted) {
      if (!names.has(col)) db.exec(`ALTER TABLE users ADD COLUMN ${col} ${def}`);
    }
  } catch {
    // If the migration fails, profile endpoints will report it.
  }

  // Custom (non-core) spreadsheet values live in a JSON column so each lot can
  // carry its own extra columns without changing this schema.
  try {
    const leadCols = db.prepare(`PRAGMA table_info('leads')`).all() as any[];
    if (!leadCols.some((c) => c.name === 'extra_data')) {
      db.exec(`ALTER TABLE leads ADD COLUMN extra_data TEXT NOT NULL DEFAULT '{}'`);
    }
    // "Customized Message" column from newer spreadsheets, promoted to a real
    // lead field so it can be clicked and sent from the list.
    if (!leadCols.some((c) => c.name === 'custom_message')) {
      db.exec(`ALTER TABLE leads ADD COLUMN custom_message TEXT NOT NULL DEFAULT ''`);
    }
    // Which channel (whatsapp / email / phone / messenger) was last opened for
    // this lead, so the list can show who has already been contacted.
    if (!leadCols.some((c) => c.name === 'last_outreach_channel')) {
      db.exec(`ALTER TABLE leads ADD COLUMN last_outreach_channel TEXT NOT NULL DEFAULT ''`);
    }
    if (!leadCols.some((c) => c.name === 'last_outreach_at')) {
      db.exec(`ALTER TABLE leads ADD COLUMN last_outreach_at TEXT`);
    }
  } catch {
    // If the migration fails, imports fall back to core columns only.
  }

  // Check if settings exist
  const existingSettings = db
    .prepare('SELECT value FROM app_settings WHERE key = ?')
    .get('integration_settings') as { value: string } | undefined;

  if (!existingSettings) {
    db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)').run(
      'integration_settings',
      JSON.stringify(DEFAULT_INTEGRATION_SETTINGS)
    );
  }

  // Seed initial users, lots, leads, comments & reminders if empty
  const userCount = (db.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number }).cnt;
  if (userCount === 0) {
    seedInitialData();
  }
}

function seedInitialData() {
  const now = new Date();
  const isoNow = now.toISOString();

  // 1. Create Admin + 3 Team Members
  const insertUser = db.prepare(`
    INSERT INTO users (name, email, password, role, phone, telegram_chat_id, avatar_color, active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
  `);

  // First-boot admin: override via env on hosts without shell access
  // (cPanel): SEED_ADMIN_EMAIL + SEED_ADMIN_PASSWORD (min 8 chars).
  const seedAdminEmail =
    process.env.SEED_ADMIN_EMAIL && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(process.env.SEED_ADMIN_EMAIL)
      ? process.env.SEED_ADMIN_EMAIL
      : 'admin@leadflow.io';
  const seedAdminPass =
    process.env.SEED_ADMIN_PASSWORD && process.env.SEED_ADMIN_PASSWORD.length >= 8
      ? process.env.SEED_ADMIN_PASSWORD
      : 'admin123';
  if (!process.env.SEED_ADMIN_PASSWORD) {
    console.warn(
      '[LeadFlow] SECURITY: fresh database seeded with default admin admin@leadflow.io / admin123 — ' +
        'log in and change it immediately, or set SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD before first boot.'
    );
  }
  const adminRes = insertUser.run(
    'Admin (Owner)',
    seedAdminEmail,
    hashPassword(seedAdminPass),
    'admin',
    '+1 (555) 010-0001',
    '',
    '#4f46e5',
    isoNow
  );
  const sarahRes = insertUser.run(
    'Sarah Jenkins',
    'sarah@leadflow.io',
    hashPassword('member123'),
    'member',
    '+1 (555) 010-0002',
    '',
    '#059669',
    isoNow
  );
  const rahulRes = insertUser.run(
    'Rahul Verma',
    'rahul@leadflow.io',
    hashPassword('member123'),
    'member',
    '+1 (555) 010-0003',
    '',
    '#d97706',
    isoNow
  );
  const elenaRes = insertUser.run(
    'Elena Rostova',
    'elena@leadflow.io',
    hashPassword('member123'),
    'member',
    '+1 (555) 010-0004',
    '',
    '#db2777',
    isoNow
  );

  const adminId = Number(adminRes.lastInsertRowid);
  const sarahId = Number(sarahRes.lastInsertRowid);
  const rahulId = Number(rahulRes.lastInsertRowid);
  const elenaId = Number(elenaRes.lastInsertRowid);

  // 2. Create 3 Data Lots with distinct access rules:
  // Lot 1: Shared with Sarah only
  // Lot 2: Shared with Rahul only
  // Lot 3: Shared with BOTH Sarah and Elena (and Rahul cannot see it!)
  const insertLot = db.prepare(`
    INSERT INTO lots (name, description, source_file_name, created_by, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const lot1Id = Number(
    insertLot.run(
      'Lot #101 — Texas Dental & Orthodontics',
      'High-rated dental clinics scraped from Austin, Dallas & Houston',
      'texas_dental_leads_oct.xlsx',
      adminId,
      new Date(now.getTime() - 3 * 86400000).toISOString()
    ).lastInsertRowid
  );

  const lot2Id = Number(
    insertLot.run(
      'Lot #102 — Florida HVAC & Plumbing Pros',
      'Commercial & residential HVAC contractors in Miami & Tampa',
      'florida_hvac_2026.xlsx',
      adminId,
      new Date(now.getTime() - 2 * 86400000).toISOString()
    ).lastInsertRowid
  );

  const lot3Id = Number(
    insertLot.run(
      'Lot #103 — California MedSpas & Aesthetics (Shared)',
      'Premium MedSpas in Los Angeles & San Diego — Assigned to Sarah & Elena',
      'ca_medspas_vip.csv',
      adminId,
      new Date(now.getTime() - 1 * 86400000).toISOString()
    ).lastInsertRowid
  );

  const insertAccess = db.prepare(`
    INSERT INTO lot_access (lot_id, user_id, granted_at) VALUES (?, ?, ?)
  `);
  // Lot 1 -> Sarah
  insertAccess.run(lot1Id, sarahId, isoNow);
  // Lot 2 -> Rahul
  insertAccess.run(lot2Id, rahulId, isoNow);
  // Lot 3 -> Sarah & Elena (Shared lot!)
  insertAccess.run(lot3Id, sarahId, isoNow);
  insertAccess.run(lot3Id, elenaId, isoNow);

  const insertLead = db.prepare(`
    INSERT INTO leads (
      lot_id, business_name, phone, initial_comment, email, website, facebook, whatsapp,
      address, city, niche, rating, reviews, status, source, imported_at,
      color_tag, handled_by_user_id, last_contacted_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertComment = db.prepare(`
    INSERT INTO lead_comments (lead_id, user_id, content, color_tag, status_snapshot, is_imported_initial, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertReminder = db.prepare(`
    INSERT INTO reminders (lead_id, user_id, title, note, remind_at, reminder_type, status, notify_admin, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', 1, ?)
  `);

  const seedLeads = [
    // Lot 1 (Texas Dental - Sarah)
    {
      lotId: lot1Id,
      businessName: 'Austin Bright Smile Dental Studio',
      phone: '+1 512-555-0194',
      initialComment: 'Has outdated booking widget on website; receptionist mentioned Dr. Carter checks emails at noon.',
      email: 'frontdesk@austinbrightsmile.com',
      website: 'https://austinbrightsmile.com',
      facebook: 'https://facebook.com/austinbrightsmile',
      whatsapp: '+15125550194',
      address: '402 Congress Ave Suite 200',
      city: 'Austin',
      niche: 'Dental Clinic',
      rating: '4.9',
      reviews: '342',
      status: 'Meeting Scheduled',
      source: 'Google Maps Scraper',
      importedAt: '2026-10-16 09:30',
      colorTag: 'emerald',
      handledByUserId: sarahId,
      lastContactedAt: new Date(now.getTime() - 3600000 * 3).toISOString(),
      createdOffsetMins: -180,
      extraComments: [
        {
          userId: sarahId,
          content: 'Called & spoke with Dr. Carter directly. Very interested in our patient reactivation campaign!',
          colorTag: 'sky',
          statusSnapshot: 'Contacted',
          minsAgo: 150,
        },
        {
          userId: sarahId,
          content: 'Confirmed 15-min Zoom demo. Sent calendar invite and WhatsApp brochure.',
          colorTag: 'emerald',
          statusSnapshot: 'Meeting Scheduled',
          minsAgo: 45,
        },
      ],
      reminder: {
        userId: sarahId,
        title: 'Zoom Demo with Dr. Carter (Austin Bright Smile)',
        note: 'Walk through the dental implant lead funnel & pricing tiers.',
        remindOffsetMins: 10, // Due in 10 minutes!
        type: 'meeting',
      },
    },
    {
      lotId: lot1Id,
      businessName: 'Lone Star Family Orthodontics',
      phone: '+1 214-555-0148',
      initialComment: 'Running Facebook ads currently but no pixel installed.',
      email: 'info@lonestarortho.com',
      website: 'https://lonestarortho.com',
      facebook: 'https://facebook.com/lonestarortho',
      whatsapp: '+12145550148',
      address: '2911 McKinney Ave',
      city: 'Dallas',
      niche: 'Orthodontist',
      rating: '4.7',
      reviews: '189',
      status: 'Call Back Later',
      source: 'Google Maps Scraper',
      importedAt: '2026-10-16 09:30',
      colorTag: 'amber',
      handledByUserId: sarahId,
      lastContactedAt: new Date(now.getTime() - 3600000 * 5).toISOString(),
      createdOffsetMins: -120,
      extraComments: [
        {
          userId: sarahId,
          content: 'Practice manager Lisa asked us to call back after lunch when the owner is free.',
          colorTag: 'amber',
          statusSnapshot: 'Call Back Later',
          minsAgo: 90,
        },
      ],
      reminder: {
        userId: sarahId,
        title: 'Call Back Practice Manager Lisa',
        note: 'Ask about Invisalign seasonal promotion budget.',
        remindOffsetMins: -5, // Slightly overdue so user sees live reminder alert right away!
        type: 'call',
      },
    },
    {
      lotId: lot1Id,
      businessName: 'Bayou City Cosmetic Dentistry',
      phone: '+1 713-555-0182',
      initialComment: 'Newly opened 2nd location in Houston Heights.',
      email: 'hello@bayoucitydental.com',
      website: 'https://bayoucitydental.com',
      facebook: 'https://facebook.com/bayoucitydental',
      whatsapp: '+17135550182',
      address: '1800 Heights Blvd',
      city: 'Houston',
      niche: 'Cosmetic Dentist',
      rating: '5.0',
      reviews: '64',
      status: 'New',
      source: 'Google Maps Scraper',
      importedAt: '2026-10-19 08:15',
      colorTag: 'none',
      handledByUserId: null,
      lastContactedAt: null,
      createdOffsetMins: -15, // Very fresh lead -> appears near top!
      extraComments: [],
    },
    {
      lotId: lot1Id,
      businessName: 'Alamo Heights Pediatric Dental',
      phone: '+1 210-555-0166',
      initialComment: 'High review volume, strong local reputation.',
      email: 'care@alamopediatricdental.com',
      website: 'https://alamopediatricdental.com',
      facebook: 'https://facebook.com/alamopediatricdental',
      whatsapp: '+12105550166',
      address: '5100 Broadway',
      city: 'San Antonio',
      niche: 'Pediatric Dentist',
      rating: '4.8',
      reviews: '410',
      status: 'Not Interested',
      source: 'Yelp Export',
      importedAt: '2026-10-16 09:30',
      colorTag: 'rose',
      handledByUserId: sarahId,
      lastContactedAt: new Date(now.getTime() - 3600000 * 12).toISOString(),
      createdOffsetMins: -300,
      extraComments: [
        {
          userId: sarahId,
          content: 'Owner has an in-house marketing nephew under a 12-month contract. Marked red.',
          colorTag: 'rose',
          statusSnapshot: 'Not Interested',
          minsAgo: 280,
        },
      ],
    },

    // Lot 2 (Florida HVAC - Rahul)
    {
      lotId: lot2Id,
      businessName: 'Biscayne Cool Air & Heating',
      phone: '+1 305-555-0129',
      initialComment: '24/7 emergency AC repair in Miami; slow mobile site speed.',
      email: 'dispatch@biscaynecoolair.com',
      website: 'https://biscaynecoolair.com',
      facebook: 'https://facebook.com/biscaynecoolair',
      whatsapp: '+13055550129',
      address: '7400 Biscayne Blvd',
      city: 'Miami',
      niche: 'HVAC Contractor',
      rating: '4.6',
      reviews: '275',
      status: 'Interested',
      source: 'Google Maps Scraper',
      importedAt: '2026-10-17 14:00',
      colorTag: 'emerald',
      handledByUserId: rahulId,
      lastContactedAt: new Date(now.getTime() - 3600000 * 2).toISOString(),
      createdOffsetMins: -90,
      extraComments: [
        {
          userId: rahulId,
          content: 'Spoke with Carlos (owner). Wants 30+ AC replacement leads per month.',
          colorTag: 'emerald',
          statusSnapshot: 'Interested',
          minsAgo: 70,
        },
      ],
      reminder: {
        userId: rahulId,
        title: 'Closing Call with Carlos — Biscayne Cool Air',
        note: 'Review monthly retainer proposal on phone.',
        remindOffsetMins: 35,
        type: 'call',
      },
    },
    {
      lotId: lot2Id,
      businessName: 'Sunshine State Plumbing & Drain',
      phone: '+1 813-555-0173',
      initialComment: 'Looking for commercial maintenance contracts in Tampa Bay.',
      email: 'service@sunshineplumbingfl.com',
      website: 'https://sunshineplumbingfl.com',
      facebook: 'https://facebook.com/sunshineplumbingfl',
      whatsapp: '+18135550173',
      address: '1205 N Dale Mabry Hwy',
      city: 'Tampa',
      niche: 'Plumbing',
      rating: '4.9',
      reviews: '518',
      status: 'New',
      source: 'Apollo Export',
      importedAt: '2026-10-19 09:00',
      colorTag: 'none',
      handledByUserId: null,
      lastContactedAt: null,
      createdOffsetMins: -8, // Brand new lead!
      extraComments: [],
    },
    {
      lotId: lot2Id,
      businessName: 'Everglades Climate Control',
      phone: '+1 954-555-0115',
      initialComment: 'No WhatsApp button on landing page.',
      email: 'office@evergladesclimate.com',
      website: 'https://evergladesclimate.com',
      facebook: 'https://facebook.com/evergladesclimate',
      whatsapp: '+19545550115',
      address: '450 E Las Olas Blvd',
      city: 'Fort Lauderdale',
      niche: 'HVAC Contractor',
      rating: '4.5',
      reviews: '132',
      status: 'No Answer',
      source: 'Google Maps Scraper',
      importedAt: '2026-10-17 14:00',
      colorTag: 'orange',
      handledByUserId: rahulId,
      lastContactedAt: new Date(now.getTime() - 3600000 * 6).toISOString(),
      createdOffsetMins: -240,
      extraComments: [
        {
          userId: rahulId,
          content: 'Left voicemail and sent introductory WhatsApp message.',
          colorTag: 'orange',
          statusSnapshot: 'No Answer',
          minsAgo: 200,
        },
      ],
    },

    // Lot 3 (California MedSpas - Shared with Sarah & Elena)
    {
      lotId: lot3Id,
      businessName: 'Beverly Hills Glow & Aesthetics',
      phone: '+1 310-555-0199',
      initialComment: 'High-ticket Morpheus8 & laser packages; active Instagram & FB.',
      email: 'concierge@bhglowmedspa.com',
      website: 'https://bhglowmedspa.com',
      facebook: 'https://facebook.com/bhglowmedspa',
      whatsapp: '+13105550199',
      address: '9400 Brighton Way',
      city: 'Beverly Hills',
      niche: 'MedSpa',
      rating: '4.9',
      reviews: '490',
      status: 'Proposal Sent',
      source: 'Instagram & Maps Lead List',
      importedAt: '2026-10-18 11:00',
      colorTag: 'purple',
      handledByUserId: elenaId,
      lastContactedAt: new Date(now.getTime() - 3600000 * 1).toISOString(),
      createdOffsetMins: -60,
      extraComments: [
        {
          userId: elenaId,
          content: 'Spoke with Clinic Director Nadia. She wants a custom VIP funnel for body contouring.',
          colorTag: 'sky',
          statusSnapshot: 'Contacted',
          minsAgo: 120,
        },
        {
          userId: adminId,
          content: 'Approved 10% quarterly discount if they sign before Friday. Go close it Elena!',
          colorTag: 'purple',
          statusSnapshot: 'Proposal Sent',
          minsAgo: 40,
        },
      ],
      reminder: {
        userId: elenaId,
        title: 'Follow up with Nadia on VIP Proposal',
        note: 'Mention the 10% quarterly discount approved by Admin.',
        remindOffsetMins: 25,
        type: 'meeting',
      },
    },
    {
      lotId: lot3Id,
      businessName: 'La Jolla Coastal Skin & Laser',
      phone: '+1 858-555-0144',
      initialComment: 'Looking to fill weekday morning appointments.',
      email: 'booking@lajollacoastalskin.com',
      website: 'https://lajollacoastalskin.com',
      facebook: 'https://facebook.com/lajollacoastalskin',
      whatsapp: '+18585550144',
      address: '7855 Girard Ave',
      city: 'San Diego',
      niche: 'MedSpa',
      rating: '4.8',
      reviews: '215',
      status: 'New',
      source: 'Instagram & Maps Lead List',
      importedAt: '2026-10-19 09:45',
      colorTag: 'none',
      handledByUserId: null,
      lastContactedAt: null,
      createdOffsetMins: -2, // Newest lead of all -> #1 in list!
      extraComments: [],
    },
    {
      lotId: lot3Id,
      businessName: 'Santa Monica Radiance MedSpa',
      phone: '+1 310-555-0161',
      initialComment: 'Great reviews, website chat widget is broken.',
      email: 'info@smradiancemedspa.com',
      website: 'https://smradiancemedspa.com',
      facebook: 'https://facebook.com/smradiancemedspa',
      whatsapp: '+13105550161',
      address: '1420 Montana Ave',
      city: 'Santa Monica',
      niche: 'MedSpa',
      rating: '4.7',
      reviews: '178',
      status: 'Contacted',
      source: 'Instagram & Maps Lead List',
      importedAt: '2026-10-18 11:00',
      colorTag: 'sky',
      handledByUserId: sarahId,
      lastContactedAt: new Date(now.getTime() - 3600000 * 4).toISOString(),
      createdOffsetMins: -50,
      extraComments: [
        {
          userId: sarahId,
          content: 'Sent Loom video showing their broken chat widget on mobile. Front desk forwarded it to owner.',
          colorTag: 'sky',
          statusSnapshot: 'Contacted',
          minsAgo: 85,
        },
      ],
    },
  ];

  for (const item of seedLeads) {
    const createdAt = new Date(now.getTime() + item.createdOffsetMins * 60000).toISOString();
    const res = insertLead.run(
      item.lotId,
      item.businessName,
      item.phone,
      item.initialComment,
      item.email,
      item.website,
      item.facebook,
      item.whatsapp,
      item.address,
      item.city,
      item.niche,
      item.rating,
      item.reviews,
      item.status,
      item.source,
      item.importedAt,
      item.colorTag,
      item.handledByUserId,
      item.lastContactedAt,
      createdAt,
      createdAt
    );

    const leadId = Number(res.lastInsertRowid);

    // Always store the initial spreadsheet Comment as the first entry in lead_comments so it is never lost
    if (item.initialComment) {
      insertComment.run(
        leadId,
        adminId,
        item.initialComment,
        'none',
        'Imported',
        1,
        createdAt
      );
    }

    for (const c of item.extraComments) {
      const commentTime = new Date(now.getTime() - c.minsAgo * 60000).toISOString();
      insertComment.run(
        leadId,
        c.userId,
        c.content,
        c.colorTag,
        c.statusSnapshot,
        0,
        commentTime
      );
    }

    if (item.reminder) {
      const remindAt = new Date(now.getTime() + item.reminder.remindOffsetMins * 60000).toISOString();
      insertReminder.run(
        leadId,
        item.reminder.userId,
        item.reminder.title,
        item.reminder.note,
        remindAt,
        item.reminder.type,
        isoNow
      );
    }
  }
}
