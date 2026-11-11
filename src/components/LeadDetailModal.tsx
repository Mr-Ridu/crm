import React, { useState, useEffect } from 'react';
import {
  Phone,
  MessageCircle,
  Mail,
  Copy,
  Check,
  Globe,
  Facebook,
  MapPin,
  Star,
  Calendar,
  Clock,
  Send,
  Bell,
  CheckCircle2,
  Sparkles,
  ExternalLink,
  Download,
  Edit3,
  Save,
  UserCheck,
  Tag,
  Layers,
} from 'lucide-react';
import type {
  Lead,
  LeadComment,
  Reminder,
  IntegrationSettings,
  User,
} from '../types.ts';
import {
  cleanEmail,
  resolveWhatsAppDigits,
  renderWhatsAppTemplate,
  buildGoogleCalendarUrl,
  downloadIcsReminder,
  formatRelativeTime,
} from '../utils/helpers.ts';
import {
  Button,
  IconButton,
  Badge,
  Dot,
  Avatar,
  DrawerShell,
  Field,
  TextInput,
  Textarea,
  EmptyState,
} from './ui.tsx';
import { authHeaders } from '../utils/api.ts';

interface LeadDetailModalProps {
  leadId: number | null;
  onClose: () => void;
  currentUser: User;
  settings: IntegrationSettings;
  onLeadUpdated: () => void;
}

