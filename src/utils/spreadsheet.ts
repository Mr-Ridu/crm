import * as XLSX from 'xlsx';
import type { Lead } from '../types.ts';

export type CoreLeadField =
  | 'businessName'
  | 'phone'
  | 'comment'
  | 'customMessage'
  | 'email'
  | 'website'
  | 'facebook'
  | 'whatsapp'
  | 'address'
  | 'city'
  | 'niche'
  | 'rating'
  | 'reviews'
  | 'status'
  | 'source'
  | 'importedAt';

export interface ParsedSpreadsheetRow {
  businessName: string;
  phone: string;
  comment: string;
  customMessage: string;
  email: string;
  website: string;
  facebook: string;
  whatsapp: string;
  address: string;
  city: string;
  niche: string;
  rating: string;
  reviews: string;
  status: string;
  source: string;
  importedAt: string;
  // Any heading that did not match a core field is kept here, keyed by the
  // column key chosen at parse time. Saved per lot, so two lots can have
  // completely different spreadsheet layouts.
  extra: Record<string, string>;
}

export interface ParsedColumn {
  key: string; // core field name, or 'extra_xxx' for a lot-specific column
  label: string; // the heading exactly as it appeared in the file
  coreField: CoreLeadField | null;
}

export interface ParsedSpreadsheet {
  headers: string[];
  columns: ParsedColumn[];
  rows: ParsedSpreadsheetRow[];
}

// Column header alias matcher for the 15 core columns:
// Business Name | Phone | Comment | Email | Website | Facebook | WhatsApp | Address | City | Niche | Rating | Reviews | Status | Source | Imported At
const COLUMN_ALIASES: Record<CoreLeadField, string[]> = {
  businessName: ['business name', 'business_name', 'business', 'company', 'company name', 'name', 'title', 'store name'],
  phone: ['phone', 'phone number', 'mobile', 'tel', 'telephone', 'contact number', 'call'],
  comment: ['comment', 'comments', 'note', 'notes', 'initial comment', 'remarks', 'description'],
  email: ['email', 'email address', 'e-mail', 'mail'],
  website: ['website', 'web', 'url', 'site', 'domain', 'homepage'],
  facebook: ['facebook', 'fb', 'facebook url', 'fb link', 'facebook page'],
  whatsapp: ['whatsapp', 'wa', 'whatsapp number', 'whats app'],
  address: ['address', 'street', 'full address', 'location'],
  city: ['city', 'town', 'municipality', 'area'],
  niche: ['niche', 'category', 'industry', 'type', 'sector', 'sub-category'],
  rating: ['rating', 'stars', 'score', 'avg rating', 'google rating'],
  reviews: ['reviews', 'review count', 'total reviews', 'reviews count', 'num reviews'],
  status: ['status', 'lead status', 'stage', 'state'],
  source: ['source', 'lead source', 'platform', 'channel', 'origin'],
  importedAt: ['imported at', 'imported_at', 'date', 'created at', 'scraped at', 'timestamp'],
  // Kept last on purpose: the fuzzy pass below runs in this order, so a heading
  // like "WhatsApp Message" still resolves to WhatsApp, not to this field.
  customMessage: [
    'customized message',
    'customised message',
    'customize message',
    'custom message',
    'customized msg',
    'custom msg',
    'personalized message',
    'personalised message',
    'outreach message',
    'ready message',
  ],
};

function matchFieldKey(header: string): CoreLeadField | null {
  const norm = String(header || '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ');

  for (const [field, aliases] of Object.entries(COLUMN_ALIASES) as [CoreLeadField, string[]][]) {
    if (aliases.includes(norm)) return field;
  }
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES) as [CoreLeadField, string[]][]) {
    if (aliases.some((a) => norm.includes(a))) return field;
  }
  return null;
}

// Stable key for a custom heading: the same heading in a later upload maps to
// the same key, which is what makes "merge into an existing lot" work.
function uniqueExtraKey(label: string, used: Set<string>): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60) || 'column';
  let key = `extra_${base}`;
  let i = 2;
  while (used.has(key)) key = `extra_${base}_${i++}`;
  used.add(key);
  return key;
}

export async function parseSpreadsheetFile(file: File): Promise<ParsedSpreadsheet> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];
  if (!worksheet) return { headers: [], columns: [], rows: [] };

  // Read as a matrix (not objects) so duplicate / empty headings keep their
  // position and every column can be addressed by index.
  const matrix = XLSX.utils.sheet_to_json<any[]>(worksheet, {
    header: 1,
    defval: '',
    raw: false,
    blankrows: false,
  }) as any[][];

  if (matrix.length < 2) return { headers: [], columns: [], rows: [] };

  const headerRow = matrix[0] || [];
  const usedLabels = new Set<string>();
  const usedKeys = new Set<string>();
  const columns: ParsedColumn[] = [];
  const headers: string[] = [];

  headerRow.forEach((rawHeader, index) => {
    const raw = String(rawHeader ?? '').trim();
    const baseLabel = raw || `Column ${index + 1}`;
    headers.push(baseLabel);

    let label = baseLabel;
    let n = 2;
    while (usedLabels.has(label.toLowerCase())) label = `${baseLabel} (${n++})`;
    usedLabels.add(label.toLowerCase());

    const core = raw ? matchFieldKey(raw) : null;
    if (core && !usedKeys.has(core)) {
      usedKeys.add(core);
      columns.push({ key: core, label, coreField: core });
    } else {
      columns.push({ key: uniqueExtraKey(label, usedKeys), label, coreField: null });
    }
  });

  const nowStr = new Date().toISOString().slice(0, 16).replace('T', ' ');

  const rows: ParsedSpreadsheetRow[] = [];
  for (const rawRow of matrix.slice(1)) {
    const row: ParsedSpreadsheetRow = {
      businessName: '',
      phone: '',
      comment: '',
      customMessage: '',
      email: '',
      website: '',
      facebook: '',
      whatsapp: '',
      address: '',
      city: '',
      niche: '',
      rating: '',
      reviews: '',
      status: 'New',
      source: file.name,
      importedAt: nowStr,
      extra: {},
    };

    let hasValue = false;
    let firstCell = '';

    columns.forEach((col, index) => {
      const value = String(rawRow?.[index] ?? '').trim();
      if (!value) return;
      hasValue = true;
      if (!firstCell) firstCell = value;

      if (col.coreField) {
        // First column wins if the sheet repeats a heading.
        if (!row[col.coreField]) row[col.coreField] = value;
      } else {
        row.extra[col.key] = value;
      }
    });

    if (!hasValue) continue;

    // No Business Name column at all (a completely different layout):
    // use the first filled cell as the lead's display name.
    if (!row.businessName) row.businessName = firstCell;
    if (!row.whatsapp && row.phone) row.whatsapp = row.phone;

    rows.push(row);
  }

  return { headers, columns, rows };
}

