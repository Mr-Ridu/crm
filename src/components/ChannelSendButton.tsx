import React, { useEffect, useRef, useState } from 'react';
import { resolveWhatsAppDigits, formatRelativeTime } from '../utils/helpers.ts';

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  email: 'Email',
  phone: 'Phone',
  messenger: 'Messenger',
};

interface ChannelSendButtonProps {
  message: string;
  businessName: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
  facebook?: string;
  /** How many characters of the message to show before the ellipsis. */
  maxChars?: number;
  /** Pre-rendered templates, used when the lead has no Customized Message. */
  templates?: { id: string; name: string; text: string }[];
  /** Reports the opened channel so the lead can record the outreach. */
  onChannelSent?: (channel: 'whatsapp' | 'email' | 'phone' | 'messenger') => void;
  lastOutreach?: { channel: string; at: string } | null;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for contexts where the async clipboard API is blocked.
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    document.body.removeChild(area);
    return ok;
  }
}

// m.me only resolves for pages, so only a plain facebook.com/<page> link is
// worth converting — anything else opens the Messenger inbox.
function messengerUrl(facebook?: string): string {
  const fb = (facebook || '').trim();
  const page = fb.match(/facebook\.com\/(?!profile\.php|messages|sharer|dialog)([A-Za-z0-9.\-_]+)/i);
  return page ? `https://m.me/${page[1]}` : 'https://www.messenger.com/';
}

