export type Role = 'admin' | 'member';

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
  phone: string;
  telegramChatId: string;
  avatarColor: string;
  active: boolean;
  createdAt: string;
  assignedLotIds?: number[];
}

// Extra spreadsheet columns that belong to ONE lot (headings that are not part
// of the 15 core columns). Each lot can have its own layout.
export interface LotColumn {
  key: string;
  label: string;
  position?: number;
}

export interface Lot {
  id: number;
  name: string;
  description: string;
  sourceFileName: string;
  createdBy: number;
  createdByName?: string;
  createdAt: string;
  leadCount?: number;
  newCount?: number;
  contactedCount?: number;
  convertedCount?: number;
  assignedUsers?: { id: number; name: string; email: string; avatarColor: string }[];
  columns?: LotColumn[];
}

export interface LeadComment {
  id: number;
  leadId: number;
  userId: number;
  userName: string;
  userRole: Role;
  userAvatarColor: string;
  content: string;
  colorTag?: string;
  statusSnapshot?: string;
  isImportedInitial?: boolean;
  createdAt: string;
}

export interface Lead {
  id: number;
  lotId: number;
  lotName?: string;
  // Exact 15 columns from user's spreadsheet
  businessName: string;
  phone: string;
  initialComment: string;
  // Ready-to-send outreach text that comes from the "Customized Message"
  // heading in the uploaded spreadsheet.
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
  // CRM management fields
  colorTag: string;
  handledByUserId: number | null;
  handledByUserName: string | null;
  handledByAvatarColor?: string | null;
  lastContactedAt: string | null;
  /** Last outreach channel opened from the list (whatsapp/email/phone/messenger). */
  lastOutreachChannel?: string | null;
  lastOutreachAt?: string | null;
  createdAt: string;
  updatedAt: string;
  // Joined summary fields
  commentCount?: number;
  latestComment?: string;
  latestCommentBy?: string;
  latestCommentAt?: string;
  nextReminderAt?: string | null;
  nextReminderTitle?: string | null;
  nextReminderType?: string | null;
  // Values for this lot's custom spreadsheet columns, keyed by LotColumn.key
  extra?: Record<string, string>;
}

export interface Reminder {
  id: number;
  leadId: number;
  businessName: string;
  leadPhone: string;
  leadWhatsapp: string;
  lotId: number;
  lotName: string;
  userId: number;
  userName: string;
  title: string;
  note: string;
  remindAt: string;
  reminderType: 'call' | 'meeting' | 'followup';
  status: 'pending' | 'completed' | 'snoozed';
  notifyAdmin: boolean;
  notifiedInApp: boolean;
  notifiedExternal: boolean;
  createdAt: string;
}

export interface ColorTagConfig {
  id: string;
  name: string;
  meaning: string;
  bgClass: string;
  textClass: string;
  borderClass: string;
  dotHex: string;
  rowTintHex: string;
  rowTintDarkHex: string;
}

export interface WhatsAppTemplate {
  id: string;
  name: string;
  content: string;
}

export interface IntegrationSettings {
  // Telegram Bot Settings (Left blank for user to fill in)
  telegramEnabled: boolean;
  telegramBotToken: string;
  telegramAdminChatId: string;
  // Email / SMTP / Webhook Settings (Left blank for user to fill in)
  emailEnabled: boolean;
  emailProvider: 'smtp' | 'resend' | 'sendgrid' | 'webhook';
  emailApiKeyOrSmtpPass: string;
  emailSmtpHost: string;
  emailSmtpPort: string;
  emailSmtpUser: string;
  emailFromAddress: string;
  emailAdminAddress: string;
  // Google Calendar Settings (Left blank for OAuth/API, while 1-click Calendar URL & ICS work out-of-the-box)
  googleCalendarEnabled: boolean;
  googleClientId: string;
  googleClientSecret: string;
  googleCalendarId: string;
  // PWA Web Push VAPID keys (Left blank for external push server or browser local notifications)
  webPushEnabled: boolean;
  vapidPublicKey: string;
  vapidPrivateKey: string;
  // Reminder timing preferences
  reminderLeadMinutes: number;
  playSoundOnDue: boolean;
  // Custom Color Tags & Statuses & Templates
  colorTags: ColorTagConfig[];
  statusOptions: string[];
  whatsappTemplates: WhatsAppTemplate[];
}

