import React, { useState, useEffect } from 'react';
import {
  Users,
  UserPlus,
  BarChart3,
  CheckCircle2,
  Trash2,
  Layers,
  MessageSquare,
  Flame,
  Bell,
  Search,
  Plus,
} from 'lucide-react';
import type { User, Lot, IntegrationSettings } from '../types.ts';
import { Button, IconButton, Badge, PageHeader, Card, Avatar, Modal, ModalShell, ModalHeader, Stat } from './ui.tsx';
import { authHeaders } from '../utils/api.ts';

interface TeamAndAnalyticsViewProps {
  users: User[];
  lots: Lot[];
  currentUser: User;
  settings: IntegrationSettings;
  onRefresh: () => void;
}

export const TeamAndAnalyticsView: React.FC<TeamAndAnalyticsViewProps> = ({
  users,
  lots,
  currentUser,
  settings,
  onRefresh,
}) => {
  const [analytics, setAnalytics] = useState<any>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  // Lot-access manager modal (for members with many lots, the inline badges
  // would blow up the row height — the modal holds every lot with search).
  const [lotModalUserId, setLotModalUserId] = useState<number | null>(null);
  const [lotSearch, setLotSearch] = useState('');
  const lotModalUser = users.find((u) => u.id === lotModalUserId) ?? null;

  // Add Member Form
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [role, setRole] = useState<'member' | 'admin'>('member');
  const [selectedLots, setSelectedLots] = useState<number[]>([]);
  const [error, setError] = useState('');

  const fetchAnalytics = async () => {
    const resp = await fetch('/api/analytics', {
      headers: { ...authHeaders() },
    });
    if (resp.ok) {
      setAnalytics(await resp.json());
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, [currentUser.id, users, lots]);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const colors = ['#059669', '#d97706', '#db2777', '#2563eb', '#7c3aed', '#0891b2'];
    const avatarColor = colors[users.length % colors.length];

    const resp = await fetch('/api/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
      },
      body: JSON.stringify({
        name,
        email,
        password,
        role,
        phone,
        telegramChatId,
        avatarColor,
        assignedLotIds: selectedLots,
      }),
    });

    const data = await resp.json();
    if (!resp.ok) {
      setError(data.error || 'Could not create user');
      return;
    }

    setName('');
    setEmail('');
    setPassword('');
    setPhone('');
    setTelegramChatId('');
    setSelectedLots([]);
    setShowAddModal(false);
    onRefresh();
  };

  const handleToggleLotForUser = async (u: User, lotId: number) => {
    if (currentUser.role !== 'admin') return;
    const currentIds = u.assignedLotIds || [];
    const nextIds = currentIds.includes(lotId)
      ? currentIds.filter((id) => id !== lotId)
      : [...currentIds, lotId];

    await fetch(`/api/users/${u.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
      },
      body: JSON.stringify({ assignedLotIds: nextIds }),
    });
    onRefresh();
  };

  const handleDeleteUser = async (u: User) => {
    if (!window.confirm(`Remove team member ${u.name}?`)) return;
    await fetch(`/api/users/${u.id}`, {
      method: 'DELETE',
      headers: { ...authHeaders() },
    });
    onRefresh();
  };

  const inputCls =
    'h-9 w-full rounded-lg border border-line bg-surface px-3 text-[13px] text-ink placeholder:text-faint outline-none focus:border-brand focus:ring-4 focus:ring-brand/15 transition';

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Team"
        title="Team & performance"
        description="Who's handling what — accounts, lot access, and per-member output."
        actions={
          currentUser.role === 'admin' ? (
            <Button variant="primary" onClick={() => setShowAddModal(true)}>
              <UserPlus className="w-4 h-4" />
              Add team member
            </Button>
          ) : undefined
        }
      />

      {/* KPI Cards */}
      {analytics && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <Stat label="Total leads" value={analytics.totalLeads} />
          <Stat label="Fresh / uncontacted" value={analytics.newLeads} tone="green" />
          <Stat label="Contacted by team" value={analytics.contactedLeads} tone="purple" />
          <Stat label="Meetings scheduled" value={analytics.meetingsScheduled} tone="blue" />
          <Stat label="Interested / proposals" value={analytics.interestedLeads} tone="amber" />
        </div>
      )}

      {/* Team Members & Lot Permissions Section */}
      <Card className="p-0 overflow-hidden">
        <div className="px-4 sm:px-5 py-4 border-b border-line">
          <h2 className="text-[15px] font-semibold text-ink flex items-center gap-2">
            <Users className="w-4 h-4 text-brand" />
            Accounts & lot access
          </h2>
          <p className="mt-0.5 text-[12.5px] text-muted">
            Click a lot badge to grant or revoke access, or use Manage for many lots at once.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-[13px] min-w-[880px]">
            <thead>
              <tr className="border-b border-line">
                <th className="py-2.5 px-4 font-semibold text-[11px] uppercase tracking-[0.07em] text-faint">Member</th>
                <th className="py-2.5 px-4 font-semibold text-[11px] uppercase tracking-[0.07em] text-faint">Role</th>
                <th className="py-2.5 px-4 font-semibold text-[11px] uppercase tracking-[0.07em] text-faint">Assigned lots</th>
                <th className="py-2.5 px-4 font-semibold text-[11px] uppercase tracking-[0.07em] text-faint text-center">Handled</th>
                <th className="py-2.5 px-4 font-semibold text-[11px] uppercase tracking-[0.07em] text-faint text-center">Comments</th>
                <th className="py-2.5 px-4 font-semibold text-[11px] uppercase tracking-[0.07em] text-faint text-center">Hot / mtgs</th>
                <th className="py-2.5 px-4 font-semibold text-[11px] uppercase tracking-[0.07em] text-faint text-center">Pending</th>
                {currentUser.role === 'admin' && (
                  <th className="py-2.5 px-4 font-semibold text-[11px] uppercase tracking-[0.07em] text-faint text-right">Actions</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {users.map((u) => {
                const perf = analytics?.byMember?.find((m: any) => m.id === u.id);
                const assignedLots = lots
                  .filter((lot) => (u.assignedLotIds || []).includes(lot.id))
                  .sort((a, b) => a.name.localeCompare(b.name));
                const openLotManager = () => {
                  setLotModalUserId(u.id);
                  setLotSearch('');
                };
                return (
                  <tr key={u.id} className="hover:bg-canvas/60 transition">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={u.name} color={u.avatarColor} size="sm" />
                        <div className="min-w-0">
                          <p className="font-semibold text-ink truncate">{u.name}</p>
                          <p className="text-[12px] text-muted truncate">
                            {u.email} {u.phone ? `· ${u.phone}` : ''}
                          </p>
                        </div>
                      </div>
                    </td>

                    <td className="py-3 px-4">
                      <Badge tone={u.role === 'admin' ? 'purple' : 'green'}>{u.role}</Badge>
                    </td>

                    <td className="py-3 px-4">
                      {u.role === 'admin' ? (
                        <span className="text-[12.5px] font-medium text-brand-active">
                          Full access · {lots.length} lots
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-1.5 max-w-[420px] items-center">
                          {/* Only assigned lots are listed inline (capped at 3).
                              All lots — granted or not — live in the Manage modal,
                              so the row height stays the same no matter how many
                              lots exist. */}
                          {assignedLots.slice(0, 3).map((lot) => (
                            <button
                              key={lot.id}
                              type="button"
                              disabled={currentUser.role !== 'admin'}
                              onClick={() => handleToggleLotForUser(u, lot.id)}
                              aria-pressed={true}
                              className="h-7 px-2 rounded-lg text-[12px] font-medium border flex items-center gap-1.5 transition cursor-pointer disabled:cursor-default bg-brand text-white border-brand"
                              title="Click to revoke access to this lot"
                            >
                              <Layers className="w-3 h-3" />
                              <span className="truncate max-w-[140px]">{lot.name}</span>
                            </button>
                          ))}
                          {assignedLots.length > 3 && (
                            <button
                              type="button"
                              onClick={openLotManager}
                              className="h-7 px-2 rounded-lg text-[12px] font-semibold bg-surface text-muted border border-line hover:text-ink hover:border-faint transition cursor-pointer"
                              title={`Show all ${assignedLots.length} assigned lots`}
                            >
                              +{assignedLots.length - 3} more
                            </button>
                          )}
                          {assignedLots.length === 0 && (
                            <span className="text-[12px] text-faint">No lots assigned yet</span>
                          )}
                          {currentUser.role === 'admin' && (
                            <button
                              type="button"
                              onClick={openLotManager}
                              className="h-7 px-2 rounded-lg text-[12px] font-medium border border-dashed border-line text-faint hover:text-muted hover:border-faint transition flex items-center gap-1 cursor-pointer"
                              title="Manage this member's lot access"
                            >
                              <Plus className="w-3 h-3" />
                              Manage
                            </button>
                          )}
                        </div>
                      )}
                    </td>

                    <td className="py-3 px-4 text-center font-semibold text-ink tnum">
                      {perf?.leadsHandled || 0}
                    </td>

                    <td className="py-3 px-4 text-center">
                      <span className="inline-flex items-center gap-1 text-[12px] font-medium text-muted">
                        <MessageSquare className="w-3.5 h-3.5 text-faint" />
                        <span className="tnum">{perf?.commentsAdded || 0}</span>
                      </span>
                    </td>

                    <td className="py-3 px-4 text-center">
                      <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-success-text">
                        <Flame className="w-3.5 h-3.5" />
                        <span className="tnum">{perf?.hotOrMeetings || 0}</span>
                      </span>
                    </td>

                    <td className="py-3 px-4 text-center">
                      <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-warning-text">
                        <Bell className="w-3.5 h-3.5" />
                        <span className="tnum">{perf?.pendingReminders || 0}</span>
                      </span>
                    </td>

                    {currentUser.role === 'admin' && (
                      <td className="py-3 px-4 text-right">
                        {u.id !== currentUser.id && (
                          <IconButton
                            label={`Delete ${u.name}`}
                            onClick={() => handleDeleteUser(u)}
                            className="text-danger-text border-danger-border hover:bg-danger-bg"
                          >
                            <Trash2 className="w-4 h-4" />
                          </IconButton>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Lot-access manager — every lot with grant/revoke toggles, searchable.
          Opened from the "Manage" / "+N more" chip in the Assigned lots column. */}
      {lotModalUser && currentUser.role === 'admin' && (
        <ModalShell
          onClose={() => setLotModalUserId(null)}
          label={`Lot access for ${lotModalUser.name}`}
          maxWidth="max-w-lg"
        >
          <ModalHeader
            onClose={() => setLotModalUserId(null)}
            title={`Lot access — ${lotModalUser.name}`}
            description="Click a lot to grant or revoke access. Assigned lots are listed first."
          />
          <div className="p-5 sm:p-6 flex-1 flex flex-col gap-4 min-h-0">
            <div className="relative shrink-0">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
              <input
                type="text"
                value={lotSearch}
                onChange={(e) => setLotSearch(e.target.value)}
                placeholder="Search lots…"
                className="w-full h-10 pl-9 pr-3 rounded-xl bg-surface border border-line text-[13px] text-ink placeholder:text-faint focus:outline-none focus:border-brand focus:ring-4 focus:ring-brand/15"
              />
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-1">
              {lots.length === 0 && (
                <p className="text-[13px] text-muted text-center py-6">
                  No lots yet — create one from the Lots tab first.
                </p>
              )}
              {[...lots]
                .filter((lot) =>
                  lot.name.toLowerCase().includes(lotSearch.trim().toLowerCase())
                )
                .sort((a, b) => {
                  const ids = lotModalUser.assignedLotIds || [];
                  const ga = ids.includes(a.id) ? 0 : 1;
                  const gb = ids.includes(b.id) ? 0 : 1;
                  return ga - gb || a.name.localeCompare(b.name);
                })
                .map((lot) => {
                  const granted = (lotModalUser.assignedLotIds || []).includes(lot.id);
                  return (
                    <button
                      key={lot.id}
                      type="button"
                      onClick={() => handleToggleLotForUser(lotModalUser, lot.id)}
                      aria-pressed={granted}
                      className={`w-full h-9 px-3 rounded-lg text-[13px] font-medium border flex items-center gap-2 transition cursor-pointer ${
                        granted
                          ? 'bg-brand text-white border-brand'
                          : 'bg-surface text-faint border-line hover:text-muted'
                      }`}
                    >
                      <Layers className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate flex-1 text-left">{lot.name}</span>
                      {granted ? (
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                      ) : (
                        <Plus className="w-4 h-4 shrink-0" />
                      )}
                    </button>
                  );
                })}
            </div>
            <p className="text-[12px] text-faint text-center shrink-0">
              {(lotModalUser.assignedLotIds || []).length} of {lots.length} lots assigned
            </p>
          </div>
        </ModalShell>
      )}

      {/* Breakdown by Status & Color Tag */}
      {analytics && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Card className="p-4 sm:p-5 space-y-3">
            <h3 className="text-[14px] font-semibold text-ink flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-brand" /> Pipeline by status
            </h3>
            <div className="space-y-2.5">
              {analytics.byStatus.map((item: any) => {
                const pct =
                  analytics.totalLeads > 0
                    ? Math.round((item.count / analytics.totalLeads) * 100)
                    : 0;
                return (
                  <div key={item.status} className="space-y-1 text-[12.5px]">
                    <div className="flex justify-between font-medium text-muted">
                      <span className="text-ink">{item.status}</span>
                      <span className="tnum">
                        {item.count} · {pct}%
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-canvas overflow-hidden">
                      <div
                        className="h-full bg-brand rounded-full transition-[width]"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card className="p-4 sm:p-5 space-y-3">
            <h3 className="text-[14px] font-semibold text-ink flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-success-text" /> Leads by color tag
            </h3>
            <div className="space-y-2.5">
              {analytics.byColor.map((item: any) => {
                const tagObj =
                  settings.colorTags.find((c) => c.id === item.colorTag) ||
                  settings.colorTags[0];
                const pct =
                  analytics.totalLeads > 0
                    ? Math.round((item.count / analytics.totalLeads) * 100)
                    : 0;
                return (
                  <div key={item.colorTag} className="space-y-1 text-[12.5px]">
                    <div className="flex justify-between font-medium text-muted">
                      <span className="flex items-center gap-1.5 text-ink">
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: tagObj.dotHex }}
                        />
                        {tagObj.name}
                        <span className="text-faint font-normal">· {tagObj.meaning}</span>
                      </span>
                      <span className="tnum">
                        {item.count} · {pct}%
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-canvas overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: tagObj.dotHex,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      )}

      {/* Modal to Add New Team Member */}
      <Modal open={showAddModal} onClose={() => setShowAddModal(false)} title="Create team member account" wide>
        {error && (
          <div className="p-3 rounded-lg bg-danger-bg border border-danger-border text-danger-text text-[12.5px] font-medium">
            {error}
          </div>
        )}
        <form onSubmit={handleCreateUser} className="space-y-3 text-[13px]">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="block font-medium text-ink">Full name *</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Michael Scott"
                className={inputCls}
              />
            </div>
            <div className="space-y-1">
              <label className="block font-medium text-ink">Login email *</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="michael@leadflow.io"
                className={inputCls}
              />
            </div>
            <div className="space-y-1">
              <label className="block font-medium text-ink">Password *</label>
              <input
                type="text"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`${inputCls} font-mono`}
              />
            </div>
            <div className="space-y-1">
              <label className="block font-medium text-ink">Role</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as any)}
                className={inputCls}
              >
                <option value="member">Team member (restricted by lot)</option>
                <option value="admin">Admin (full access)</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="block font-medium text-ink">Phone number</label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 555-010-0099"
                className={`${inputCls} tnum`}
              />
            </div>
            <div className="space-y-1">
              <label className="block font-medium text-ink">
                Telegram chat ID <span className="text-faint font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={telegramChatId}
                onChange={(e) => setTelegramChatId(e.target.value)}
                placeholder="Leave blank to set later"
                className={`${inputCls} font-mono`}
              />
            </div>
          </div>

          {role === 'member' && (
            <div className="space-y-1.5">
              <label className="block font-medium text-ink">
                Grant access to data lots
              </label>
              <div className="space-y-1 max-h-36 overflow-y-auto border border-line rounded-lg p-2.5 bg-canvas/50">
                {lots.map((l) => {
                  const checked = selectedLots.includes(l.id);
                  return (
                    <label
                      key={l.id}
                      className="flex items-center gap-2 cursor-pointer text-ink text-[13px] py-0.5"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setSelectedLots((prev) =>
                            prev.includes(l.id)
                              ? prev.filter((id) => id !== l.id)
                              : [...prev, l.id]
                          )
                        }
                        className="rounded border-line text-brand focus:ring-brand/30"
                      />
                      <span className="font-medium">{l.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setShowAddModal(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary">
              Create account
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