export const ChannelSendButton: React.FC<ChannelSendButtonProps> = ({
  message,
  businessName,
  phone,
  whatsapp,
  email,
  facebook,
  maxChars = 18,
  templates,
  onChannelSent,
  lastOutreach,
}) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [flash, setFlash] = useState('');
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // A lead whose sheet had no Customized Message column falls back to the
  // template chosen in Settings, filled with that lead's own details.
  const [templateId, setTemplateId] = useState<string | null>(null);
  const ownMessage = (message || '').trim();
  const templateOptions = templates || [];
  const activeTemplate = templateOptions.find((t) => t.id === templateId) || templateOptions[0];
  const usingTemplate = !ownMessage && !!activeTemplate;

  const text = (ownMessage || (usingTemplate ? activeTemplate.text : '')).trim();
  const preview = text.length > maxChars ? `${text.slice(0, maxChars).trimEnd()}…` : text;

  const waDigits = resolveWhatsAppDigits(whatsapp, phone);
  const telDigits = String(phone || whatsapp || '').replace(/[^\d+]/g, '');

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || btnRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    // Page/list scrolls dismiss the menu, but the message box inside the panel
    // is its own scroll container — scrolling it must not close the panel.
    const onScroll = (e: Event) => {
      const target = e.target;
      if (target instanceof Node && panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  if (!text) return <span className="text-faint">—</span>;

  const openMenu = () => {
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) {
      const width = 288;
      setPos({
        top: Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 300)),
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      });
    }
    setFlash('');
    setOpen(true);
  };

  // Every window.open below runs synchronously inside the click: opening a tab
  // after an await makes the browser treat it as a popup and block it.
  const handleChannel = (channel: 'whatsapp' | 'email' | 'phone' | 'messenger') => {
    onChannelSent?.(channel);
    if (channel === 'whatsapp') {
      const tab = window.open(
        `https://wa.me/${waDigits}?text=${encodeURIComponent(text)}`,
        '_blank'
      );
      if (tab) tab.opener = null;
      setOpen(false);
      return;
    }
    if (channel === 'email') {
      const subject = `Follow-up — ${businessName}`;
      window.location.href = `mailto:${email}?subject=${encodeURIComponent(
        subject
      )}&body=${encodeURIComponent(text)}`;
      setOpen(false);
      return;
    }
    if (channel === 'phone') {
      window.location.href = `tel:${telDigits}`;
      void copyText(text);
      setFlash('Message copied — paste it into your notes or SMS.');
      return;
    }
    const tab = window.open(messengerUrl(facebook), '_blank');
    if (tab) tab.opener = null;
    void copyText(text);
    setFlash('Message copied — paste it into the Messenger chat.');
  };

  const channels: {
    id: 'whatsapp' | 'email' | 'phone' | 'messenger';
    label: string;
    disabled: boolean;
    hint: string;
  }[] = [
    { id: 'whatsapp', label: 'WhatsApp', disabled: !waDigits, hint: 'No WhatsApp number' },
    { id: 'email', label: 'Email', disabled: !email, hint: 'No email address' },
    { id: 'phone', label: 'Phone call', disabled: !telDigits, hint: 'No phone number' },
    { id: 'messenger', label: 'Messenger', disabled: false, hint: '' },
  ];

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={openMenu}
        aria-haspopup="menu"
        aria-expanded={open}
        title={text}
        className="inline-flex items-center gap-1 max-w-full h-7 px-2 rounded-md border border-line bg-canvas text-[12px] font-medium text-ink hover:border-brand hover:text-brand-active transition cursor-pointer"
      >
        <span className="truncate">{preview}</span>
        {lastOutreach?.at && (
          <span
            className="text-[10px] text-success-text shrink-0"
            title={`Last sent via ${CHANNEL_LABELS[lastOutreach.channel] || lastOutreach.channel} · ${formatRelativeTime(lastOutreach.at)}`}
          >
            ✓
          </span>
        )}
        <span className="text-[9px] text-faint shrink-0">▾</span>
      </button>

      {open && (
        <div
          ref={panelRef}
          role="menu"
          aria-label={`Send customized message to ${businessName}`}
          style={{ top: pos.top, left: pos.left }}
          className="fixed z-50 w-[min(18rem,calc(100vw-1rem))] max-h-[calc(100dvh-1rem)] overflow-y-auto overscroll-contain rounded-xl bg-surface border border-line shadow-pop p-2.5 space-y-2"
        >
          <div className="flex items-start justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
              Customized message
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="text-faint hover:text-ink text-[15px] leading-none cursor-pointer"
            >
              ×
            </button>
          </div>

          {usingTemplate && (
            <div className="space-y-1">
              <p className="text-[10.5px] font-medium text-faint uppercase tracking-[0.06em]">
                From template · edit in Settings
              </p>
              {templateOptions.length > 1 && (
                <select
                  value={activeTemplate.id}
                  onChange={(e) => setTemplateId(e.target.value)}
                  aria-label="Message template"
                  className="w-full h-7 rounded-md border border-line bg-canvas px-2 text-[12px] text-ink cursor-pointer"
                >
                  {templateOptions.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          <p className="max-h-40 overflow-y-auto overscroll-contain whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-ink bg-canvas rounded-lg p-2 border border-line">
            {text}
          </p>

          <div className="grid grid-cols-2 gap-1.5">
            {channels.map((ch) => (
              <button
                key={ch.id}
                type="button"
                role="menuitem"
                disabled={ch.disabled}
                onClick={() => handleChannel(ch.id)}
                title={ch.disabled ? ch.hint : `Open ${ch.label} with this message`}
                className={`h-8 rounded-lg border text-[12px] font-semibold transition cursor-pointer ${
                  ch.disabled
                    ? 'border-line bg-canvas text-faint cursor-not-allowed'
                    : 'border-line bg-surface text-ink hover:border-brand hover:text-brand-active'
                }`}
              >
                {ch.label}
              </button>
            ))}
          </div>

          {lastOutreach?.at && (
            <p className="text-[11px] text-muted leading-snug">
              Last sent via {CHANNEL_LABELS[lastOutreach.channel] || lastOutreach.channel} ·{' '}
              {formatRelativeTime(lastOutreach.at)}
            </p>
          )}

          {flash && <p className="text-[11.5px] text-success-text leading-snug">{flash}</p>}
        </div>
      )}
    </>
  );
};
