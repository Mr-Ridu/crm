import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronRight, MapPin, Search, Users } from 'lucide-react';
import type { DistrictBoard, DistrictCampaign, User } from '../types.ts';
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  InlineAlert,
  ModalHeader,
  ModalShell,
  PageHeader,
  SegmentedTabs,
  Stat,
  TextInput,
} from './ui.tsx';
import { apiFetch } from '../utils/api.ts';

type DistrictFilter = 'all' | 'unassigned' | 'open';

interface DistrictLead {
  id: number;
  businessName: string;
  status: string;
  colorTag: string;
  phone: string;
  city: string;
  lotName: string;
  handledByName: string | null;
  handledByAvatarColor: string | null;
}

function statusTone(status: string): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  const s = String(status || '').toLowerCase();
  if (!s || s === 'new') return 'neutral';
  if (s.includes('closed') || s.includes('interested') || s.includes('meeting')) return 'success';
  if (s.includes('not interested')) return 'danger';
  if (s.includes('no answer') || s.includes('back')) return 'warning';
  return 'info';
}

const FILTERS: { id: DistrictFilter; label: string }[] = [
  { id: 'all', label: 'All districts' },
  { id: 'unassigned', label: 'Unassigned' },
  { id: 'open', label: 'Leads left' },
];

