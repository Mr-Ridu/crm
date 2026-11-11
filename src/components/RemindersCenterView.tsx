import React, { useState } from 'react';
import {
  AlarmClock,
  BellRing,
  CheckCircle2,
  Search,
  Phone,
  Building2,
  StickyNote,
  ExternalLink,
  CalendarPlus,
  Trash2,
} from 'lucide-react';
import type { Reminder, User, IntegrationSettings } from '../types.ts';
import { Button, IconButton, Badge, PageHeader, Card, EmptyState } from './ui.tsx';
import { authHeaders } from '../utils/api.ts';
import {
  buildGoogleCalendarUrl,
  downloadIcsReminder,
  formatRelativeTime,
} from '../utils/helpers.ts';

interface RemindersCenterViewProps {
  reminders: Reminder[];
  currentUser: User;
  settings: IntegrationSettings;
  onRefresh: () => void;
  onOpenLead: (leadId: number) => void;
}

export const RemindersCenterView: React.FC<RemindersCenterViewProps> = ({
  reminders,
  currentUser,
  settings,
  onRefresh,
  onOpenLead,
}) => {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'pending' | 'overdue' | 'completed'>('all');

  const normalizedSearch = search.toLowerCase();

  const withStatus = reminders.map((reminder) => {
    const isPast = new Date(reminder.remindAt).getTime() < Date.now();
    const computedStatus = reminder.status === 'completed' ? 'completed' : isPast ? 'overdue' : 'pending';
    return { reminder, computedStatus };
  });

  const filtered = withStatus.filter(({ reminder, computedStatus }) => {
    if (filter !== 'all' && computedStatus !== filter) return false;
    if (!normalizedSearch) return true;
    const hay =
      `${reminder.title} ${reminder.note} ${reminder.businessName} ${reminder.leadPhone}`.toLowerCase();
    return hay.includes(normalizedSearch);
  });

  const pendingCount = withStatus.filter((r) => r.computedStatus === 'pending').length;
  const overdueCount = withStatus.filter((r) => r.computedStatus === 'overdue').length;
  const doneCount = withStatus.filter((r) => r.computedStatus === 'completed').length;

  const tabs: Array<{ key: typeof filter; label: string; count: number }> = [
    { key: 'all', label: 'All', count: reminders.length },
    { key: 'pending', label: 'Upcoming', count: pendingCount },
    { key: 'overdue', label: 'Overdue', count: overdueCount },
    { key: 'completed', label: 'Done', count: doneCount },
  ];

  const handleComplete = async (id: number) => {
    await fetch(`/api/reminders/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
      },
      body: JSON.stringify({ status: 'completed' }),
    });
    onRefresh();
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Delete this reminder?')) return;
    await fetch(`/api/reminders/${id}`, {
      method: 'DELETE',
      headers: { ...authHeaders() },
    });
    onRefresh();
  };

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Follow-ups"
        title="Reminders"
        description={`Calls and meetings you've scheduled — overdue first, then what's next. Chime warns ${settings.reminderLeadMinutes || 15} min before due.`}
      />

      <Card className="p-0 overflow-hidden">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3 px-4 py-3 border-b border-line">
          <div className="flex items-center gap-1 p-0.5 rounded-lg bg-canvas border border-line w-fit max-w-full overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setFilter(tab.key)}
                className={`h-8 px-3 rounded-[7px] text-[13px] font-medium flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap ${
                  filter === tab.key
                    ? 'bg-surface text-ink shadow-sm border border-line'
                    : 'text-muted hover:text-ink'
                }`}
              >
                {tab.label}
                <span
                  className={`min-w-[20px] h-5 px-1 rounded-full text-[11px] font-semibold flex items-center justify-center tnum ${
                    filter === tab.key ? 'bg-brand-soft text-brand-active' : 'bg-canvas text-faint'
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            ))}
          </div>

          <div className="relative lg:ml-auto lg:w-72">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search reminders, notes, businesses…"
              aria-label="Search reminders"
              className="h-9 w-full rounded-lg border border-line bg-surface pl-9 pr-3 text-[13px] text-ink placeholder:text-faint outline-none focus:border-brand focus:ring-4 focus:ring-brand/15 transition"
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 className="w-5 h-5" />}
            title={filter === 'completed' ? 'Nothing done yet' : 'All clear'}
            description={
              reminders.length === 0
                ? 'Schedule a reminder from any lead drawer and it will appear here.'
                : 'No reminders match this filter.'
            }
          />
        ) : (
          <ul className="divide-y divide-line">
            {filtered.map(({ reminder, computedStatus }) => {
              const isOverdue = computedStatus === 'overdue';
              const isDone = computedStatus === 'completed';
              return (
                <li
                  key={reminder.id}
                  className={`px-4 py-3.5 flex flex-col sm:flex-row sm:items-center gap-3 transition ${
                    isDone ? 'opacity-70' : 'hover:bg-canvas/60'
                  }`}
                >
                  <span
                    className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border ${
                      isDone
                        ? 'bg-success-bg text-success-text border-success-border'
                        : isOverdue
                          ? 'bg-danger-bg text-danger-text border-danger-border'
                          : 'bg-brand-soft text-brand border-brand-border'
                    }`}
                  >
                    {isDone ? (
                      <CheckCircle2 className="w-4 h-4" />
                    ) : isOverdue ? (
                      <BellRing className="w-4 h-4" />
                    ) : (
                      <AlarmClock className="w-4 h-4" />
                    )}
                  </span>

                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-[13.5px] font-semibold text-ink">{reminder.title}</span>
                      <Badge tone={isDone ? 'green' : isOverdue ? 'red' : 'purple'}>
                        {isDone ? 'Done' : isOverdue ? 'Overdue' : 'Upcoming'}
                      </Badge>
                      <Badge tone="neutral" title={new Date(reminder.remindAt).toLocaleString()}>
                        {formatRelativeTime(reminder.remindAt)}
                      </Badge>
                      {reminder.notifyAdmin && (
                        <Badge tone="blue" title="Admin is notified">admin pinged</Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-muted min-w-0">
                      <button
                        type="button"
                        onClick={() => onOpenLead(reminder.leadId)}
                        className="inline-flex items-center gap-1.5 font-medium text-ink hover:text-brand-active truncate max-w-full cursor-pointer"
                      >
                        <Building2 className="w-3.5 h-3.5 text-faint shrink-0" />
                        <span className="truncate">{reminder.businessName}</span>
                        <ExternalLink className="w-3 h-3 text-faint shrink-0" />
                      </button>
                      {reminder.leadPhone && (
                        <a
                          href={`tel:${reminder.leadPhone}`}
                          className="inline-flex items-center gap-1.5 hover:text-brand-active"
                        >
                          <Phone className="w-3.5 h-3.5 text-faint" />
                          <span className="tnum">{reminder.leadPhone}</span>
                        </a>
                      )}
                      {reminder.note && (
                        <span className="inline-flex items-center gap-1.5 min-w-0">
                          <StickyNote className="w-3.5 h-3.5 text-faint shrink-0" />
                          <span className="truncate max-w-[320px]">{reminder.note}</span>
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <a
                      href={buildGoogleCalendarUrl({
                        title: reminder.title,
                        details: `Lead: ${reminder.businessName}\nPhone: ${reminder.leadPhone}\nNote: ${reminder.note}`,
                        startIso: reminder.remindAt,
                      })}
                      target="_blank"
                      rel="noreferrer"
                      title="Add to Google Calendar"
                      className="h-8 px-2.5 rounded-lg border border-line text-[12px] font-medium text-muted hover:text-ink inline-flex items-center gap-1.5 transition"
                    >
                      <CalendarPlus className="w-3.5 h-3.5" />
                      GCal
                    </a>
                    <Button
                      variant="ghost"
                      size="sm"
                      title="Download .ics file"
                      onClick={() =>
                        downloadIcsReminder({
                          title: reminder.title,
                          note: reminder.note,
                          remindAt: reminder.remindAt,
                          businessName: reminder.businessName,
                          leadPhone: reminder.leadPhone,
                        })
                      }
                    >
                      .ics
                    </Button>
                    {!isDone && (
                      <Button variant="secondary" size="sm" onClick={() => handleComplete(reminder.id)}>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Done
                      </Button>
                    )}
                    <IconButton label="Delete reminder" onClick={() => handleDelete(reminder.id)}>
                      <Trash2 className="w-4 h-4" />
                    </IconButton>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
};
