import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Table2,
  Layers,
  Bell,
  Users,
  Settings,
  Upload,
  LogOut,
  Clock,
  Phone,
  AlertCircle,
  Volume2,
  Sun,
  Moon,
  Send,
} from 'lucide-react';
import type {
  User,
  Lot,
  Lead,
  Reminder,
  IntegrationSettings,
} from './types.ts';
import { DEFAULT_INTEGRATION_SETTINGS } from './types.ts';
import { LeadsTableView } from './components/LeadsTableView.tsx';
import { LeadDetailModal } from './components/LeadDetailModal.tsx';
import { UploadLotModal } from './components/UploadLotModal.tsx';
import { LotsAccessView } from './components/LotsAccessView.tsx';
import { RemindersCenterView } from './components/RemindersCenterView.tsx';
import { TeamAndAnalyticsView } from './components/TeamAndAnalyticsView.tsx';
import { SettingsIntegrationsView } from './components/SettingsIntegrationsView.tsx';
import { Button, IconButton, Badge, Avatar } from './components/ui.tsx';
import { InstallAppButton } from './components/InstallAppButton.tsx';
import { MyNotificationsView } from './components/MyNotificationsView.tsx';
import {
  playNotificationChime,
  triggerBrowserPushNotification,
  formatRelativeTime,
} from './utils/helpers.ts';
import { getInitialTheme, applyTheme, type ThemeMode } from './utils/theme.ts';
import { authHeaders, getToken, setToken, clearToken, apiFetch } from './utils/api.ts';

type NavTab = 'leads' | 'lots' | 'reminders' | 'alerts' | 'team' | 'settings';