export const DistrictsView: React.FC<{
  users: User[];
  currentUser: User;
  onOpenLead: (id: number) => void;
}> = ({ users, currentUser, onOpenLead }) => {
  const isAdmin = currentUser.role === 'admin';

  const [campaigns, setCampaigns] = useState<DistrictCampaign[]>([]);
  const [campaign, setCampaign] = useState<string | null>(null);
  const [board, setBoard] = useState<DistrictBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<DistrictFilter>('all');

  const [openDistrict, setOpenDistrict] = useState<string | null>(null);
  const [districtLeads, setDistrictLeads] = useState<DistrictLead[]>([]);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');

  const loadCampaigns = useCallback(async () => {
    const resp = await apiFetch('/api/districts/campaigns');
    if (!resp.ok) {
      setError('Could not load the campaigns.');
      setLoading(false);
      return;
    }
    const list: DistrictCampaign[] = await resp.json();
    setCampaigns(list);
    setCampaign((prev) => (prev !== null && list.some((c) => c.key === prev) ? prev : list[0]?.key ?? ''));
    if (list.length === 0) setLoading(false);
  }, []);

  useEffect(() => {
    loadCampaigns();
  }, [loadCampaigns]);

  const loadBoard = useCallback(async (key: string) => {
    setLoading(true);
    setError('');
    const resp = await apiFetch(`/api/districts?campaign=${encodeURIComponent(key)}`);
    if (resp.ok) {
      setBoard(await resp.json());
    } else {
      setError('Could not load the district board.');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (campaign !== null) loadBoard(campaign);
  }, [campaign, loadBoard]);

  // Leads of the open district (loaded lazily — the board itself is aggregate only).
  useEffect(() => {
    if (openDistrict === null || campaign === null) {
      setDistrictLeads([]);
      return;
    }
    let alive = true;
    setLeadsLoading(true);
    apiFetch(
      `/api/districts/leads?campaign=${encodeURIComponent(campaign)}&district=${encodeURIComponent(openDistrict)}`
    )
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => {
        if (alive) setDistrictLeads(rows);
      })
      .catch(() => {
        if (alive) setDistrictLeads([]);
      })
      .finally(() => {
        if (alive) setLeadsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [openDistrict, campaign]);

  const assign = async (district: string, userId: number | null) => {
    if (campaign === null) return;
    setSaving(true);
    setNotice('');
    const resp = await apiFetch('/api/districts/assign', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaign, district, userId }),
    });
    const data = await resp.json().catch(() => ({}));
    setSaving(false);
    if (!resp.ok) {
      setNotice(data.error || 'Could not save the allocation.');
      return;
    }
    await loadBoard(campaign);
  };

  const openRow = useMemo(() => {
    if (!board || openDistrict === null) return null;
    for (const division of board.divisions) {
      const found = division.districts.find((d) => d.name === openDistrict);
      if (found) return found;
    }
    return null;
  }, [board, openDistrict]);

  const districtsPerMember = useMemo(() => {
    const counts = new Map<number, number>();
    board?.divisions.forEach((division) =>
      division.districts.forEach((d) => {
        if (d.assignedUser) {
          counts.set(d.assignedUser.id, (counts.get(d.assignedUser.id) || 0) + 1);
        }
      })
    );
    return counts;
  }, [board]);

  // Members first, then admins — the people who actually work the leads.
  const assignableUsers = useMemo(
    () =>
      [...users].sort((a, b) => {
        if (a.role !== b.role) return a.role === 'member' ? -1 : 1;
        return a.name.localeCompare(b.name);
      }),
    [users]
  );

  const visibleDivisions = useMemo(() => {
    if (!board) return [];
    const q = search.trim().toLowerCase();
    return board.divisions
      .map((division) => ({
        ...division,
        districts: division.districts.filter((d) => {
          if (q && !d.name.toLowerCase().includes(q)) return false;
          if (filter === 'unassigned' && d.assignedUser) return false;
          if (filter === 'open' && !(d.total > 0 && d.remaining > 0)) return false;
          return true;
        }),
      }))
      .filter((division) => division.districts.length > 0);
  }, [board, search, filter]);

  const totals = board?.totals;

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Coverage"
        title="District allocation"
        description="Every niche divides the same 64 districts. One district belongs to one member, so nobody calls the same shops twice — and you can always see what is finished and what is left."
      />

      {error && <InlineAlert tone="danger">{error}</InlineAlert>}

      {campaigns.length === 0 && !loading ? (
        <Card>
          <EmptyState
            icon={<MapPin className="w-5 h-5" />}
            title="No leads to map yet"
            description="Upload a spreadsheet first — districts are worked out from the lead's address and lot name."
          />
        </Card>
      ) : (
        <>
          {/* Campaign (niche) switcher */}
          <div className="overflow-x-auto no-scrollbar -mx-1 px-1">
            <SegmentedTabs
              options={campaigns.map((c) => ({
                id: c.key,
                label: (
                  <span className="inline-flex items-center gap-1.5">
                    {c.label}
                    <span className="tnum text-[11px] font-semibold text-faint">{c.leadCount}</span>
                  </span>
                ),
              }))}
              value={campaign ?? ''}
              onChange={(id) => {
                setCampaign(id);
                setOpenDistrict(null);
                setNotice('');
              }}
            />
          </div>

          {/* Summary */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
            <Stat
              label="Districts covered"
              value={`${totals?.covered ?? 0} / ${totals?.districts ?? 64}`}
            />
            <Stat label="Districts assigned" value={totals?.assigned ?? 0} tone="brand" />
            <Stat label="Leads done" value={totals?.done ?? 0} tone="success" />
            <Stat label="Leads remaining" value={totals?.remaining ?? 0} tone="warning" />
          </div>

          {/* Search + filters */}
          <Card className="p-3">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <div className="relative flex-1 min-w-0">
                <Search className="w-3.5 h-3.5 text-faint absolute left-3 top-1/2 -translate-y-1/2" />
                <TextInput
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search a district…"
                  aria-label="Search districts"
                  className="w-full pl-8"
                />
              </div>
              <div className="overflow-x-auto no-scrollbar">
                <SegmentedTabs options={FILTERS} value={filter} onChange={(id) => setFilter(id as DistrictFilter)} />
              </div>
            </div>
          </Card>

          {loading && (
            <p className="text-[13px] text-muted animate-pulse px-1">Loading districts…</p>
          )}

          {/* Division grids */}
          <div className="space-y-3">
            {visibleDivisions.map((division) => {
              const divisionAssigned = division.districts.filter((d) => d.assignedUser).length;
              return (
                <Card key={division.name} className="p-3 sm:p-4">
                  <div className="flex items-center justify-between gap-2 mb-2.5">
                    <h3 className="text-[13px] font-semibold text-ink flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-brand" />
                      {division.name}
                    </h3>
                    <span className="text-[11px] text-faint tnum">
                      {divisionAssigned}/{division.districts.length} assigned
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                    {division.districts.map((district) => {
                      const pct = district.total > 0 ? Math.round((district.done / district.total) * 100) : 0;
                      const mine = district.assignedUser?.id === currentUser.id;
                      const complete = district.total > 0 && district.remaining === 0;
                      return (
                        <button
                          key={district.name}
                          type="button"
                          onClick={() => {
                            setOpenDistrict(district.name);
                            setNotice('');
                          }}
                          className={`w-full text-left rounded-lg border p-2.5 transition cursor-pointer hover:border-brand-border hover:bg-brand-soft/30 ${
                            mine ? 'border-brand-border bg-brand-soft/40' : 'border-line bg-surface'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-[13px] font-semibold text-ink flex items-center gap-1.5 min-w-0">
                              <span className="truncate">{district.name}</span>
                              {complete && <CheckCircle2 className="w-3.5 h-3.5 text-success-text shrink-0" />}
                            </span>
                            <span className="shrink-0">
                              {district.total > 0 ? (
                                <Badge tone={complete ? 'success' : 'neutral'}>{district.total} leads</Badge>
                              ) : (
                                <span className="text-[11px] text-faint">no leads</span>
                              )}
                            </span>
                          </div>

                          {district.total > 0 && (
                            <div className="mt-2 h-1.5 rounded-full bg-navy-soft overflow-hidden">
                              <div
                                className="h-full rounded-full bg-success-text/70"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          )}

                          <div className="mt-2 flex items-center justify-between gap-2">
                            <span className="text-[11px] text-muted tnum truncate">
                              {district.total > 0
                                ? `${district.done} done · ${district.remaining} left`
                                : 'Not started'}
                            </span>
                            {district.assignedUser ? (
                              <span className="inline-flex items-center gap-1 shrink-0 max-w-[55%]">
                                <Avatar
                                  name={district.assignedUser.name}
                                  color={district.assignedUser.avatarColor}
                                  size="xs"
                                />
                                <span className="text-[11px] font-medium text-ink truncate">
                                  {district.assignedUser.name}
                                </span>
                              </span>
                            ) : (
                              <span className="text-[11px] font-medium text-faint shrink-0">Unassigned</span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </Card>
              );
            })}

            {!loading && visibleDivisions.length === 0 && (
              <Card>
                <EmptyState
                  icon={<Search className="w-5 h-5" />}
                  title="No district matches this filter"
                  description="Clear the search or switch back to “All districts”."
                />
              </Card>
            )}
          </div>

          {/* Leads whose district could not be detected */}
          {board && board.unmatched.total > 0 && (
            <Card className="p-3 sm:p-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-ink">District not detected</p>
                  <p className="text-[12px] text-muted mt-0.5">
                    {board.unmatched.total} leads ({board.unmatched.remaining} left) — no district in the
                    lot name or address. Rename the lot with the district name to include them.
                  </p>
                  <p className="text-[11px] text-faint mt-1 truncate">
                    {board.unmatched.cities.join(' · ')}
                  </p>
                </div>
                <Button variant="secondary" size="sm" onClick={() => setOpenDistrict('__none')}>
                  View leads
                  <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            </Card>
          )}
        </>
      )}

      {/* District panel: owner + leads that are done / left */}
      {openDistrict !== null && (
        <ModalShell onClose={() => setOpenDistrict(null)} maxWidth="max-w-2xl" label="District details">
          <ModalHeader
            title={openDistrict === '__none' ? 'District not detected' : openDistrict}
            description={`${board?.campaign.label ?? ''} campaign · ${
              openDistrict === '__none'
                ? `${board?.unmatched.total ?? 0} leads`
                : `${openRow?.total ?? 0} leads · ${openRow?.done ?? 0} done · ${openRow?.remaining ?? 0} left`
            }`}
            onClose={() => setOpenDistrict(null)}
          />

          <div className="px-4 sm:px-6 py-4 overflow-y-auto space-y-5">
            {notice && <InlineAlert tone="danger">{notice}</InlineAlert>}

            {openDistrict !== '__none' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-faint flex items-center gap-1">
                    <Users className="w-3 h-3" /> Assigned to
                  </p>
                  {openRow?.assignedUser && isAdmin && (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => assign(openDistrict, null)}
                      className="text-[12px] font-medium text-danger-text hover:underline cursor-pointer disabled:opacity-50"
                    >
                      Unassign
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {assignableUsers.map((user) => {
                    const active = openRow?.assignedUser?.id === user.id;
                    const count = districtsPerMember.get(user.id) || 0;
                    return (
                      <button
                        key={user.id}
                        type="button"
                        disabled={!isAdmin || saving}
                        onClick={() => assign(openDistrict, user.id)}
                        className={`h-11 px-2.5 rounded-lg border text-[13px] font-medium flex items-center gap-2 transition text-left ${
                          active
                            ? 'border-brand-border bg-brand-soft text-brand-active'
                            : 'border-line bg-surface text-ink hover:border-brand-border disabled:hover:border-line'
                        } ${isAdmin ? 'cursor-pointer' : 'cursor-default'} disabled:opacity-70`}
                      >
                        <Avatar name={user.name} color={user.avatarColor} size="xs" />
                        <span className="flex-1 min-w-0 truncate">
                          {user.name}
                          {user.role === 'admin' && <span className="text-[11px] text-faint"> · admin</span>}
                        </span>
                        <span className="text-[11px] text-faint tnum shrink-0">{count} dist.</span>
                        {active && <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />}
                      </button>
                    );
                  })}
                </div>

                {!isAdmin && (
                  <p className="text-[12px] text-muted">Only an admin can change who owns a district.</p>
                )}
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">
                  Leads ({districtLeads.length})
                </p>
                <span className="text-[11px] text-faint">Untouched first</span>
              </div>

              {leadsLoading ? (
                <p className="text-[13px] text-muted animate-pulse py-3">Loading leads…</p>
              ) : districtLeads.length === 0 ? (
                <p className="text-[13px] text-muted py-3">No leads in this district yet.</p>
              ) : (
                <div className="divide-y divide-line rounded-lg border border-line overflow-hidden">
                  {districtLeads.map((lead) => (
                    <button
                      key={lead.id}
                      type="button"
                      onClick={() => {
                        setOpenDistrict(null);
                        onOpenLead(lead.id);
                      }}
                      className="w-full text-left px-3 py-2.5 hover:bg-navy-soft/50 transition flex items-center gap-2 cursor-pointer"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium text-ink truncate">{lead.businessName}</p>
                        <p className="text-[11px] text-faint truncate">
                          {lead.lotName}
                          {lead.city ? ` · ${lead.city}` : ''}
                        </p>
                      </div>
                      <Badge tone={statusTone(lead.status)}>{lead.status || 'New'}</Badge>
                      {lead.handledByName && (
                        <Avatar
                          name={lead.handledByName}
                          color={lead.handledByAvatarColor || undefined}
                          size="xs"
                        />
                      )}
                      <ChevronRight className="w-3.5 h-3.5 text-faint shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </ModalShell>
      )}
    </div>
  );
};