export const LeadDetailModal: React.FC<LeadDetailModalProps> = ({
  leadId,
  onClose,
  currentUser,
  settings,
  onLeadUpdated,
}) => {
  const [lead, setLead] = useState<Lead | null>(null);
  const [lotColumns, setLotColumns] = useState<{ key: string; label: string }[]>([]);
  const [comments, setComments] = useState<LeadComment[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(false);

  // New communication / comment state
  const [newCommentText, setNewCommentText] = useState('');
  const [selectedColor, setSelectedColor] = useState('none');
  const [selectedStatus, setSelectedStatus] = useState('New');
  const [submittingComment, setSubmittingComment] = useState(false);

  // Email compose menu state
  const [showEmailMenu, setShowEmailMenu] = useState(false);
  const [emailCopied, setEmailCopied] = useState(false);

  // WhatsApp template selector
  const [selectedWaTemplateId, setSelectedWaTemplateId] = useState(
    settings.whatsappTemplates[0]?.id || 'intro'
  );

  // Reminder scheduling state
  const [reminderTitle, setReminderTitle] = useState('');
  const [reminderNote, setReminderNote] = useState('');
  const [reminderType, setReminderType] = useState<'call' | 'meeting' | 'followup'>('call');
  const [reminderDateTime, setReminderDateTime] = useState('');
  const [notifyAdmin, setNotifyAdmin] = useState(true);
  const [autoOpenGcal, setAutoOpenGcal] = useState(false);
  // Set only when the browser blocked the calendar tab, so we can offer a link.
  const [gcalBlockedUrl, setGcalBlockedUrl] = useState<string | null>(null);
  const [savingReminder, setSavingReminder] = useState(false);

  // Editing 15 columns state
  const [isEditingDetails, setIsEditingDetails] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Lead>>({});

  const fetchDetail = async (id: number) => {
    setLoading(true);
    try {
      const resp = await fetch(`/api/leads/${id}`, {
        headers: { ...authHeaders() },
      });
      if (resp.ok) {
        const data = await resp.json();
        setLead(data.lead);
        setLotColumns(data.columns || []);
        setComments(data.comments || []);
        setReminders(data.reminders || []);
        setSelectedColor(data.lead.colorTag || 'none');
        setSelectedStatus(data.lead.status || 'New');
        setEditForm(data.lead);

        // Default reminder time: 2 hours from now
        const twoHours = new Date(Date.now() + 2 * 3600000);
        const tzOffset = twoHours.getTimezoneOffset() * 60000;
        const localIso = new Date(twoHours.getTime() - tzOffset).toISOString().slice(0, 16);
        setReminderDateTime(localIso);
        setReminderTitle(`Follow-up Call with ${data.lead.businessName}`);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (leadId) {
      fetchDetail(leadId);
      setIsEditingDetails(false);
    } else {
      setLead(null);
    }
  }, [leadId, currentUser.id]);

  if (!leadId) return null;

  const handleQuickColorOrStatusChange = async (newColor: string, newStatus: string) => {
    if (!lead) return;
    setSelectedColor(newColor);
    setSelectedStatus(newStatus);
    await fetch(`/api/leads/${lead.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
      },
      body: JSON.stringify({
        colorTag: newColor,
        status: newStatus,
      }),
    });
    await fetchDetail(lead.id);
    onLeadUpdated();
  };

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lead || !newCommentText.trim()) return;
    setSubmittingComment(true);
    try {
      const resp = await fetch(`/api/leads/${lead.id}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(),
        },
        body: JSON.stringify({
          content: newCommentText.trim(),
          colorTag: selectedColor,
          status: selectedStatus === 'New' ? 'Contacted' : selectedStatus,
        }),
      });
      if (resp.ok) {
        setNewCommentText('');
        await fetchDetail(lead.id);
        onLeadUpdated();
      }
    } finally {
      setSubmittingComment(false);
    }
  };

  const handleSaveDetails = async () => {
    if (!lead) return;
    const resp = await fetch(`/api/leads/${lead.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
      },
      body: JSON.stringify(editForm),
    });
    if (resp.ok) {
      setIsEditingDetails(false);
      await fetchDetail(lead.id);
      onLeadUpdated();
    }
  };

  const handleScheduleReminder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lead || !reminderTitle.trim() || !reminderDateTime) return;

    const isoRemindAt = new Date(reminderDateTime).toISOString();

    // The tab must be opened inside the click gesture itself. Calling
    // window.open after the save request finishes counts as a popup and
    // Chrome/Safari block it, so the calendar tab is opened here first.
    if (autoOpenGcal) {
      const gcalUrl = buildGoogleCalendarUrl({
        title: reminderTitle.trim(),
        details: `Lead: ${lead.businessName}\nPhone: ${lead.phone}\nWhatsApp: ${lead.whatsapp}\nCity: ${lead.city}\nNiche: ${lead.niche}\nNotes: ${reminderNote}`,
        location: lead.address || lead.city,
        startIso: isoRemindAt,
      });
      // No 'noopener' in the feature string: it makes the return value null
      // even on success, which would look like a blocked popup.
      const gcalWin = window.open(gcalUrl, '_blank');
      if (gcalWin) gcalWin.opener = null;
      setGcalBlockedUrl(gcalWin ? null : gcalUrl);
    } else {
      setGcalBlockedUrl(null);
    }

    setSavingReminder(true);
    try {
      const resp = await fetch('/api/reminders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(),
        },
        body: JSON.stringify({
          leadId: lead.id,
          title: reminderTitle.trim(),
          note: reminderNote.trim(),
          remindAt: isoRemindAt,
          reminderType,
          notifyAdmin,
          updateLeadStatus: true,
        }),
      });
      if (resp.ok) {
        const resData = await resp.json();
        // Fire-and-forget: the server checks the reminder OWNER's own
        // My Alerts toggles and sends nothing if they are off.
        fetch('/api/notifications/dispatch', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...authHeaders(),
          },
          body: JSON.stringify({ reminderId: resData.id }),
        }).catch(() => {});

        setReminderNote('');
        await fetchDetail(lead.id);
        onLeadUpdated();
      }
    } finally {
      setSavingReminder(false);
    }
  };

  const handleToggleReminderStatus = async (rem: Reminder) => {
    const nextStatus = rem.status === 'completed' ? 'pending' : 'completed';
    await fetch(`/api/reminders/${rem.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
      },
      body: JSON.stringify({ status: nextStatus }),
    });
    if (lead) await fetchDetail(lead.id);
    onLeadUpdated();
  };

  const activeColorObj =
    settings.colorTags.find((c) => c.id === selectedColor) || settings.colorTags[0];

  const waClean = lead ? resolveWhatsAppDigits(lead.whatsapp, lead.phone) : '';
  // Scraped rows often hold "Not Found" instead of an address — treat as missing.
  const email = lead ? cleanEmail(lead.email) : '';
  const activeTemplate =
    settings.whatsappTemplates.find((t) => t.id === selectedWaTemplateId) ||
    settings.whatsappTemplates[0];
  const waRenderedMessage =
    lead && activeTemplate ? renderWhatsAppTemplate(activeTemplate.content, lead) : '';
  const waUrl = waClean
    ? `https://wa.me/${waClean}?text=${encodeURIComponent(waRenderedMessage)}`
    : '#';

  // Direct-email compose options (frontend only — opens Gmail / Outlook /
  // default mail app with subject + body prefilled, or copies the address)
  const emailSubject = lead ? `Quick question for ${lead.businessName}` : '';
  const emailBody = lead
    ? `Hi ${lead.businessName} team,\n\nI came across your ${lead.niche || 'business'} in ${lead.city || 'your area'} and wanted to quickly share how we help local businesses get more customers.\n\nAre you open to a quick 10-minute call this week?\n\nBest regards,\n${currentUser.name}`
    : '';
  const gmailComposeUrl = email
    ? `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(email)}&su=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`
    : '#';
  const outlookComposeUrl = email
    ? `https://outlook.live.com/owa/?path=/mail/action/compose&to=${encodeURIComponent(email)}&subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`
    : '#';
  const mailtoComposeUrl = email
    ? `mailto:${email}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`
    : '#';

  const handleCopyEmail = async () => {
    if (!email) return;
    try {
      await navigator.clipboard.writeText(email);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = email;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setEmailCopied(true);
    setTimeout(() => setEmailCopied(false), 2000);
  };

  return (
    <DrawerShell onClose={onClose} label={lead ? `Lead details — ${lead.businessName}` : 'Lead details'}>
      {loading && !lead ? (
        <div className="p-12 text-center text-[13px] text-muted">Loading lead details…</div>
      ) : lead ? (
        <>
          {/* Header */}
          <div
            className="px-5 sm:px-6 py-4 border-b border-line row-tint"
            style={
              {
                '--row-tint':
                  activeColorObj.rowTintHex !== 'transparent'
                    ? activeColorObj.rowTintHex
                    : 'var(--color-surface)',
                ...(activeColorObj.rowTintDarkHex
                  ? { '--row-tint-dark': activeColorObj.rowTintDarkHex }
                  : {}),
              } as React.CSSProperties
            }
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone="neutral">
                    <Layers className="w-3 h-3 text-faint" />
                    {lead.lotName}
                  </Badge>
                  {lead.niche && <Badge tone="brand">{lead.niche}</Badge>}
                  {lead.city && (
                    <span className="inline-flex items-center gap-1 text-[12px] text-muted">
                      <MapPin className="w-3.5 h-3.5 text-faint" />
                      {lead.city}
                    </span>
                  )}
                  {lead.rating && (
                    <Badge tone="warning">
                      <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                      <span className="tnum">
                        {lead.rating} · {lead.reviews || 0}
                      </span>
                    </Badge>
                  )}
                </div>

                <h2 className="text-[20px] font-semibold tracking-tight text-ink">
                  {lead.businessName}
                </h2>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
                  <span>
                    Imported <span className="font-medium text-ink">{lead.importedAt || '—'}</span>
                  </span>
                  <span aria-hidden="true" className="text-faint">·</span>
                  <span>
                    Source <span className="font-medium text-ink">{lead.source || 'Spreadsheet'}</span>
                  </span>
                  <span aria-hidden="true" className="text-faint">·</span>
                  <span className="inline-flex items-center gap-1">
                    <UserCheck className="w-3.5 h-3.5 text-faint" />
                    <span className="font-medium text-ink">
                      {lead.handledByUserName || 'Unclaimed'}
                    </span>
                  </span>
                </div>
              </div>

              <IconButton label="Close lead details" onClick={onClose}>
                {/* X rendered by parent IconButton children */}
                <span aria-hidden="true" className="text-[15px] leading-none">✕</span>
              </IconButton>
            </div>

            {/* Color + status row */}
            <div className="mt-3 pt-3 border-t border-line/70 flex flex-wrap items-center gap-x-5 gap-y-2.5">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted flex items-center gap-1">
                  <Tag className="w-3 h-3" /> Color
                </span>
                <div className="flex flex-wrap items-center gap-1">
                  {settings.colorTags.map((c) => {
                    const active = selectedColor === c.id;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        title={`${c.name}: ${c.meaning}`}
                        aria-pressed={active}
                        onClick={() => handleQuickColorOrStatusChange(c.id, selectedStatus)}
                        className={`h-7 px-2 rounded-md text-[12px] font-medium border flex items-center gap-1.5 transition cursor-pointer ${
                          active
                            ? 'bg-surface text-ink border-ink/40 shadow-card'
                            : 'bg-surface/70 text-muted border-line hover:text-ink'
                        }`}
                      >
                        <Dot color={c.dotHex} />
                        <span>{c.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                  Status
                </span>
                <select
                  value={selectedStatus}
                  onChange={(e) => handleQuickColorOrStatusChange(selectedColor, e.target.value)}
                  className="h-8 pl-2 pr-7 rounded-lg border border-line bg-surface text-[13px] font-medium text-ink"
                >
                  {settings.statusOptions.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto bg-canvas">
            <div className="p-5 sm:p-6 flex flex-col gap-5 lg:grid lg:grid-cols-12 lg:items-start">
              {/* Left: outreach, comments, details (contents = children join mobile flow) */}
              <div className="contents lg:block lg:col-span-7 lg:space-y-5 min-w-0">
                {/* Outreach */}
                <section className="rounded-lg bg-navy text-white p-4 space-y-3 order-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-300 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5" /> Outreach
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      {lead.phone && (
                        <a
                          href={`tel:${lead.phone}`}
                          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-brand hover:bg-brand-hover text-white text-[13px] font-medium transition"
                        >
                          <Phone className="w-3.5 h-3.5" />
                          <span className="tnum">{lead.phone}</span>
                        </a>
                      )}
                      {waClean && (
                        <a
                          href={waUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-success-bg text-success-text text-[13px] font-medium hover:bg-success-border/60 transition"
                        >
                          <MessageCircle className="w-3.5 h-3.5" />
                          WhatsApp
                        </a>
                      )}
                      {email && (
                        <span className="relative inline-flex">
                          <button
                            type="button"
                            onClick={() => setShowEmailMenu((v) => !v)}
                            aria-haspopup="menu"
                            aria-expanded={showEmailMenu}
                            title={email}
                            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-white/10 hover:bg-white/15 text-white text-[13px] font-medium transition cursor-pointer"
                          >
                            <Mail className="w-3.5 h-3.5" />
                            Email
                          </button>
                          {showEmailMenu && (
                            <>
                              <button
                                type="button"
                                aria-hidden="true"
                                tabIndex={-1}
                                onClick={() => setShowEmailMenu(false)}
                                className="fixed inset-0 z-10 cursor-default bg-transparent border-0 p-0"
                              />
                              <div
                                role="menu"
                                aria-label={`Email ${email}`}
                                className="absolute right-0 mt-2 w-60 z-20 rounded-xl bg-surface border border-line shadow-pop p-1.5 space-y-0.5"
                              >
                                <p className="px-2.5 pt-1.5 pb-1 text-[11px] text-faint truncate tnum">
                                  {email}
                                </p>
                                <a
                                  href={gmailComposeUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  role="menuitem"
                                  onClick={() => setShowEmailMenu(false)}
                                  className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-[13px] font-medium text-ink hover:bg-navy-soft/60 transition"
                                >
                                  <Mail className="w-3.5 h-3.5 text-faint" />
                                  Compose in Gmail
                                  <ExternalLink className="w-3 h-3 text-faint ml-auto" />
                                </a>
                                <a
                                  href={outlookComposeUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  role="menuitem"
                                  onClick={() => setShowEmailMenu(false)}
                                  className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-[13px] font-medium text-ink hover:bg-navy-soft/60 transition"
                                >
                                  <Mail className="w-3.5 h-3.5 text-faint" />
                                  Compose in Outlook
                                  <ExternalLink className="w-3 h-3 text-faint ml-auto" />
                                </a>
                                <a
                                  href={mailtoComposeUrl}
                                  role="menuitem"
                                  onClick={() => setShowEmailMenu(false)}
                                  className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-[13px] font-medium text-ink hover:bg-navy-soft/60 transition"
                                >
                                  <Send className="w-3.5 h-3.5 text-faint" />
                                  Default mail app
                                </a>
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={handleCopyEmail}
                                  className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-[13px] font-medium text-ink hover:bg-navy-soft/60 transition cursor-pointer"
                                >
                                  {emailCopied ? (
                                    <Check className="w-3.5 h-3.5 text-success-text" />
                                  ) : (
                                    <Copy className="w-3.5 h-3.5 text-faint" />
                                  )}
                                  {emailCopied ? 'Copied!' : 'Copy address'}
                                </button>
                              </div>
                            </>
                          )}
                        </span>
                      )}
                    </div>
                  </div>

                  {waClean && (
                    <div className="pt-3 border-t border-white/10 flex flex-col gap-2">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                        <span className="text-[12px] text-slate-400 shrink-0">Template</span>
                        <select
                          value={selectedWaTemplateId}
                          onChange={(e) => setSelectedWaTemplateId(e.target.value)}
                          className="h-8 pl-2 pr-7 rounded-lg bg-white/10 text-white border border-white/15 text-[13px]"
                        >
                          {settings.whatsappTemplates.map((t) => (
                            <option key={t.id} value={t.id} className="text-ink">
                              {t.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <p className="text-[12px] text-slate-300 italic leading-relaxed">
                        “{waRenderedMessage}”
                      </p>
                    </div>
                  )}
                </section>

                {/* New comment */}
                <section className="rounded-lg bg-surface border border-line p-4 space-y-3 order-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-[15px] font-semibold text-ink">Add comment</h3>
                    <Badge tone="brand">Appends to timeline · never overwrites</Badge>
                  </div>
                  <form onSubmit={handleAddComment} className="space-y-3">
                    <Textarea
                      rows={3}
                      value={newCommentText}
                      onChange={(e) => setNewCommentText(e.target.value)}
                      placeholder="What happened on the call — who you spoke to, pricing, objections…"
                      aria-label="New comment"
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[12px] text-muted">
                        As <strong className="text-ink">{currentUser.name}</strong> · color{' '}
                        <strong className="text-ink">{activeColorObj.name}</strong>
                      </span>
                      <Button
                        type="submit"
                        variant="primary"
                        size="sm"
                        disabled={submittingComment || !newCommentText.trim()}
                      >
                        <Send className="w-3.5 h-3.5" />
                        {submittingComment ? 'Saving…' : 'Save comment'}
                      </Button>
                    </div>
                  </form>
                </section>

                {/* Timeline */}
                <section className="space-y-3 order-4">
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                    Comment history ({comments.length})
                  </h3>
                  {comments.length === 0 ? (
                    <div className="rounded-lg bg-surface border border-dashed border-line">
                      <EmptyState
                        title="No comments yet"
                        description="Add the first communication note above."
                      />
                    </div>
                  ) : (
                    <ol className="space-y-2.5">
                      {comments.map((c) => {
                        const cTag =
                          settings.colorTags.find((t) => t.id === c.colorTag) ||
                          settings.colorTags[0];
                        return (
                          <li
                            key={c.id}
                            className="rounded-lg bg-surface border border-line p-3.5"
                          >
                            <div className="flex items-center justify-between gap-2 mb-1.5">
                              <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                                <Avatar
                                  name={c.userName}
                                  color={c.userAvatarColor || '#6D5CE8'}
                                  size="xs"
                                />
                                <span className="text-[13px] font-semibold text-ink">
                                  {c.userName}
                                </span>
                                {c.isImportedInitial ? (
                                  <Badge tone="warning">Imported comment</Badge>
                                ) : (
                                  <>
                                    {c.statusSnapshot && (
                                      <Badge tone="neutral">{c.statusSnapshot}</Badge>
                                    )}
                                    {c.colorTag && c.colorTag !== 'none' && (
                                      <Badge tone="neutral">
                                        <Dot color={cTag.dotHex} />
                                        {cTag.name}
                                      </Badge>
                                    )}
                                  </>
                                )}
                              </div>
                              <span
                                className="text-[11px] text-faint shrink-0 tnum"
                                title={new Date(c.createdAt).toLocaleString()}
                              >
                                {formatRelativeTime(c.createdAt)}
                              </span>
                            </div>
                            <p className="text-[13px] leading-relaxed text-ink whitespace-pre-wrap pl-7">
                              {c.content}
                            </p>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </section>

                {/* 15 fields */}
                <section className="rounded-lg bg-surface border border-line p-4 space-y-3 order-5">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-[15px] font-semibold text-ink">Lead details</h3>
                    {!isEditingDetails ? (
                      <Button variant="ghost" size="sm" onClick={() => setIsEditingDetails(true)}>
                        <Edit3 className="w-3.5 h-3.5" /> Edit
                      </Button>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <Button variant="ghost" size="sm" onClick={() => setIsEditingDetails(false)}>
                          Cancel
                        </Button>
                        <Button variant="primary" size="sm" onClick={handleSaveDetails}>
                          <Save className="w-3.5 h-3.5" /> Save
                        </Button>
                      </div>
                    )}
                  </div>

                  {!isEditingDetails ? (
                    <div className="space-y-3">
                    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0 text-[13px]">
                      {[
                        { label: 'Business name', value: lead.businessName, span: false },
                        { label: 'Phone', value: lead.phone, span: false, tnum: true },
                        { label: 'Original comment', value: lead.initialComment, span: true },
                        {
                          label: 'Email',
                          value: email,
                          span: false,
                          breakAll: true,
                          link: email ? `mailto:${email}` : undefined,
                        },
                        {
                          label: 'Website',
                          value: lead.website,
                          span: false,
                          link: lead.website
                            ? lead.website.startsWith('http')
                              ? lead.website
                              : `https://${lead.website}`
                            : undefined,
                          linkIcon: <Globe className="w-3.5 h-3.5 shrink-0" />,
                        },
                        {
                          label: 'Facebook',
                          value: lead.facebook,
                          span: false,
                          link: lead.facebook
                            ? lead.facebook.startsWith('http')
                              ? lead.facebook
                              : `https://${lead.facebook}`
                            : undefined,
                          linkIcon: <Facebook className="w-3.5 h-3.5 shrink-0" />,
                        },
                        { label: 'WhatsApp', value: lead.whatsapp, span: false, tnum: true },
                        { label: 'Address', value: lead.address, span: false },
                        { label: 'City', value: lead.city, span: false },
                        { label: 'Niche', value: lead.niche, span: false },
                        { label: 'Rating', value: lead.rating ? `${lead.rating} / 5` : '', span: false, tnum: true },
                        { label: 'Reviews', value: lead.reviews, span: false, tnum: true },
                        { label: 'Status', value: lead.status || 'New', span: false, strong: true },
                        { label: 'Source', value: lead.source, span: false },
                        { label: 'Imported at', value: lead.importedAt, span: true, tnum: true },
                      ].map((f) => (
                        <div
                          key={f.label}
                          className={`flex items-baseline justify-between gap-3 py-2 border-b border-line-soft last:border-0 ${f.span ? 'sm:col-span-2' : ''}`}
                        >
                          <dt className="text-muted shrink-0">{f.label}</dt>
                          <dd
                            className={`text-right min-w-0 truncate ${f.strong ? 'font-semibold text-ink' : 'text-ink'} ${f.tnum ? 'tnum' : ''} ${f.breakAll ? 'break-all' : ''}`}
                            title={f.value || undefined}
                          >
                            {f.link ? (
                              <a
                                href={f.link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-brand hover:text-brand-hover font-medium"
                              >
                                {f.linkIcon}
                                <span className="truncate">{f.value}</span>
                              </a>
                            ) : (
                              f.value || '—'
                            )}
                          </dd>
                        </div>
                      ))}
                    </dl>

                    {lotColumns.length > 0 && (
                      <div className="pt-3 border-t border-line">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted mb-1">
                          Extra columns from this lot&apos;s spreadsheet
                        </p>
                        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0 text-[13px]">
                          {lotColumns.map((col) => (
                            <div
                              key={col.key}
                              className="flex items-baseline justify-between gap-3 py-2 border-b border-line-soft last:border-0"
                            >
                              <dt className="text-muted shrink-0">{col.label}</dt>
                              <dd
                                className="text-right min-w-0 truncate text-ink"
                                title={lead.extra?.[col.key] || undefined}
                              >
                                {lead.extra?.[col.key] || '—'}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                    )}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {[
                        { key: 'businessName', label: 'Business Name' },
                        { key: 'phone', label: 'Phone' },
                        { key: 'email', label: 'Email' },
                        { key: 'whatsapp', label: 'WhatsApp' },
                        { key: 'website', label: 'Website' },
                        { key: 'facebook', label: 'Facebook' },
                        { key: 'address', label: 'Address' },
                        { key: 'city', label: 'City' },
                        { key: 'niche', label: 'Niche' },
                        { key: 'rating', label: 'Rating' },
                        { key: 'reviews', label: 'Reviews' },
                        { key: 'source', label: 'Source' },
                      ].map((f) => (
                        <Field key={f.key} label={f.label}>
                          <TextInput
                            type="text"
                            value={(editForm as any)[f.key] || ''}
                            onChange={(e) =>
                              setEditForm((prev) => ({ ...prev, [f.key]: e.target.value }))
                            }
                          />
                        </Field>
                      ))}
                    </div>
                  )}
                </section>
              </div>

              {/* Right: scheduler */}
              <div className="contents lg:block lg:col-span-5 lg:space-y-5 min-w-0 lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100dvh-170px)] lg:overflow-y-auto">
                <section id="lead-followup" className="rounded-lg bg-surface border border-line p-4 space-y-4 order-2 scroll-mt-4">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-brand-soft text-brand flex items-center justify-center shrink-0">
                      <Bell className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-[15px] font-semibold text-ink">Schedule follow-up</h3>
                      <p className="text-[12px] text-muted">Alerts you & admin, in-app and on phone</p>
                    </div>
                  </div>

                  <form onSubmit={handleScheduleReminder} className="space-y-3">
                    <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Reminder type">
                      {(
                        [
                          { id: 'call', label: 'Call' },
                          { id: 'meeting', label: 'Meeting' },
                          { id: 'followup', label: 'Follow-up' },
                        ] as const
                      ).map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          aria-pressed={reminderType === t.id}
                          onClick={() => {
                            setReminderType(t.id);
                            if (lead) {
                              setReminderTitle(
                                t.id === 'meeting'
                                  ? `Meeting with ${lead.businessName}`
                                  : t.id === 'call'
                                  ? `Call back ${lead.businessName}`
                                  : `Follow up with ${lead.businessName}`
                              );
                            }
                          }}
                          className={`h-8 px-2 rounded-lg text-[13px] font-medium border transition cursor-pointer ${
                            reminderType === t.id
                              ? 'bg-navy text-white border-navy'
                              : 'bg-surface text-muted border-line hover:text-ink'
                          }`}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>

                    <Field label="Title">
                      <TextInput
                        type="text"
                        required
                        value={reminderTitle}
                        onChange={(e) => setReminderTitle(e.target.value)}
                      />
                    </Field>

                    <Field label="Date & time">
                      <TextInput
                        type="datetime-local"
                        required
                        value={reminderDateTime}
                        onChange={(e) => setReminderDateTime(e.target.value)}
                        className="tnum"
                      />
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {[
                          { label: 'In 30 min', mins: 30 },
                          { label: 'In 2 hours', mins: 120 },
                          { label: 'Tomorrow 10 AM', mins: 24 * 60 },
                          { label: 'In 3 days', mins: 3 * 24 * 60 },
                        ].map((preset) => (
                          <button
                            key={preset.label}
                            type="button"
                            onClick={() => {
                              const d = new Date(Date.now() + preset.mins * 60000);
                              const tzOffset = d.getTimezoneOffset() * 60000;
                              setReminderDateTime(
                                new Date(d.getTime() - tzOffset).toISOString().slice(0, 16)
                              );
                            }}
                            className="h-7 px-2 rounded-md bg-navy-soft/60 hover:bg-navy-soft text-[12px] font-medium text-ink cursor-pointer"
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    </Field>

                    <Field label="Note">
                      <Textarea
                        rows={2}
                        value={reminderNote}
                        onChange={(e) => setReminderNote(e.target.value)}
                        placeholder="What to discuss…"
                      />
                    </Field>

                    <label className="flex items-center gap-2 text-[13px] text-ink cursor-pointer">
                      <input
                        type="checkbox"
                        checked={notifyAdmin}
                        onChange={(e) => setNotifyAdmin(e.target.checked)}
                        className="w-4 h-4 rounded border-line accent-[#6D5CE8]"
                      />
                      Also remind admin when due
                    </label>

                    <div className="flex items-center gap-2.5">
                      <Button
                        type="submit"
                        variant="primary"
                        disabled={savingReminder}
                        className="flex-1"
                      >
                        {savingReminder ? 'Scheduling…' : 'Save reminder'}
                      </Button>
                      <label
                        className="flex items-center gap-1.5 text-[12.5px] text-ink cursor-pointer shrink-0"
                        title="Save the reminder here and open a pre-filled Google Calendar event in a new tab"
                      >
                        <input
                          type="checkbox"
                          checked={autoOpenGcal}
                          onChange={(e) => setAutoOpenGcal(e.target.checked)}
                          className="w-4 h-4 rounded border-line accent-[#6D5CE8]"
                        />
                        Google Calendar
                      </label>
                    </div>

                    {gcalBlockedUrl && (
                      <p className="text-[12px] text-muted leading-snug">
                        Reminder saved — the browser blocked the new tab.{' '}
                        <a
                          href={gcalBlockedUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-semibold text-brand-active underline"
                        >
                          Open Google Calendar event
                        </a>
                      </p>
                    )}
                  </form>
                </section>

                {/* Scheduled list */}
                <section className="space-y-2.5 order-6">
                  <h4 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                    Scheduled ({reminders.length})
                  </h4>
                  {reminders.length === 0 ? (
                    <div className="rounded-lg bg-surface border border-dashed border-line">
                      <EmptyState
                        title="No reminders yet"
                        description="Schedule the first follow-up above."
                      />
                    </div>
                  ) : (
                    <ol className="space-y-2.5">
                      {reminders.map((r) => {
                        const isOverdue =
                          r.status === 'pending' && new Date(r.remindAt).getTime() <= Date.now();
                        const gcalLink = buildGoogleCalendarUrl({
                          title: r.title,
                          details: `Lead: ${lead.businessName}\nPhone: ${lead.phone}\nNote: ${r.note}`,
                          location: lead.address || lead.city,
                          startIso: r.remindAt,
                        });
                        return (
                          <li
                            key={r.id}
                            className={`rounded-lg bg-surface border border-line p-3.5 space-y-2 ${
                              r.status === 'completed' ? 'opacity-70' : ''
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <Badge
                                  tone={
                                    r.status === 'completed'
                                      ? 'success'
                                      : isOverdue
                                      ? 'danger'
                                      : 'warning'
                                  }
                                >
                                  {r.status === 'completed'
                                    ? 'Done'
                                    : isOverdue
                                    ? 'Overdue'
                                    : r.reminderType}
                                </Badge>{' '}
                                <span
                                  className={`text-[13px] font-semibold text-ink ${
                                    r.status === 'completed' ? 'line-through' : ''
                                  }`}
                                >
                                  {r.title}
                                </span>
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleToggleReminderStatus(r)}
                                className="shrink-0 text-success-text"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                {r.status === 'completed' ? 'Reopen' : 'Done'}
                              </Button>
                            </div>

                            {r.note && <p className="text-[13px] text-muted">{r.note}</p>}

                            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-line-soft">
                              <span className="inline-flex items-center gap-1 text-[12px] text-muted tnum">
                                <Clock className="w-3.5 h-3.5 text-faint" />
                                {new Date(r.remindAt).toLocaleString([], {
                                  month: 'short',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}{' '}
                                ({formatRelativeTime(r.remindAt)})
                              </span>
                              <div className="flex items-center gap-3">
                                <a
                                  href={gcalLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-[12px] text-brand hover:text-brand-hover font-medium"
                                >
                                  <Calendar className="w-3.5 h-3.5" />
                                  Google Cal
                                  <ExternalLink className="w-3 h-3 text-faint" />
                                </a>
                                <button
                                  type="button"
                                  onClick={() =>
                                    downloadIcsReminder({
                                      title: r.title,
                                      note: r.note,
                                      remindAt: r.remindAt,
                                      businessName: lead.businessName,
                                      leadPhone: lead.phone,
                                    })
                                  }
                                  className="inline-flex items-center gap-1 text-[12px] text-muted hover:text-ink font-medium cursor-pointer"
                                  title="Download .ics alarm for Apple/Android Phone Calendar"
                                >
                                  <Download className="w-3.5 h-3.5" />
                                  .ics
                                </button>
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </section>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </DrawerShell>
  );
};