// Generate and download a sample .xlsx template with the exact 15 columns so Admin can test upload immediately
export function downloadSampleXlsxTemplate() {
  const sampleData = [
    {
      'Business Name': 'Manhattan Elite Dental Group',
      Phone: '+1 212-555-0191',
      Comment: 'High implant volume, receptionist said call Dr. Evans after 2 PM.',
      Email: 'office@manhattanelitedental.com',
      Website: 'https://manhattanelitedental.com',
      Facebook: 'https://facebook.com/manhattanelitedental',
      WhatsApp: '+12125550191',
      Address: '350 5th Ave Suite 4100',
      City: 'New York',
      Niche: 'Dental Clinic',
      Rating: '4.9',
      Reviews: '612',
      Status: 'New',
      Source: 'Google Maps New York',
      'Imported At': new Date().toISOString().slice(0, 16).replace('T', ' '),
    },
    {
      'Business Name': 'SoHo Modern Dermatology & Laser',
      Phone: '+1 212-555-0145',
      Comment: 'Looking for Google Ads & landing page redesign.',
      Email: 'hello@sohoderm.com',
      Website: 'https://sohoderm.com',
      Facebook: 'https://facebook.com/sohoderm',
      WhatsApp: '+12125550145',
      Address: '480 Broome St',
      City: 'New York',
      Niche: 'MedSpa & Dermatology',
      Rating: '4.8',
      Reviews: '284',
      Status: 'New',
      Source: 'Google Maps New York',
      'Imported At': new Date().toISOString().slice(0, 16).replace('T', ' '),
    },
    {
      'Business Name': 'Brooklyn Heights Smile Craft',
      Phone: '+1 718-555-0177',
      Comment: 'No online appointment booking link on Facebook page.',
      Email: 'care@bhsmilecraft.com',
      Website: 'https://bhsmilecraft.com',
      Facebook: 'https://facebook.com/bhsmilecraft',
      WhatsApp: '+17185550177',
      Address: '145 Montague St',
      City: 'Brooklyn',
      Niche: 'Cosmetic Dentist',
      Rating: '4.7',
      Reviews: '195',
      Status: 'New',
      Source: 'Google Maps New York',
      'Imported At': new Date().toISOString().slice(0, 16).replace('T', ' '),
    },
    {
      'Business Name': 'Tribeca Luxury MedSpa & Wellness',
      Phone: '+1 646-555-0133',
      Comment: 'Running seasonal Hydrafacial & Botox promo.',
      Email: 'vip@tribecamedspa.com',
      Website: 'https://tribecamedspa.com',
      Facebook: 'https://facebook.com/tribecamedspa',
      WhatsApp: '+16465550133',
      Address: '88 Franklin St',
      City: 'New York',
      Niche: 'MedSpa',
      Rating: '5.0',
      Reviews: '410',
      Status: 'New',
      Source: 'Google Maps New York',
      'Imported At': new Date().toISOString().slice(0, 16).replace('T', ' '),
    },
  ];

  const ws = XLSX.utils.json_to_sheet(sampleData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Leads');
  XLSX.writeFile(wb, 'sample_leads_15_columns.xlsx');
}

// Export current filtered leads back to .xlsx or .csv with all 15 columns + CRM status/color/latest comment
export function exportLeadsToSpreadsheet(leads: Lead[], format: 'xlsx' | 'csv', filenamePrefix = 'leads_export') {
  const rows = leads.map((l) => ({
    'Business Name': l.businessName,
    Phone: l.phone,
    Comment: l.latestComment || l.initialComment || '',
    'Customized Message': l.customMessage || '',
    Email: l.email,
    Website: l.website,
    Facebook: l.facebook,
    WhatsApp: l.whatsapp,
    Address: l.address,
    City: l.city,
    Niche: l.niche,
    Rating: l.rating,
    Reviews: l.reviews,
    Status: l.status,
    Source: l.source,
    'Imported At': l.importedAt,
    'Color Tag': l.colorTag,
    'Data Lot': l.lotName || '',
    'Handled By': l.handledByUserName || 'Unassigned',
    'Total Comments': l.commentCount || 0,
    'Next Reminder': l.nextReminderAt ? new Date(l.nextReminderAt).toLocaleString() : '',
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Leads');
  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `${filenamePrefix}_${stamp}.${format}`, {
    bookType: format === 'csv' ? 'csv' : 'xlsx',
  });
}
