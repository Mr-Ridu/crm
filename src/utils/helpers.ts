import type { Lead, Reminder } from '../types.ts';

// Clean phone number for tel: or wa.me/ links
// Cells often hold anything but a bare number: "Not Found", a wa.me link, or a
// local number with a leading 0. wa.me only understands an international number
// (country code, no +, no 0), otherwise the chat opens with no recipient and the
// message box stays empty — so normalise before building the link.
const NOT_A_NUMBER = /^(not\s*found|n\/?a|none|null|-+|—+)$/i;

export function cleanPhoneForWhatsApp(phone: string): string {
  let raw = String(phone || '').trim();
  if (!raw || NOT_A_NUMBER.test(raw)) return '';

  // A cell sometimes stores the link instead of the number.
  const link = raw.match(/wa\.me\/(\+?[\d\s-]{6,20})/i);
  if (link) raw = link[1];

  let digits = raw.replace(/[^0-9]/g, '');
  if (!digits) return '';
  // 00<country><number> is the other international spelling.
  if (digits.startsWith('00')) digits = digits.slice(2);
  // Local mobile (01XXXXXXXXX) and the same number without the leading 0.
  if (digits.length === 11 && digits.startsWith('0')) return `880${digits.slice(1)}`;
  if (digits.length === 10 && digits.startsWith('1')) return `880${digits}`;
  // More digits than E.164 allows means the cell held several numbers jammed
  // together — refuse it instead of opening a dead chat.
  if (digits.length > 15) return '';
  return digits;
}

// Scraped lead cells often store junk in the email field instead of an address:
// "Not Found", "N/A", "-". A real address has an @ and no spaces — anything
// else renders as a dead mailto: link, so normalise before rendering.
export function cleanEmail(email: string): string {
  const raw = String(email || '').trim();
  if (!raw || NOT_A_NUMBER.test(raw)) return '';
  if (!raw.includes('@') || /\s/.test(raw)) return '';
  return raw;
}

/** First candidate that yields a usable WhatsApp number (whatsapp, then phone). */
export function resolveWhatsAppDigits(...candidates: (string | undefined | null)[]): string {
  for (const candidate of candidates) {
    const digits = cleanPhoneForWhatsApp(candidate || '');
    if (digits) return digits;
  }
  return '';
}

export function renderWhatsAppTemplate(template: string, lead: Lead): string {
  return template
    .replace(/\{\{\s*Business Name\s*\}\}/gi, lead.businessName || 'there')
    .replace(/\{\{\s*City\s*\}\}/gi, lead.city || 'your area')
    .replace(/\{\{\s*Niche\s*\}\}/gi, lead.niche || 'business')
    .replace(/\{\{\s*Rating\s*\}\}/gi, lead.rating || '5.0')
    .replace(/\{\{\s*Reviews\s*\}\}/gi, lead.reviews || 'many')
    .replace(/\{\{\s*Phone\s*\}\}/gi, lead.phone || '')
    .replace(/\{\{\s*Email\s*\}\}/gi, lead.email || '')
    .replace(/\{\{\s*Address\s*\}\}/gi, lead.address || '');
}

// Build a 1-click Google Calendar event creation URL
export function buildGoogleCalendarUrl(params: {
  title: string;
  details: string;
  location?: string;
  startIso: string;
  durationMinutes?: number;
}): string {
  const start = new Date(params.startIso);
  const end = new Date(start.getTime() + (params.durationMinutes || 30) * 60000);

  const fmt = (d: Date) =>
    d
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '');

  const url = new URL('https://calendar.google.com/calendar/render');
  url.searchParams.set('action', 'TEMPLATE');
  url.searchParams.set('text', params.title);
  url.searchParams.set('dates', `${fmt(start)}/${fmt(end)}`);
  url.searchParams.set('details', params.details);
  if (params.location) {
    url.searchParams.set('location', params.location);
  }
  return url.toString();
}

// Download a native .ics calendar file (opens in Apple Calendar, Google Calendar, Outlook on phone/desktop with native alarm)
export function downloadIcsReminder(reminder: {
  title: string;
  note: string;
  remindAt: string;
  businessName: string;
  leadPhone: string;
}) {
  const start = new Date(reminder.remindAt);
  const end = new Date(start.getTime() + 30 * 60000);
  const fmt = (d: Date) =>
    d
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '');

  const description = `Lead: ${reminder.businessName}\\nPhone: ${reminder.leadPhone}\\nNote: ${(reminder.note || '').replace(/\n/g, '\\n')}`;

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//LeadFlow CRM//EN',
    'BEGIN:VEVENT',
    `UID:leadflow-${Date.now()}@leadflow.io`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:${reminder.title}`,
    `DESCRIPTION:${description}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT15M',
    'ACTION:DISPLAY',
    'DESCRIPTION:LeadFlow Call/Meeting Reminder',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${reminder.businessName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_reminder.ics`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Play pleasant dual-tone chime using Web Audio API (no external audio file required)
export function playNotificationChime() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();

    const playTone = (freq: number, startTime: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, startTime);
      gain.gain.setValueAtTime(0.001, startTime);
      gain.gain.exponentialRampToValueAtTime(0.18, startTime + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startTime);
      osc.stop(startTime + duration);
    };

    const now = ctx.currentTime;
    playTone(587.33, now, 0.22); // D5
    playTone(880.0, now + 0.18, 0.35); // A5
  } catch {
    // ignore if browser blocks autoplay before interaction
  }
}

// Fire browser / PWA lock-screen notification
export async function triggerBrowserPushNotification(title: string, body: string) {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'default') {
    await Notification.requestPermission();
  }
  if (Notification.permission === 'granted') {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && 'showNotification' in reg) {
        await reg.showNotification(title, {
          body,
          icon: '/icon.svg',
          badge: '/icon.svg',
        });
        return true;
      }
    }
    new Notification(title, { body, icon: '/icon.svg' });
    return true;
  }
  return false;
}

export function formatRelativeTime(isoString?: string | null): string {
  if (!isoString) return '—';
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return isoString;
  const diffMs = date.getTime() - Date.now();
  const absMins = Math.round(Math.abs(diffMs) / 60000);

  if (absMins < 1) return 'Just now';
  if (absMins < 60) {
    return diffMs < 0 ? `${absMins}m ago` : `in ${absMins}m`;
  }
  const absHours = Math.round(absMins / 60);
  if (absHours < 24) {
    return diffMs < 0 ? `${absHours}h ago` : `in ${absHours}h`;
  }
  const absDays = Math.round(absHours / 24);
  return diffMs < 0 ? `${absDays}d ago` : `in ${absDays}d`;
}