export function App() {
  const [users, setUsers] = useState<User[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<NavTab>('leads');

  const [lots, setLots] = useState<Lot[]>([]);
  const [selectedLotId, setSelectedLotId] = useState<number | null>(null);
  // Bumped to make the server-paginated Leads table refetch (edits/imports).
  const [leadsRefreshKey, setLeadsRefreshKey] = useState(0);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [settings, setSettings] = useState<IntegrationSettings>(DEFAULT_INTEGRATION_SETTINGS);

  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showBellDropdown, setShowBellDropdown] = useState(false);
  const bellRef = useRef<HTMLDivElement | null>(null);

  // The reminders popover closes on an outside click or Escape.
  useEffect(() => {
    if (!showBellDropdown) return;
    const onPointerDown = (e: PointerEvent) => {
      if (bellRef.current?.contains(e.target as Node)) return;
      setShowBellDropdown(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowBellDropdown(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [showBellDropdown]);
  const [liveAlertToast, setLiveAlertToast] = useState<Reminder | null>(null);

  // Auth state: nobody sees anything without a valid login session.
  const [authChecked, setAuthChecked] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);

  // Register Service Worker for PWA install & phone push notifications
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);

  // Dark / light theme (persisted, system default, no-flash via index.html)
  const [theme, setTheme] = useState<ThemeMode>(() => getInitialTheme());
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Load user list (needs an active session; used by Team & lot access views)
  const fetchUsers = useCallback(async () => {
    if (!getToken()) return;
    const resp = await apiFetch('/api/users');
    if (resp.ok) {
      setUsers(await resp.json());
    }
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore — still clear local state
    }
    clearToken();
    setCurrentUser(null);
    setUsers([]);
    setLots([]);
    setReminders([]);
    setSelectedLotId(null);
    setSelectedLeadId(null);
    setActiveTab('leads');
  }, []);

  // Boot: restore saved session, otherwise stay logged out (no auto-login).
  useEffect(() => {
    (async () => {
      if (getToken()) {
        try {
          const resp = await apiFetch('/api/auth/me');
          if (resp.ok) {
            const data = await resp.json();
            setCurrentUser(data.user);
            await fetchUsers();
          } else {
            clearToken();
          }
        } catch {
          clearToken();
        }
      }
      setAuthChecked(true);
    })();
  }, [fetchUsers]);

  // Any 401 from the API means the session died -> back to login page.
  useEffect(() => {
    const onUnauthorized = () => {
      if (getToken()) handleLogout();
    };
    window.addEventListener('leadflow:unauthorized', onUnauthorized);
    return () => window.removeEventListener('leadflow:unauthorized', onUnauthorized);
  }, [handleLogout]);

  // NOTE: all hooks must stay above the early returns below — adding a hook
  // after them crashes React (#310) the moment login state changes.
  const isAdmin = !!currentUser && currentUser.role === 'admin';

  // Members landing on a stale admin tab (e.g. role changed mid-session) bounce to Leads.
  useEffect(() => {
    if (currentUser && !isAdmin && (activeTab === 'team' || activeTab === 'settings')) {
      setActiveTab('leads');
    }
  }, [currentUser, isAdmin, activeTab]);

  const fetchAllData = useCallback(async () => {
    if (!currentUser) return;
    const headers = { ...authHeaders() };

    // NOTE: leads are fetched page-by-page inside LeadsTableView (server
    // pagination) — fetching them all here would defeat that at 50k+ scale.
    const [lotsResp, remResp, setResp] = await Promise.all([
      fetch('/api/lots', { headers }),
      fetch('/api/reminders', { headers }),
      fetch('/api/settings', { headers }),
    ]);

    if (lotsResp.ok) setLots(await lotsResp.json());
    if (remResp.ok) setReminders(await remResp.json());
    if (setResp.ok) setSettings(await setResp.json());
    setLeadsRefreshKey((k) => k + 1);
  }, [currentUser]);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  // Background Reminder Watcher: Checks every 20 seconds for due/upcoming reminders
  useEffect(() => {
    if (!currentUser || reminders.length === 0) return;

    const checkDueReminders = async () => {
      const now = Date.now();
      const leadWindowMs = (settings.reminderLeadMinutes || 15) * 60000;

      for (const rem of reminders) {
        if (rem.status !== 'pending' || rem.notifiedInApp) continue;
        const dueTime = new Date(rem.remindAt).getTime();
        if (dueTime - now <= leadWindowMs) {
          // Trigger in-app popup + sound + browser push
          setLiveAlertToast(rem);
          if (settings.playSoundOnDue) {
            playNotificationChime();
          }
          triggerBrowserPushNotification(
            `🔔 ${rem.reminderType.toUpperCase()} Reminder: ${rem.businessName}`,
            `${rem.title} (${rem.leadPhone})`
          );

          await fetch(`/api/reminders/${rem.id}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              ...authHeaders(),
            },
            body: JSON.stringify({ notifiedInApp: true }),
          });
          fetchAllData();
          break;
        }
      }
    };

    const timer = setInterval(checkDueReminders, 20000);
    return () => clearInterval(timer);
  }, [reminders, currentUser, settings, fetchAllData]);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setLoginBusy(true);
    try {
      const resp = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setLoginError(data.error || 'Login failed');
        return;
      }
      setToken(data.token);
      setCurrentUser(data.user);
      setLoginEmail('');
      setLoginPassword('');
      setSelectedLotId(null);
      setActiveTab('leads');
      await fetchUsers();
    } catch {
      setLoginError('Cannot reach the server. Check your connection.');
    } finally {
      setLoginBusy(false);
    }
  };

  const handleQuickUpdateLead = async (leadId: number, patch: Partial<Lead>) => {
    if (!currentUser) return;
    await fetch(`/api/leads/${leadId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
      },
      body: JSON.stringify(patch),
    });
    fetchAllData();
  };

  const handleSaveSettings = async (next: IntegrationSettings) => {
    if (!currentUser) return;
    const resp = await fetch('/api/settings', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
      },
      body: JSON.stringify(next),
    });
    if (resp.ok) {
      setSettings(await resp.json());
    }
  };

  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-navy text-white">
        <div className="animate-pulse text-sm font-medium">Loading LeadFlow CRM...</div>
      </div>
    );
  }

  // Full login page: no session -> nothing else renders, nothing is fetched.
  if (!currentUser) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-navy px-4">
        <div className="w-full max-w-sm rounded-2xl bg-surface border border-line shadow-pop p-6 sm:p-8 space-y-5">
          <div className="flex flex-col items-center text-center gap-2">
            <img
              src="/logo.png"
              alt="LeadFlow CRM"
              className="h-16 w-auto rounded-xl bg-white px-4 py-2 ring-1 ring-line"
            />
            <p className="text-[13px] text-muted">Sign in to your workspace</p>
          </div>
          {loginError && (
            <div className="px-3 py-2.5 rounded-lg bg-danger-bg border border-danger-border text-danger-text text-[13px] font-medium">
              {loginError}
            </div>
          )}
          <form onSubmit={handleLoginSubmit} className="space-y-3">
            <div>
              <label htmlFor="login-email" className="block text-[12px] font-semibold text-ink mb-1">
                Email
              </label>
              <input
                id="login-email"
                type="email"
                required
                autoComplete="username"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder="you@company.com"
                className="h-10 px-3 w-full rounded-lg border border-line bg-surface text-[14px] text-ink placeholder:text-faint"
              />
            </div>
            <div>
              <label htmlFor="login-password" className="block text-[12px] font-semibold text-ink mb-1">
                Password
              </label>
              <input
                id="login-password"
                type="password"
                required
                autoComplete="current-password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="••••••••"
                className="h-10 px-3 w-full rounded-lg border border-line bg-surface text-[14px] text-ink placeholder:text-faint"
              />
            </div>
            <Button variant="primary" type="submit" disabled={loginBusy} className="w-full h-10">
              {loginBusy ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </div>
      </div>
    );
  }

  const pendingReminders = reminders.filter((r) => r.status === 'pending');
  const dueOrOverdueReminders = pendingReminders.filter(
    (r) => new Date(r.remindAt).getTime() <= Date.now() + 15 * 60000
  );

  const totalLotLeads = lots.reduce((acc, l) => acc + (l.leadCount || 0), 0);

  const navItems: { id: NavTab; label: string; icon: React.ReactNode; badge?: React.ReactNode }[] = [
    {
      id: 'leads',
      label: 'Leads',
      icon: <Table2 className="w-4 h-4" />,
      badge: <span className="tnum text-[11px] font-semibold text-muted">{totalLotLeads}</span>,
    },
    {
      id: 'lots',
      label: 'Data Lots',
      icon: <Layers className="w-4 h-4" />,
      badge: <span className="tnum text-[11px] font-semibold text-muted">{lots.length}</span>,
    },
    {
      id: 'reminders',
      label: 'Reminders',
      icon: <Bell className="w-4 h-4" />,
      badge:
        pendingReminders.length > 0 ? (
          <span
            className={`tnum inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-md text-[11px] font-semibold ${
              dueOrOverdueReminders.length > 0
                ? 'bg-danger-bg text-danger-text'
                : 'bg-warning-bg text-warning-text'
            }`}
          >
            {pendingReminders.length}
          </span>
        ) : undefined,
    },
    { id: 'alerts', label: 'My Alerts', icon: <Send className="w-4 h-4" /> },
    { id: 'team', label: 'Team', icon: <Users className="w-4 h-4" /> },
    { id: 'settings', label: 'Settings', icon: <Settings className="w-4 h-4" /> },
  ];

  // Team & Settings are admin-only. My Alerts belongs to everyone.
  const workspaceNav = navItems.slice(0, 4);
  const manageNav = isAdmin ? navItems.slice(4) : [];
  const mobileNav = isAdmin ? navItems : navItems.slice(0, 4);

  const pageTitles: Record<NavTab, { title: string; sub: string }> = {
    leads: { title: 'Leads', sub: `${totalLotLeads} records in workspace` },
    lots: { title: 'Data Lots', sub: `${lots.length} lots · role-based access` },
    reminders: {
      title: 'Reminders',
      sub: `${pendingReminders.length} pending · ${dueOrOverdueReminders.length} due soon`,
    },
    alerts: { title: 'My Alerts', sub: 'Your own Telegram & email sender' },
    team: { title: 'Team & Analytics', sub: `${users.length} accounts` },
    settings: { title: 'Settings', sub: 'Notifications, calendar & workspace' },
  };

  return (
    <div className="min-h-screen bg-canvas text-ink lg:flex">
      {/* ---------- Sidebar (desktop) ---------- */}
      <aside className="hidden lg:flex w-60 shrink-0 flex-col bg-surface border-r border-line sticky top-0 h-screen">
        <div className="flex items-center px-5 h-16 border-b border-line">
          <img
            src="/logo.png"
            alt="LeadFlow CRM"
            className="h-9 w-auto rounded-lg bg-white px-2.5 py-1 ring-1 ring-line"
          />
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5" aria-label="Primary">
          <div>
            <p className="px-2 mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">
              Workspace
            </p>
            <div className="space-y-0.5">
              {workspaceNav.map((item) => {
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveTab(item.id)}
                    aria-current={active ? 'page' : undefined}
                    className={`w-full h-9 px-2.5 rounded-lg text-[13px] font-medium flex items-center gap-2.5 transition cursor-pointer ${
                      active
                        ? 'bg-brand-soft text-brand-active'
                        : 'text-muted hover:text-ink hover:bg-navy-soft/60'
                    }`}
                  >
                    <span className={active ? 'text-brand' : 'text-faint'}>{item.icon}</span>
                    <span className="flex-1 text-left">{item.label}</span>
                    {item.badge}
                  </button>
                );
              })}
            </div>
          </div>

          {manageNav.length > 0 && (
          <div>
            <p className="px-2 mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">
              Manage
            </p>
            <div className="space-y-0.5">
              {manageNav.map((item) => {
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveTab(item.id)}
                    aria-current={active ? 'page' : undefined}
                    className={`w-full h-9 px-2.5 rounded-lg text-[13px] font-medium flex items-center gap-2.5 transition cursor-pointer ${
                      active
                        ? 'bg-brand-soft text-brand-active'
                        : 'text-muted hover:text-ink hover:bg-navy-soft/60'
                    }`}
                  >
                    <span className={active ? 'text-brand' : 'text-faint'}>{item.icon}</span>
                    <span className="flex-1 text-left">{item.label}</span>
                    {item.badge}
                  </button>
                );
              })}
            </div>
          </div>
          )}
        </nav>

        <div className="p-3 border-t border-line">
          <div className="flex items-center gap-2.5 px-2 py-1">
            <Avatar name={currentUser.name} color={currentUser.avatarColor} size="sm" />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-ink truncate">{currentUser.name}</p>
              <p className="text-[11px] text-muted capitalize">{currentUser.role}</p>
            </div>
            <IconButton
              label="Log out"
              size="sm"
              onClick={handleLogout}
              className="border-0"
            >
              <LogOut className="w-4 h-4" />
            </IconButton>
          </div>
          <p className="px-2 pt-1.5 text-[11px] text-faint">
            {currentUser.role === 'admin'
              ? `Admin · ${lots.length} lots`
              : `Member · ${lots.length} assigned lot${lots.length === 1 ? '' : 's'}`}
          </p>
        </div>
      </aside>

      {/* ---------- Main column ---------- */}
      <div className="flex-1 min-w-0 flex flex-col min-h-screen">
        {/* Top header */}
        <header className="bg-surface border-b border-line sticky top-0 z-30">
          <div className="px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              {/* Compact brand on mobile (sidebar is hidden) */}
              <img
                src="/logo.png"
                alt="LeadFlow CRM"
                className="lg:hidden h-8 w-auto rounded-md bg-white px-1.5 py-0.5 ring-1 ring-line shrink-0"
              />
              <div className="min-w-0">
                <h1 className="text-[16px] font-semibold tracking-tight text-ink leading-tight truncate">
                  {pageTitles[activeTab].title}
                </h1>
                <p className="hidden sm:block text-[12px] text-muted leading-tight truncate">
                  {pageTitles[activeTab].sub}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              <InstallAppButton />
              {currentUser.role === 'admin' && (
                <Button variant="primary" onClick={() => setShowUploadModal(true)}>
                  <Upload className="w-4 h-4" />
                  <span className="hidden sm:inline">Upload XLSX / CSV</span>
                  <span className="sm:hidden">Upload</span>
                </Button>
              )}

              {/* Dark / light toggle */}
              <IconButton
                label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
              >
                {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </IconButton>

              {/* Reminder bell */}
              <div ref={bellRef} className="relative">
                <IconButton
                  label="Upcoming call and meeting reminders"
                  onClick={() => setShowBellDropdown((v) => !v)}
                  className={`relative ${dueOrOverdueReminders.length > 0 ? 'border-danger-border text-danger-text' : ''}`}
                >
                  <Bell className="w-4 h-4" />
                  {pendingReminders.length > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-md bg-danger-bg text-danger-text border border-danger-border text-[11px] font-semibold flex items-center justify-center tnum">
                      {pendingReminders.length}
                    </span>
                  )}
                </IconButton>

                {showBellDropdown && (
                  <div className="absolute right-0 mt-2 w-[min(20rem,calc(100vw-1.5rem))] sm:w-96 rounded-xl bg-surface shadow-pop border border-line p-4 z-40 space-y-3">
                    <div className="flex items-center justify-between border-b border-line pb-2">
                      <span className="text-[13px] font-semibold text-ink">
                        Upcoming reminders ({pendingReminders.length})
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setShowBellDropdown(false);
                          setActiveTab('reminders');
                        }}
                        className="text-[12px] font-medium text-brand hover:text-brand-hover cursor-pointer"
                      >
                        Open Reminder Center →
                      </button>
                    </div>

                    <div className="max-h-72 overflow-y-auto space-y-2">
                      {pendingReminders.length === 0 ? (
                        <p className="text-[13px] text-muted text-center py-4">
                          No pending call or meeting reminders.
                        </p>
                      ) : (
                        pendingReminders.map((r) => {
                          const overdue = new Date(r.remindAt).getTime() <= Date.now();
                          return (
                            <div
                              key={r.id}
                              onClick={() => {
                                setShowBellDropdown(false);
                                setSelectedLeadId(r.leadId);
                              }}
                              className="p-3 rounded-lg border border-line hover:bg-navy-soft/40 text-[13px] cursor-pointer transition"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-semibold text-ink truncate">
                                  {r.businessName}
                                </span>
                                <Badge tone={overdue ? 'danger' : 'warning'}>
                                  {formatRelativeTime(r.remindAt)}
                                </Badge>
                              </div>
                              <p className="text-muted mt-0.5 truncate">{r.title}</p>
                              <div className="flex items-center justify-between text-[12px] text-faint mt-1">
                                <span>{r.userName}</span>
                                <span className="tnum">{r.leadPhone}</span>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Compact user chip (mobile + desktop) */}
              <div className="flex lg:hidden items-center">
                <Avatar name={currentUser.name} color={currentUser.avatarColor} size="sm" />
              </div>
            </div>
          </div>

          {/* Mobile navigation (sidebar is hidden below lg) */}
          <nav
            className="flex lg:hidden overflow-x-auto no-scrollbar border-t border-line px-3 py-1.5 gap-1"
            aria-label="Primary mobile"
          >
            {mobileNav.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                aria-current={activeTab === item.id ? 'page' : undefined}
                className={`h-8 px-3 rounded-lg text-[13px] font-medium whitespace-nowrap flex items-center gap-1.5 ${
                  activeTab === item.id
                    ? 'bg-brand-soft text-brand-active'
                    : 'text-muted'
                }`}
              >
                {item.label}
                {item.badge}
              </button>
            ))}
            <button
              type="button"
              onClick={handleLogout}
              className="h-8 px-3 rounded-lg text-[13px] font-medium whitespace-nowrap text-muted"
            >
              Log out
            </button>
          </nav>
        </header>

        {/* Due / overdue notice (restrained) */}
        {dueOrOverdueReminders.length > 0 && (
          <div className="bg-warning-bg border-b border-warning-border px-4 sm:px-6 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-[13px] text-warning-text min-w-0">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span className="truncate">
                  <strong className="font-semibold">{dueOrOverdueReminders[0].title}</strong>
                  {' — '}
                  {dueOrOverdueReminders[0].businessName} is due{' '}
                  {formatRelativeTime(dueOrOverdueReminders[0].remindAt)}
                  {dueOrOverdueReminders.length > 1 &&
                    ` (+${dueOrOverdueReminders.length - 1} more)`}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button size="sm" variant="ghost" onClick={() => playNotificationChime()}>
                  <Volume2 className="w-3.5 h-3.5" /> Chime
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setSelectedLeadId(dueOrOverdueReminders[0].leadId)}
                >
                  Open lead
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Live toast when a reminder triggers */}
        {liveAlertToast && (
          <div className="fixed bottom-3 left-3 right-3 sm:bottom-5 sm:left-auto sm:right-5 z-50 w-auto sm:w-[calc(100vw-2.5rem)] max-w-sm rounded-xl bg-navy text-white p-4 shadow-pop space-y-3 animate-fade-in">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 text-warning-text text-[12px] font-semibold uppercase tracking-wide">
                <Clock className="w-4 h-4" />
                Reminder due
              </div>
              <button
                type="button"
                onClick={() => setLiveAlertToast(null)}
                aria-label="Dismiss reminder alert"
                className="text-slate-400 hover:text-white text-xs"
              >
                ✕
              </button>
            </div>
            <div>
              <p className="text-[14px] font-semibold">{liveAlertToast.title}</p>
              <p className="text-[12px] text-slate-300">
                {liveAlertToast.businessName} • {liveAlertToast.leadPhone}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="primary"
                className="flex-1"
                onClick={() => {
                  setSelectedLeadId(liveAlertToast.leadId);
                  setLiveAlertToast(null);
                }}
              >
                Open lead details
              </Button>
              {liveAlertToast.leadPhone && (
                <a
                  href={`tel:${liveAlertToast.leadPhone}`}
                  className="h-8 px-3 rounded-lg bg-surface/10 text-white text-[13px] font-medium flex items-center gap-1.5 hover:bg-surface/20"
                >
                  <Phone className="w-3.5 h-3.5" /> Call
                </a>
              )}
            </div>
          </div>
        )}

        {/* Main content */}
        <main className="flex-1 w-full max-w-[1200px] mx-auto px-3 sm:px-6 py-4 sm:py-6 overflow-x-clip">
          {activeTab === 'leads' && (
            <LeadsTableView
              lots={lots}
              selectedLotId={selectedLotId}
              onSelectLotId={(id) => setSelectedLotId(id)}
              currentUser={currentUser}
              settings={settings}
              onOpenLead={(id) => setSelectedLeadId(id)}
              onOpenUploadModal={() => setShowUploadModal(true)}
              onQuickUpdateLead={handleQuickUpdateLead}
              refreshKey={leadsRefreshKey}
            />
          )}

          {activeTab === 'lots' && (
            <LotsAccessView
              lots={lots}
              users={users}
              currentUser={currentUser}
              onRefresh={() => {
                fetchUsers();
                fetchAllData();
              }}
              onOpenLotLeads={(lotId) => {
                setSelectedLotId(lotId);
                setActiveTab('leads');
              }}
              onOpenUploadModal={() => setShowUploadModal(true)}
            />
          )}

          {activeTab === 'reminders' && (
            <RemindersCenterView
              reminders={reminders}
              currentUser={currentUser}
              settings={settings}
              onRefresh={fetchAllData}
              onOpenLead={(id) => setSelectedLeadId(id)}
            />
          )}

          {activeTab === 'alerts' && <MyNotificationsView currentUser={currentUser} />}

          {activeTab === 'team' && isAdmin && (
            <TeamAndAnalyticsView
              users={users}
              lots={lots}
              currentUser={currentUser}
              settings={settings}
              onRefresh={() => {
                fetchUsers();
                fetchAllData();
              }}
            />
          )}

          {activeTab === 'settings' && isAdmin && (
            <SettingsIntegrationsView
              settings={settings}
              currentUser={currentUser}
              onSaveSettings={handleSaveSettings}
            />
          )}
        </main>
      </div>

      {/* Lead Row Click Popup Drawer */}
      <LeadDetailModal
        leadId={selectedLeadId}
        onClose={() => setSelectedLeadId(null)}
        currentUser={currentUser}
        settings={settings}
        onLeadUpdated={fetchAllData}
      />

      {/* Upload Spreadsheet (.xlsx, .csv, .ods) Modal */}
      <UploadLotModal
        isOpen={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        lots={lots}
        users={users}
        currentUserId={currentUser.id}
        onImportSuccess={(newLotId) => {
          setSelectedLotId(newLotId);
          setActiveTab('leads');
          fetchAllData();
        }}
      />

    </div>
  );
}
export default App;