export const DEFAULT_COLOR_TAGS: ColorTagConfig[] = [
  {
    id: 'none',
    name: 'No Color',
    meaning: 'Untouched / Default',
    bgClass: 'bg-slate-100',
    textClass: 'text-slate-700',
    borderClass: 'border-slate-300',
    dotHex: '#94a3b8',
    rowTintHex: 'transparent',
    rowTintDarkHex: 'transparent',
  },
  {
    id: 'emerald',
    name: 'Green',
    meaning: 'Hot Lead / Interested / Meeting Booked',
    bgClass: 'bg-emerald-100',
    textClass: 'text-emerald-800',
    borderClass: 'border-emerald-300',
    dotHex: '#10b981',
    rowTintHex: '#ecfdf5',
    rowTintDarkHex: '#064e3b',
  },
  {
    id: 'amber',
    name: 'Yellow',
    meaning: 'Call Back Later / Follow-Up Needed',
    bgClass: 'bg-amber-100',
    textClass: 'text-amber-800',
    borderClass: 'border-amber-300',
    dotHex: '#f59e0b',
    rowTintHex: '#fffbeb',
    rowTintDarkHex: '#78350f',
  },
  {
    id: 'sky',
    name: 'Blue',
    meaning: 'Spoke / Sent Info on WhatsApp or Email',
    bgClass: 'bg-sky-100',
    textClass: 'text-sky-800',
    borderClass: 'border-sky-300',
    dotHex: '#0ea5e9',
    rowTintHex: '#f0f9ff',
    rowTintDarkHex: '#0c4a6e',
  },
  {
    id: 'purple',
    name: 'Purple',
    meaning: 'VIP / High Ticket Prospect',
    bgClass: 'bg-purple-100',
    textClass: 'text-purple-800',
    borderClass: 'border-purple-300',
    dotHex: '#a855f7',
    rowTintHex: '#faf5ff',
    rowTintDarkHex: '#581c87',
  },
  {
    id: 'rose',
    name: 'Red',
    meaning: 'Not Interested / Wrong Number / Do Not Call',
    bgClass: 'bg-rose-100',
    textClass: 'text-rose-800',
    borderClass: 'border-rose-300',
    dotHex: '#f43f5e',
    rowTintHex: '#fff1f2',
    rowTintDarkHex: '#881337',
  },
  {
    id: 'orange',
    name: 'Orange',
    meaning: 'No Answer / Busy / Voicemail Left',
    bgClass: 'bg-orange-100',
    textClass: 'text-orange-800',
    borderClass: 'border-orange-300',
    dotHex: '#f97316',
    rowTintHex: '#fff7ed',
    rowTintDarkHex: '#7c2d12',
  },
];

export const DEFAULT_STATUS_OPTIONS = [
  'New',
  'Contacted',
  'Call Back Later',
  'Meeting Scheduled',
  'Proposal Sent',
  'Interested',
  'Closed Won',
  'No Answer',
  'Not Interested',
];

export const DEFAULT_WHATSAPP_TEMPLATES: WhatsAppTemplate[] = [
  {
    id: 'intro',
    name: 'Initial Outreach',
    content:
      'Hi {{Business Name}} team! I came across your {{Niche}} business in {{City}} ({{Rating}}★ with {{Reviews}} reviews) and wanted to quickly connect regarding how we help local {{Niche}} businesses grow.',
  },
  {
    id: 'followup',
    name: 'After Phone Call Follow-up',
    content:
      'Hi {{Business Name}}, thank you for speaking with me earlier today! As promised, here are the details we discussed. Let me know if you have any questions.',
  },
  {
    id: 'meeting',
    name: 'Meeting Confirmation',
    content:
      'Hi {{Business Name}}, looking forward to our scheduled call/meeting! Please reply here if you need to adjust the time.',
  },
];

export const DEFAULT_INTEGRATION_SETTINGS: IntegrationSettings = {
  telegramEnabled: false,
  telegramBotToken: '',
  telegramAdminChatId: '',
  emailEnabled: false,
  emailProvider: 'smtp',
  emailApiKeyOrSmtpPass: '',
  emailSmtpHost: '',
  emailSmtpPort: '587',
  emailSmtpUser: '',
  emailFromAddress: '',
  emailAdminAddress: '',
  googleCalendarEnabled: true,
  googleClientId: '',
  googleClientSecret: '',
  googleCalendarId: '',
  webPushEnabled: true,
  vapidPublicKey: '',
  vapidPrivateKey: '',
  reminderLeadMinutes: 15,
  playSoundOnDue: true,
  colorTags: DEFAULT_COLOR_TAGS,
  statusOptions: DEFAULT_STATUS_OPTIONS,
  whatsappTemplates: DEFAULT_WHATSAPP_TEMPLATES,
};
