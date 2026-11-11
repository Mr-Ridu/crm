import React, { useState, useEffect } from 'react';
import {
  Save,
  Send,
  Mail,
  Calendar,
  Smartphone,
  Palette,
  MessageCircle,
  CheckCircle2,
  Plus,
  Trash2,
} from 'lucide-react';
import type { IntegrationSettings, User } from '../types.ts';
import { Button, PageHeader, Card, Badge } from './ui.tsx';
import { authHeaders } from '../utils/api.ts';

interface SettingsIntegrationsViewProps {
  settings: IntegrationSettings;
  currentUser: User;
  onSaveSettings: (next: IntegrationSettings) => Promise<void>;
}

export const SettingsIntegrationsView: React.FC<SettingsIntegrationsViewProps> = ({
  settings,
  currentUser,
  onSaveSettings,
}) => {
  const [form, setForm] = useState<IntegrationSettings>(settings);
  const [savedToast, setSavedToast] = useState('');
  const [logs, setLogs] = useState<any[]>([]);
  const [newStatusOption, setNewStatusOption] = useState('');

  useEffect(() => {
    setForm(settings);
    fetchLogs();
  }, [settings]);

  const fetchLogs = async () => {
    const resp = await fetch('/api/notifications/logs', {
      headers: { ...authHeaders() },
    });
    if (resp.ok) {
      setLogs(await resp.json());
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSaveSettings(form);
    setSavedToast('Settings saved! You can update or add API keys anytime.');
    setTimeout(() => setSavedToast(''), 4000);
  };

  // NOTE: test sending moved to each user's own "My Alerts" page — sending is
  // fully per-user now, there is no shared sender left to test from here.

  const updateColorMeaning = (id: string, meaning: string) => {
    setForm((prev) => ({
      ...prev,
      colorTags: prev.colorTags.map((c) => (c.id === id ? { ...c, meaning } : c)),
    }));
  };

  const updateWaTemplate = (id: string, field: 'name' | 'content', val: string) => {
    setForm((prev) => ({
      ...prev,
      whatsappTemplates: prev.whatsappTemplates.map((t) =>
        t.id === id ? { ...t, [field]: val } : t
      ),
    }));
  };

  const addWaTemplate = () => {
    setForm((prev) => ({
      ...prev,
      whatsappTemplates: [
        ...prev.whatsappTemplates,
        {
          id: `tpl_${Date.now()}`,
          name: 'New Outreach Template',
          content: 'Hi {{Business Name}}, reaching out regarding your {{Niche}} clinic in {{City}}.',
        },
      ],
    }));
  };

  const removeWaTemplate = (id: string) => {
    setForm((prev) => ({
      ...prev,
      whatsappTemplates: prev.whatsappTemplates.filter((t) => t.id !== id),
    }));
  };

  const inputCls =
    'w-full h-9 rounded-lg border border-line bg-surface px-3 text-[13px] text-ink placeholder:text-faint outline-none focus:border-brand focus:ring-4 focus:ring-brand/15 transition';
  const monoCls = `${inputCls} font-mono text-[12.5px]`;
  const labelCls = 'block text-[12.5px] font-medium text-ink mb-1';

  const SectionHead: React.FC<{ icon: React.ReactNode; title: string; sub: string; right?: React.ReactNode }> = ({ icon, title, sub, right }) => (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="w-8 h-8 rounded-lg bg-brand-soft text-brand flex items-center justify-center shrink-0">
          {icon}
        </span>
        <div className="min-w-0">
          <h3 className="text-[14px] font-semibold text-ink leading-tight">{title}</h3>
          <p className="text-[12px] text-muted leading-snug">{sub}</p>
        </div>
      </div>
      {right}
    </div>
  );

  const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label: string }> = ({ checked, onChange, label }) => (
    <label className="flex items-center gap-2 text-[12.5px] font-medium text-muted cursor-pointer select-none shrink-0">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`w-9 h-5 rounded-full p-0.5 transition-colors cursor-pointer ${checked ? 'bg-brand' : 'bg-border-strong'}`}
      >
        <span
          className={`block w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-4' : 'translate-x-0'}`}
        />
      </button>
      {label}
    </label>
  );

  return (
    <form onSubmit={handleSave} className="space-y-4">
      <PageHeader
        eyebrow="Workspace"
        title="Settings & integrations"
        description="Credentials stay blank until you're ready. Sound chimes, browser notifications, 1-click Google Calendar links, and .ics alarms work with zero keys."
        actions={
          <Button type="submit" variant="primary" disabled={currentUser.role !== 'admin'}>
            <Save className="w-4 h-4" />
            Save all settings
          </Button>
        }
      />

      {savedToast && (
        <div className="p-3.5 rounded-xl bg-success-bg border border-success-border text-success-text text-[13px] font-medium flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{savedToast}</span>
        </div>
      )}

      {/* Integration cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card className="p-4 sm:p-5 space-y-4">
          <SectionHead
            icon={<Send className="w-4 h-4" />}
            title="Telegram admin copy"
            sub="Bots are per-user now (each member connects their own in My Alerts) — this is only the address that receives copies"
          />
          <div className="space-y-3">
            <div>
              <label className={labelCls}>Admin chat ID <span className="text-faint font-normal">(receives all team reminders)</span></label>
              <input
                type="text"
                value={form.telegramAdminChatId}
                onChange={(e) => setForm((prev) => ({ ...prev, telegramAdminChatId: e.target.value }))}
                placeholder="e.g. 987654321"
                className={monoCls}
              />
            </div>
          </div>
        </Card>

        <Card className="p-4 sm:p-5 space-y-4">
          <SectionHead
            icon={<Mail className="w-4 h-4" />}
            title="Email admin copy"
            sub="Senders are per-user now (each member connects their own in My Alerts) — this is only the address that receives copies"
          />
          <div className="space-y-3">
            <div>
              <label className={labelCls}>Admin notification email</label>
              <input
                type="email"
                value={form.emailAdminAddress}
                onChange={(e) => setForm((prev) => ({ ...prev, emailAdminAddress: e.target.value }))}
                placeholder="you@company.com"
                className={inputCls}
              />
            </div>
          </div>
        </Card>

        <Card className="p-4 sm:p-5 space-y-4">
          <SectionHead
            icon={<Calendar className="w-4 h-4" />}
            title="Calendar sync"
            sub="1-click Google Calendar & .ics work now — OAuth below is optional"
            right={<Badge tone="green">1-click active</Badge>}
          />
          <div className="space-y-3">
            <div>
              <label className={labelCls}>Google OAuth client ID <span className="text-faint font-normal">(optional)</span></label>
              <input
                type="text"
                value={form.googleClientId}
                onChange={(e) => setForm((prev) => ({ ...prev, googleClientId: e.target.value }))}
                placeholder="xxxx.apps.googleusercontent.com"
                className={monoCls}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Client secret</label>
                <input
                  type="password"
                  value={form.googleClientSecret}
                  onChange={(e) => setForm((prev) => ({ ...prev, googleClientSecret: e.target.value }))}
                  placeholder="GOCSPX-..."
                  className={monoCls}
                />
              </div>
              <div>
                <label className={labelCls}>Target calendar ID</label>
                <input
                  type="text"
                  value={form.googleCalendarId}
                  onChange={(e) => setForm((prev) => ({ ...prev, googleCalendarId: e.target.value }))}
                  placeholder="primary"
                  className={monoCls}
                />
              </div>
            </div>
          </div>
        </Card>

        <Card className="p-4 sm:p-5 space-y-4">
          <SectionHead
            icon={<Smartphone className="w-4 h-4" />}
            title="Sound & web push"
            sub="Alert timing and optional VAPID keys for background push"
          />
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg bg-canvas border border-line">
              <Toggle checked={form.playSoundOnDue} onChange={(v) => setForm((p) => ({ ...p, playSoundOnDue: v }))} label="Chime when a reminder becomes due" />
              <label className="flex items-center gap-2 text-[12.5px] text-muted font-medium">
                Warn before
                <select
                  value={form.reminderLeadMinutes}
                  onChange={(e) => setForm((prev) => ({ ...prev, reminderLeadMinutes: Number(e.target.value) }))}
                  className="h-8 rounded-lg border border-line bg-surface px-2 text-[12.5px] font-medium text-ink outline-none focus:border-brand focus:ring-4 focus:ring-brand/15"
                >
                  <option value={5}>5 mins</option>
                  <option value={15}>15 mins</option>
                  <option value={30}>30 mins</option>
                </select>
              </label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>VAPID public key</label>
                <input
                  type="text"
                  value={form.vapidPublicKey}
                  onChange={(e) => setForm((prev) => ({ ...prev, vapidPublicKey: e.target.value }))}
                  placeholder="Optional"
                  className={monoCls}
                />
              </div>
              <div>
                <label className={labelCls}>VAPID private key</label>
                <input
                  type="password"
                  value={form.vapidPrivateKey}
                  onChange={(e) => setForm((prev) => ({ ...prev, vapidPrivateKey: e.target.value }))}
                  placeholder="Optional"
                  className={monoCls}
                />
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Customizers */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card className="p-4 sm:p-5 space-y-3">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-brand-soft text-brand flex items-center justify-center">
              <Palette className="w-4 h-4" />
            </span>
            <h3 className="text-[14px] font-semibold text-ink">Color tag meanings</h3>
          </div>
          <div className="space-y-2">
            {form.colorTags.map((c) => (
              <div key={c.id} className="flex items-center gap-2.5">
                <span className="w-28 shrink-0 h-8 px-2 rounded-lg text-[12px] font-semibold flex items-center gap-1.5 border border-line bg-canvas text-ink">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: c.dotHex }} />
                  <span className="truncate">{c.name}</span>
                </span>
                <input
                  type="text"
                  value={c.meaning}
                  onChange={(e) => updateColorMeaning(c.id, e.target.value)}
                  aria-label={`${c.name} meaning`}
                  className={inputCls}
                />
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-8 h-8 rounded-lg bg-success-bg text-success-text flex items-center justify-center shrink-0">
                <MessageCircle className="w-4 h-4" />
              </span>
              <div className="min-w-0">
                <h3 className="text-[14px] font-semibold text-ink leading-tight">WhatsApp templates</h3>
                <p className="text-[12px] text-muted">{'{{Business Name}}, {{City}}, {{Niche}}, {{Rating}}'}</p>
              </div>
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={addWaTemplate}>
              <Plus className="w-3.5 h-3.5" /> Add
            </Button>
          </div>

          <div className="space-y-2.5 max-h-64 overflow-y-auto pr-0.5">
            {form.whatsappTemplates.map((tpl) => (
              <div key={tpl.id} className="p-3 rounded-lg border border-line bg-canvas/60 space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={tpl.name}
                    onChange={(e) => updateWaTemplate(tpl.id, 'name', e.target.value)}
                    aria-label="Template name"
                    className="h-8 flex-1 rounded-lg border border-line bg-surface px-2.5 text-[13px] font-semibold text-ink outline-none focus:border-brand min-w-0"
                  />
                  <button
                    type="button"
                    onClick={() => removeWaTemplate(tpl.id)}
                    aria-label={`Delete ${tpl.name}`}
                    className="p-1.5 rounded-lg text-danger-text hover:bg-danger-bg transition cursor-pointer shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <textarea
                  rows={2}
                  value={tpl.content}
                  onChange={(e) => updateWaTemplate(tpl.id, 'content', e.target.value)}
                  aria-label={`${tpl.name} content`}
                  className="w-full p-2 rounded-lg border border-line bg-surface text-[13px] text-ink outline-none focus:border-brand resize-y"
                />
              </div>
            ))}
          </div>

          <div className="pt-3 border-t border-line space-y-2">
            <span className="text-[12.5px] font-semibold text-ink block">Lead status options</span>
            <div className="flex flex-wrap gap-1.5">
              {form.statusOptions.map((st) => (
                <span key={st} className="inline-flex items-center gap-1 h-7 pl-2.5 pr-1.5 rounded-lg bg-canvas border border-line text-muted text-[12.5px] font-medium">
                  {st}
                  <button
                    type="button"
                    onClick={() => setForm((prev) => ({ ...prev, statusOptions: prev.statusOptions.filter((s) => s !== st) }))}
                    aria-label={`Remove status ${st}`}
                    className="w-5 h-5 rounded-md text-faint hover:text-danger-text hover:bg-danger-bg transition cursor-pointer text-[14px] leading-none"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={newStatusOption}
                onChange={(e) => setNewStatusOption(e.target.value)}
                placeholder="Add custom status..."
                className={inputCls}
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  if (newStatusOption.trim()) {
                    setForm((prev) => ({ ...prev, statusOptions: [...prev.statusOptions, newStatusOption.trim()] }));
                    setNewStatusOption('');
                  }
                }}
              >
                Add
              </Button>
            </div>
          </div>
        </Card>
      </div>

      {logs.length > 0 && (
        <Card className="p-4 sm:p-5 space-y-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">
            Recent outbound attempts ({logs.length})
          </h3>
          <div className="space-y-1.5 max-h-40 overflow-y-auto">
            {logs.map((l) => (
              <div key={l.id} className="flex flex-wrap items-center justify-between gap-2 p-2 rounded-lg bg-canvas border border-line text-[12.5px]">
                <div className="min-w-0">
                  <Badge tone="purple" className="mr-2">{l.channel}</Badge>
                  <span className="font-semibold text-ink">{l.subject}</span>
                  <span className="text-muted ml-2">→ {l.recipient}</span>
                </div>
                <span className="text-[12px] text-muted">
                  {l.status === 'sent' ? 'Sent' : `${l.error_detail || l.status}`}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </form>
  );
};
