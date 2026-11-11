import React, { useState, useEffect } from 'react';
import { Save, Send, Mail, CheckCircle2 } from 'lucide-react';
import type { User } from '../types.ts';
import { Button, PageHeader, Card } from './ui.tsx';
import { apiFetch } from '../utils/api.ts';

interface MyNotifs {
  telegramEnabled: boolean;
  telegramBotToken: string;
  telegramChatId: string;
  emailEnabled: boolean;
  emailProvider: string;
  emailApiKey: string;
  emailSmtpHost: string;
  emailFrom: string;
  loginEmail: string;
}

const EMPTY: MyNotifs = {
  telegramEnabled: false,
  telegramBotToken: '',
  telegramChatId: '',
  emailEnabled: false,
  emailProvider: 'resend',
  emailApiKey: '',
  emailSmtpHost: '',
  emailFrom: '',
  loginEmail: '',
};

export const MyNotificationsView: React.FC<{ currentUser: User }> = ({ currentUser }) => {
  const [form, setForm] = useState<MyNotifs>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const resp = await apiFetch('/api/profile/notifications');
      if (resp.ok) setForm({ ...EMPTY, ...(await resp.json()) });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [currentUser.id]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 5000);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const resp = await apiFetch('/api/profile/notifications', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await resp.json();
      showToast(resp.ok ? 'Your notification settings are saved!' : data.error || 'Could not save');
    } catch {
      showToast('Cannot reach the server');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (channel: 'telegram' | 'email') => {
    await apiFetch('/api/profile/notifications', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const resp = await apiFetch('/api/notifications/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ testChannel: channel }),
    });
    const data = await resp.json();
    showToast(
      data.ok
        ? `Test ${channel} sent from YOUR sender — check your phone/inbox!`
        : `Not sent: ${data.reason || 'fill in your credentials first'}`
    );
  };

  const inputCls =
    'w-full h-9 rounded-lg border border-line bg-surface px-3 text-[13px] text-ink placeholder:text-faint outline-none focus:border-brand focus:ring-4 focus:ring-brand/15 transition';
  const monoCls = `${inputCls} font-mono text-[12.5px]`;
  const labelCls = 'block text-[12.5px] font-medium text-ink mb-1';

  const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label: string }> = ({
    checked,
    onChange,
    label,
  }) => (
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

  if (loading) {
    return <p className="text-[13px] text-muted animate-pulse">Loading your notification settings…</p>;
  }

  return (
    <form onSubmit={handleSave} className="space-y-4">
      <PageHeader
        eyebrow="Personal"
        title="My Alerts"
        description="Your OWN Telegram bot and email sender — reminders for your leads go out from here straight to your phone. Nobody else sees these keys."
        actions={
          <Button type="submit" variant="primary" disabled={saving}>
            <Save className="w-4 h-4" />
            {saving ? 'Saving…' : 'Save my settings'}
          </Button>
        }
      />

      {toast && (
        <div className="p-3.5 rounded-xl bg-success-bg border border-success-border text-success-text text-[13px] font-medium flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{toast}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card className="p-4 sm:p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="w-8 h-8 rounded-lg bg-brand-soft text-brand flex items-center justify-center shrink-0">
                <Send className="w-4 h-4" />
              </span>
              <div className="min-w-0">
                <h3 className="text-[14px] font-semibold text-ink leading-tight">My Telegram</h3>
                <p className="text-[12px] text-muted leading-snug">
                  1. Chat with @BotFather → /newbot → copy the token. 2. Chat with @userinfobot → copy your chat ID.
                </p>
              </div>
            </div>
            <Toggle
              checked={form.telegramEnabled}
              onChange={(v) => setForm((p) => ({ ...p, telegramEnabled: v }))}
              label="Enabled"
            />
          </div>
          <div className="space-y-3">
            <div>
              <label className={labelCls}>My bot token</label>
              <input
                type="password"
                value={form.telegramBotToken}
                onChange={(e) => setForm((p) => ({ ...p, telegramBotToken: e.target.value }))}
                placeholder="123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ"
                className={monoCls}
                autoComplete="off"
              />
            </div>
            <div>
              <label className={labelCls}>My chat ID <span className="text-faint font-normal">(where you receive)</span></label>
              <input
                type="text"
                value={form.telegramChatId}
                onChange={(e) => setForm((p) => ({ ...p, telegramChatId: e.target.value }))}
                placeholder="e.g. 987654321"
                className={monoCls}
              />
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={() => handleTest('telegram')}>
              Send me a test message
            </Button>
          </div>
        </Card>

        <Card className="p-4 sm:p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="w-8 h-8 rounded-lg bg-brand-soft text-brand flex items-center justify-center shrink-0">
                <Mail className="w-4 h-4" />
              </span>
              <div className="min-w-0">
                <h3 className="text-[14px] font-semibold text-ink leading-tight">My Email sender</h3>
                <p className="text-[12px] text-muted leading-snug">
                  Get a free key at resend.com (or point a webhook URL). Alerts arrive from your sender.
                </p>
              </div>
            </div>
            <Toggle
              checked={form.emailEnabled}
              onChange={(v) => setForm((p) => ({ ...p, emailEnabled: v }))}
              label="Enabled"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Provider</label>
              <select
                value={form.emailProvider}
                onChange={(e) => setForm((p) => ({ ...p, emailProvider: e.target.value }))}
                className={inputCls}
              >
                <option value="resend">Resend API</option>
                <option value="webhook">Custom webhook URL</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>API key</label>
              <input
                type="password"
                value={form.emailApiKey}
                onChange={(e) => setForm((p) => ({ ...p, emailApiKey: e.target.value }))}
                placeholder="re_..."
                className={monoCls}
                autoComplete="off"
              />
            </div>
            <div>
              <label className={labelCls}>Webhook URL <span className="text-faint font-normal">(if webhook)</span></label>
              <input
                type="text"
                value={form.emailSmtpHost}
                onChange={(e) => setForm((p) => ({ ...p, emailSmtpHost: e.target.value }))}
                placeholder="https://..."
                className={monoCls}
              />
            </div>
            <div>
              <label className={labelCls}>From address</label>
              <input
                type="text"
                value={form.emailFrom}
                onChange={(e) => setForm((p) => ({ ...p, emailFrom: e.target.value }))}
                placeholder="My CRM <alerts@mydomain.com>"
                className={inputCls}
              />
            </div>
          </div>
          <p className="text-[12px] text-muted">
            Test + reminder emails go to your login email: <strong className="text-ink">{form.loginEmail}</strong>
          </p>
          <Button type="button" variant="secondary" size="sm" onClick={() => handleTest('email')}>
            Send me a test email
          </Button>
        </Card>
      </div>
    </form>
  );
};
