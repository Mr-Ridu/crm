import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Search,
  Columns,
  Download,
  Upload,
  Phone,
  MessageCircle,
  Globe,
  Facebook,
  Star,
  Clock,
  RotateCcw,
  Check,
  Bell,
  MessageSquare,
  Sparkles,
  SlidersHorizontal,
  Pencil,
  ChevronDown,
} from 'lucide-react';
import type { Lead, Lot, IntegrationSettings, User } from '../types.ts';
import {
  cleanEmail,
  cleanPhoneForWhatsApp,
  formatRelativeTime,
  renderWhatsAppTemplate,
} from '../utils/helpers.ts';
import { apiFetch } from '../utils/api.ts';
import { Button, Badge, Dot, Card, Select, EmptyState } from './ui.tsx';

interface LeadsTableViewProps {
  lots: Lot[];
  selectedLotId: number | null; // null = All Accessible Lots
  onSelectLotId: (lotId: number | null) => void;
  currentUser: User;
  settings: IntegrationSettings;
  onOpenLead: (leadId: number) => void;
  onOpenUploadModal: () => void;
  onQuickUpdateLead: (leadId: number, patch: Partial<Lead>) => Promise<void>;
  refreshKey: number;
}

import { ChannelSendButton } from './ChannelSendButton.tsx';

export interface ColumnDef {
  id: string;
  label: string;
  defaultVisible: boolean;
  isCore15?: boolean;
}

// All 15 user-specified spreadsheet columns + helpful CRM columns
// By default the list shows only the five columns the team works from.
// Everything else stays available from the Columns menu.
export const ALL_LEAD_COLUMNS: ColumnDef[] = [
  { id: 'colorTag', label: 'Color', defaultVisible: true },
  { id: 'businessName', label: 'Business Name', defaultVisible: true, isCore15: true },
  { id: 'phone', label: 'Phone', defaultVisible: true, isCore15: true },
  { id: 'comment', label: 'Comment (Latest & Count)', defaultVisible: true, isCore15: true },
  { id: 'customMessage', label: 'Customized Message', defaultVisible: true },
  { id: 'status', label: 'Status', defaultVisible: false, isCore15: true },
  { id: 'whatsapp', label: 'WhatsApp', defaultVisible: true, isCore15: true },
  { id: 'city', label: 'City', defaultVisible: false, isCore15: true },
  { id: 'niche', label: 'Niche', defaultVisible: false, isCore15: true },
  { id: 'rating', label: 'Rating', defaultVisible: false, isCore15: true },
  { id: 'reviews', label: 'Reviews', defaultVisible: false, isCore15: true },
  { id: 'email', label: 'Email', defaultVisible: true, isCore15: true },
  { id: 'website', label: 'Website', defaultVisible: false, isCore15: true },
  { id: 'facebook', label: 'Facebook', defaultVisible: false, isCore15: true },
  { id: 'address', label: 'Address', defaultVisible: false, isCore15: true },
  { id: 'source', label: 'Source', defaultVisible: false, isCore15: true },
  { id: 'importedAt', label: 'Imported At', defaultVisible: false, isCore15: true },
  { id: 'lotName', label: 'Data Lot', defaultVisible: false },
  { id: 'handledBy', label: 'Handled By', defaultVisible: false },
  { id: 'nextReminder', label: 'Next Call / Meeting', defaultVisible: false },
];

// Fixed pixel width per column: one long value (a cell holding two phone
// numbers, a 400-character message) must never stretch its column and push the
// rest of the row sideways. Text that does not fit is clipped with an ellipsis.
const COLUMN_WIDTH_PX: Record<string, number> = {
  colorTag: 78,
  businessName: 210,
  phone: 128,
  status: 118,
  whatsapp: 132,
  email: 190,
  comment: 150,
  customMessage: 200,
  website: 96,
  facebook: 100,
  address: 170,
  city: 110,
  niche: 120,
  rating: 84,
  reviews: 88,
  source: 110,
  importedAt: 108,
  lotName: 130,
  handledBy: 140,
  nextReminder: 140,
};
const EXTRA_COLUMN_WIDTH_PX = 160;

// Must mirror the <th>/<td> order below, otherwise the <colgroup> widths shift
// onto the wrong columns.
const TABLE_COLUMN_ORDER = [
  'colorTag',
  'businessName',
  'phone',
  'status',
  'whatsapp',
  'email',
  'comment',
  'customMessage',
  'website',
  'facebook',
  'address',
  'city',
  'niche',
  'rating',
  'reviews',
  'source',
  'importedAt',
  'lotName',
  'handledBy',
  'nextReminder',
];

// Sheet numbers are 11-digit local ones (+880 implied), so only that part is
// shown. Anything else — two numbers jammed in one cell, "Not Found", a short
// fragment — collapses to an ellipsis instead of eating the column.
function displayPhoneDigits(value?: string): string {
  const digits = String(value || '').replace(/[^0-9]/g, '');
  if (!digits) return '—';
  const local = digits.startsWith('880') && digits.length === 13 ? digits.slice(3) : digits;
  if (local.length === 11) return local;
  if (local.length === 10 && local.startsWith('1')) return `0${local}`;
  return '…';
}

export const LeadsTableView: React.FC<LeadsTableViewProps> = ({
  lots,
  selectedLotId,
  onSelectLotId,
  currentUser,
  settings,
  onOpenLead,
  onOpenUploadModal,
  onQuickUpdateLead,
  refreshKey,
}) => {
  // Inline "edit customized message" dialog — the list itself is editable, so a
  // message can be written without opening the whole lead drawer.
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null);
  const [messageDraft, setMessageDraft] = useState('');
  const [savingMessage, setSavingMessage] = useState(false);

  // v2 = new default column set (Business, Phone, WhatsApp, Email, Comment).
  const storageKey = `leadflow_cols_v3_${currentUser.id}`;
  const [visibleCols, setVisibleCols] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) return JSON.parse(saved);
    } catch {
      // fallback
    }
    return ALL_LEAD_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.id);
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(visibleCols));
    } catch {
      // ignore
    }
  }, [visibleCols, storageKey]);

  // Lot-specific spreadsheet columns (headings that are not part of the core
  // 15). They belong to the selected lot only, and are visible by default.
  const extraStorageKey = `leadflow_extra_cols_v1_${currentUser.id}`;
  const [extraVisibility, setExtraVisibility] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem(extraStorageKey);
      return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(extraStorageKey, JSON.stringify(extraVisibility));
    } catch {
      // ignore
    }
  }, [extraVisibility, extraStorageKey]);

  const selectedLot = selectedLotId !== null ? lots.find((l) => l.id === selectedLotId) : undefined;
  const extraColumns = (selectedLot?.columns || []).map((c) => ({
    id: `extra:${c.key}`,
    key: c.key,
    label: c.label,
  }));
  const allColumns: ColumnDef[] = [
    ...ALL_LEAD_COLUMNS,
    ...extraColumns.map((c) => ({
      id: c.id,
      label: c.label,
      defaultVisible: true,
      isCore15: false,
    })),
  ];

  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const columnMenuRef = useRef<HTMLDivElement | null>(null);
  const [showFiltersMenu, setShowFiltersMenu] = useState(false);
  const filtersMenuRef = useRef<HTMLDivElement | null>(null);

  // An outside click or Escape closes the Columns popover — previously it
  // stayed open until the trigger button was pressed a second time.
  useEffect(() => {
    if (!showColumnMenu) return;
    // pointerdown covers mouse and touch, so a tap outside also dismisses it.
    const onPointerDown = (e: PointerEvent) => {
      if (columnMenuRef.current?.contains(e.target as Node)) return;
      setShowColumnMenu(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowColumnMenu(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [showColumnMenu]);

  // Same outside-click / Escape dismissal for the Filters dropdown.
  useEffect(() => {
    if (!showFiltersMenu) return;
    const onPointerDown = (e: PointerEvent) => {
      if (filtersMenuRef.current?.contains(e.target as Node)) return;
      setShowFiltersMenu(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowFiltersMenu(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [showFiltersMenu]);

  // Filter states (applied server-side so 50k+ lead DBs stay fast)
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [filterColor, setFilterColor] = useState('ALL');
  const [filterCity, setFilterCity] = useState('ALL');
  const [filterNiche, setFilterNiche] = useState('ALL');
  const [filterSource, setFilterSource] = useState('ALL');
  const [filterHandledBy, setFilterHandledBy] = useState('ALL');
  const [minRating, setMinRating] = useState('');
  const [onlyWithReminder, setOnlyWithReminder] = useState(false);
  const [onlyUncontactedNew, setOnlyUncontactedNew] = useState(false);
  const [onlyMessaged, setOnlyMessaged] = useState(false);
  const [sortBy, setSortBy] = useState<'newest' | 'rating_desc' | 'reviews_desc' | 'reminder_asc'>(
    'newest'
  );

  // Server-driven page data: only one page of rows lives in the DOM.
  const [rows, setRows] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [facets, setFacets] = useState<{
    cities: string[];
    niches: string[];
    sources: string[];
    handlers: { id: number; name: string }[];
    colorCounts: Record<string, number>;
  }>({ cities: [], niches: [], sources: [], handlers: [], colorCounts: {} });

  // Debounce typing so we don't hammer the server on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setSearchQuery(searchInput.trim()), 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const buildParams = useCallback(
    (overrides: { page?: number; pageSize?: number } = {}) => {
      const sp = new URLSearchParams();
      if (selectedLotId !== null) sp.set('lotId', String(selectedLotId));
      if (searchQuery) sp.set('search', searchQuery);
      if (filterStatus !== 'ALL') sp.set('status', filterStatus);
      if (filterColor !== 'ALL') sp.set('colorTag', filterColor);
      if (filterCity !== 'ALL') sp.set('city', filterCity);
      if (filterNiche !== 'ALL') sp.set('niche', filterNiche);
      if (filterSource !== 'ALL') sp.set('source', filterSource);
      if (filterHandledBy !== 'ALL') sp.set('handledBy', filterHandledBy);
      if (minRating) sp.set('minRating', minRating);
      if (onlyWithReminder) sp.set('hasReminder', '1');
      if (onlyUncontactedNew) sp.set('newOnly', '1');
      if (onlyMessaged) sp.set('messaged', '1');
      sp.set('sort', sortBy);
      sp.set('page', String(overrides.page ?? page));
      sp.set('pageSize', String(overrides.pageSize ?? pageSize));
      return sp;
    },
    [
      selectedLotId,
      searchQuery,
      filterStatus,
      filterColor,
      filterCity,
      filterNiche,
      filterSource,
      filterHandledBy,
      minRating,
      onlyWithReminder,
      onlyUncontactedNew,
      onlyMessaged,
      sortBy,
      page,
      pageSize,
    ]
  );

  // Fetch the current page from the server.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const resp = await apiFetch(`/api/leads?${buildParams().toString()}`);
        if (!resp.ok) return;
        const json = await resp.json();
        if (cancelled) return;
        if (Array.isArray(json)) {
          // Legacy fallback (shouldn't happen with page params set).
          setRows(json);
          setTotal(json.length);
          setTotalPages(1);
        } else {
          setRows(json.data || []);
          setTotal(Number(json.total || 0));
          setTotalPages(Math.max(1, Number(json.totalPages || 1)));
        }
      } catch {
        // keep old rows on transient network errors
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [buildParams, refreshKey]);

  // Any filter/lot/sort/search change restarts from the first page.
  useEffect(() => {
    setPage(1);
  }, [
    selectedLotId,
    filterStatus,
    filterColor,
    filterCity,
    filterNiche,
    filterSource,
    filterHandledBy,
    minRating,
    onlyWithReminder,
    onlyUncontactedNew,
    onlyMessaged,
    searchQuery,
    sortBy,
  ]);

  // Clamp page when totalPages shrinks (e.g. after deletes/imports).
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  // Filter dropdown options from the server (works at 50k+ scale).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const url =
          selectedLotId !== null
            ? `/api/leads/facets?lotId=${selectedLotId}`
            : '/api/leads/facets';
        const resp = await apiFetch(url);
        if (!resp.ok) return;
        const json = await resp.json();
        if (cancelled) return;
        setFacets({
          cities: json.cities || [],
          niches: json.niches || [],
          sources: json.sources || [],
          handlers: json.handlers || [],
          colorCounts: json.colorCounts || {},
        });
      } catch {
        // dropdowns stay empty on error
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedLotId, refreshKey]);

  // Filter dropdown values (server-provided).
  const distinctCities = facets.cities;
  const distinctNiches = facets.niches;
  const distinctSources = facets.sources;
  const distinctHandlers = facets.handlers.map((h) => h.name);

  // Export downloads a server-streamed CSV with the SAME filters as the table,
  // so 100k+ row exports never eat browser memory.
  const handleExportAll = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const sp = buildParams();
      sp.delete('page');
      sp.delete('pageSize');
      sp.set('format', 'csv');
      const resp = await apiFetch(`/api/leads/export?${sp.toString()}`);
      if (!resp.ok) throw new Error('Export request failed');
      const blob = await resp.blob();
      const cd = resp.headers.get('Content-Disposition') || '';
      const m = /filename="([^"]+)"/.exec(cd);
      const filename = m
        ? m[1]
        : `leads_export_${new Date().toISOString().slice(0, 10)}.csv`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch {
      // table stays as-is; user can retry
    } finally {
      setExporting(false);
    }
  };

  const resetFilters = () => {
    setSearchInput('');
    setSearchQuery('');
    setFilterStatus('ALL');
    setFilterColor('ALL');
    setFilterCity('ALL');
    setFilterNiche('ALL');
    setFilterSource('ALL');
    setFilterHandledBy('ALL');
    setMinRating('');
    setOnlyWithReminder(false);
    setOnlyUncontactedNew(false);
    setSortBy('newest');
    setPage(1);
  };

  const toggleColumn = (colId: string) => {
    if (colId.startsWith('extra:')) {
      setExtraVisibility((prev) => ({ ...prev, [colId]: prev[colId] === false }));
      return;
    }
    setVisibleCols((prev) =>
      prev.includes(colId) ? prev.filter((c) => c !== colId) : [...prev, colId]
    );
  };

  const isColVisible = (colId: string) =>
    colId.startsWith('extra:')
      ? extraVisibility[colId] !== false
      : visibleCols.includes(colId);

  const visibleColumnCount =
    ALL_LEAD_COLUMNS.filter((c) => visibleCols.includes(c.id)).length +
    extraColumns.filter((c) => isColVisible(c.id)).length;

  // Fixed widths (see COLUMN_WIDTH_PX) keep the table stable; below this width
  // the card scrolls horizontally instead of squashing cells.
  const tableMinWidth =
    TABLE_COLUMN_ORDER.filter((id) => isColVisible(id)).reduce(
      (sum, id) => sum + (COLUMN_WIDTH_PX[id] ?? 150),
      0
    ) + extraColumns.filter((c) => isColVisible(c.id)).length * EXTRA_COLUMN_WIDTH_PX;

  const editingMessageLead =
    editingMessageId === null ? null : rows.find((r) => r.id === editingMessageId) || null;

  const activeFilterCount =
    (filterStatus !== 'ALL' ? 1 : 0) +
    (filterColor !== 'ALL' ? 1 : 0) +
    (filterCity !== 'ALL' ? 1 : 0) +
    (filterNiche !== 'ALL' ? 1 : 0) +
    (filterSource !== 'ALL' ? 1 : 0) +
    (filterHandledBy !== 'ALL' ? 1 : 0) +
    (minRating ? 1 : 0) +
    (onlyWithReminder ? 1 : 0) +
    (onlyUncontactedNew ? 1 : 0) +
    (onlyMessaged ? 1 : 0) +
    (searchQuery.trim() ? 1 : 0);

  // Record which channel was opened for a lead so the list can show what has
  // already been sent (optimistic, then persisted).
  const handleOutreach = useCallback(async (leadId: number, channel: string) => {
    setRows((prev) =>
      prev.map((l) =>
        l.id === leadId
          ? { ...l, lastOutreachChannel: channel, lastOutreachAt: new Date().toISOString() }
          : l
      )
    );
    try {
      await apiFetch(`/api/leads/${leadId}/outreach`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel }),
      });
    } catch {
      // The badge is cosmetic; a failed log must never block sending.
    }
  }, []);

  const totalLotLeads = lots.reduce((acc, l) => acc + (l.leadCount || 0), 0);

  return (
    <div className="space-y-4">
      {/* ---- Lot selector + primary actions ---- */}
      <Card className="p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3">
          {/* Lot filter as a compact dropdown — scales to any number of lots */}
          <div className="flex items-center gap-2 min-w-0 w-full sm:w-auto sm:flex-1">
            <label
              htmlFor="lot-filter"
              className="text-[11px] font-semibold uppercase tracking-[0.08em] text-faint shrink-0"
            >
              Lot
            </label>
            <Select
              id="lot-filter"
              aria-label="Filter leads by data lot"
              value={selectedLotId === null ? 'all' : String(selectedLotId)}
              onChange={(e) =>
                onSelectLotId(e.target.value === 'all' ? null : Number(e.target.value))
              }
              className="w-full sm:max-w-[260px] font-medium"
            >
              <option value="all">All lots ({totalLotLeads})</option>
              {lots.map((lot) => (
                <option key={lot.id} value={lot.id}>
                  {lot.name} ({lot.leadCount || 0})
                </option>
              ))}
            </Select>
          </div>

          <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
            {currentUser.role === 'admin' && (
              <Button
                variant="primary"
                size="sm"
                className="flex-1 sm:flex-none"
                onClick={onOpenUploadModal}
              >
                <Upload className="w-3.5 h-3.5" />
                Upload lot
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              className="flex-1 sm:flex-none"
              onClick={handleExportAll}
              title="Export current filtered leads to Excel (.xlsx)"
            >
              <Download className="w-3.5 h-3.5" />
              {exporting ? 'Preparing…' : 'Export'}
            </Button>
          </div>
        </div>
      </Card>

      {/* ---- Search + filters + sort + columns ---- */}
      <Card className="p-3 space-y-3">
        {/* Row 1: one control each — search, filters, sort, columns. On
            phones they share a wrapped flex line instead of stacking. */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-auto sm:flex-1 sm:min-w-[220px]">
            <Search className="w-4 h-4 text-faint absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search leads…"
              aria-label="Search leads"
              className="h-9 w-full pl-9 pr-3 rounded-lg border border-line bg-surface text-[13px] text-ink placeholder:text-faint focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15 transition"
            />
          </div>

          {/* Every detailed filter lives inside one dropdown panel. */}
          <div ref={filtersMenuRef} className="relative flex-1 sm:flex-none">
            <Button
              variant={showFiltersMenu ? 'primary' : 'secondary'}
              size="md"
              onClick={() => setShowFiltersMenu((prev) => !prev)}
              aria-expanded={showFiltersMenu}
              className="h-9 w-full justify-center sm:w-auto"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              Filters
              {activeFilterCount > 0 && (
                <span className="tnum inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-md text-[11px] bg-brand-soft text-brand-active">
                  {activeFilterCount}
                </span>
              )}
              <ChevronDown
                className={`w-3.5 h-3.5 transition-transform ${showFiltersMenu ? 'rotate-180' : ''}`}
              />
            </Button>

            {showFiltersMenu && (
              <div className="absolute left-0 sm:left-auto sm:right-0 top-full mt-2 w-[min(34rem,calc(100vw-2rem))] max-h-[70vh] overflow-y-auto rounded-xl bg-surface shadow-pop border border-line p-3 z-30 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-semibold text-ink">Filter leads</span>
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted hover:text-ink cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Reset
                  </button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <Select
                    value={filterColor}
                    onChange={(e) => setFilterColor(e.target.value)}
                    aria-label="Filter by color"
                    className="w-full min-w-0"
                  >
                    <option value="ALL">All colors</option>
                    {settings.colorTags.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} — {c.meaning}
                      </option>
                    ))}
                  </Select>

                  <Select
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                    aria-label="Filter by status"
                    className="w-full min-w-0"
                  >
                    <option value="ALL">All statuses</option>
                    {settings.statusOptions.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </Select>

                  <Select
                    value={filterCity}
                    onChange={(e) => setFilterCity(e.target.value)}
                    aria-label="Filter by city"
                    className="w-full min-w-0"
                  >
                    <option value="ALL">All cities ({distinctCities.length})</option>
                    {distinctCities.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </Select>

                  <Select
                    value={filterNiche}
                    onChange={(e) => setFilterNiche(e.target.value)}
                    aria-label="Filter by niche"
                    className="w-full min-w-0"
                  >
                    <option value="ALL">All niches ({distinctNiches.length})</option>
                    {distinctNiches.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </Select>

                  <Select
                    value={filterSource}
                    onChange={(e) => setFilterSource(e.target.value)}
                    aria-label="Filter by source"
                    className="w-full min-w-0"
                  >
                    <option value="ALL">All sources ({distinctSources.length})</option>
                    {distinctSources.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </Select>

                  <Select
                    value={filterHandledBy}
                    onChange={(e) => setFilterHandledBy(e.target.value)}
                    aria-label="Filter by handler"
                    className="w-full min-w-0"
                  >
                    <option value="ALL">Anyone</option>
                    <option value="Unassigned">Unassigned</option>
                    {distinctHandlers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </Select>

                  <Select
                    value={minRating}
                    onChange={(e) => setMinRating(e.target.value)}
                    aria-label="Filter by minimum rating"
                    className="w-full min-w-0"
                  >
                    <option value="">Any rating</option>
                    <option value="4.5">4.5+ rating</option>
                    <option value="4.8">4.8+ rating</option>
                    <option value="4.9">4.9+ rating</option>
                  </Select>
                </div>

                <div className="pt-2 border-t border-line-soft flex items-center justify-between gap-2">
                  <span className="tnum text-[12px] text-faint">
                    {loading ? '…' : `${total} match${total === 1 ? '' : 'es'}`}
                  </span>
                  <Button variant="primary" size="sm" onClick={() => setShowFiltersMenu(false)}>
                    Done
                  </Button>
                </div>
              </div>
            )}
          </div>

          <Select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            aria-label="Sort leads"
            className="flex-1 sm:flex-none sm:w-auto min-w-0"
          >
            <option value="newest">Newest first</option>
            <option value="reminder_asc">Due soon</option>
            <option value="rating_desc">Highest rating</option>
            <option value="reviews_desc">Most reviews</option>
          </Select>

          <div ref={columnMenuRef} className="relative flex-1 sm:flex-none">
            <Button
              variant={showColumnMenu ? 'primary' : 'secondary'}
              size="md"
              onClick={() => setShowColumnMenu((prev) => !prev)}
              aria-expanded={showColumnMenu}
              className="h-9 w-full justify-center sm:w-auto"
            >
              <Columns className="w-3.5 h-3.5" />
              Columns
              <span className="tnum text-[11px] opacity-70">
                {visibleColumnCount}/{allColumns.length}
              </span>
            </Button>

            {showColumnMenu && (
              <div className="absolute right-0 mt-2 w-[min(18rem,calc(100vw-2rem))] rounded-xl bg-surface shadow-pop border border-line p-3 z-30 space-y-2">
                <div className="flex items-center justify-between pb-2 border-b border-line">
                  <span className="text-[13px] font-semibold text-ink">Table columns</span>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setVisibleCols(ALL_LEAD_COLUMNS.map((c) => c.id));
                        setExtraVisibility({});
                      }}
                      className="text-[12px] font-medium text-brand hover:text-brand-hover cursor-pointer"
                    >
                      Show all
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setVisibleCols(
                          ALL_LEAD_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.id)
                        );
                        setExtraVisibility({});
                      }}
                      className="text-[12px] font-medium text-muted hover:text-ink cursor-pointer"
                    >
                      Reset
                    </button>
                  </div>
                </div>
                <div className="max-h-72 overflow-y-auto space-y-0.5 pr-1">
                  {allColumns.map((col) => {
                    const checked = isColVisible(col.id);
                    return (
                      <button
                        key={col.id}
                        type="button"
                        onClick={() => toggleColumn(col.id)}
                        className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-[13px] transition cursor-pointer ${
                          checked ? 'text-ink font-medium' : 'text-muted hover:bg-navy-soft/50'
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <span
                            className={`w-4 h-4 rounded border flex items-center justify-center ${
                              checked ? 'bg-brand border-brand text-white' : 'border-line bg-surface'
                            }`}
                          >
                            {checked && <Check className="w-3 h-3" />}
                          </span>
                          <span>{col.label}</span>
                        </span>
                        {col.id.startsWith('extra:') ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand-soft text-brand-active font-semibold">
                            LOT
                          </span>
                        ) : col.isCore15 ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-navy-soft/70 text-muted font-semibold">
                            XLSX
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ---- Quick toggles: 3-across on phones, inline on desktop ---- */}
        <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <button
            type="button"
            onClick={() => setOnlyUncontactedNew((v) => !v)}
            aria-pressed={onlyUncontactedNew}
            className={`h-9 w-full sm:w-auto justify-center px-2 sm:px-3 rounded-lg text-[12px] sm:text-[13px] font-medium border flex items-center gap-1.5 transition cursor-pointer ${
              onlyUncontactedNew
                ? 'bg-success-bg text-success-text border-success-border'
                : 'bg-surface text-muted border-line hover:text-ink'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">New only</span>
          </button>

          <button
            type="button"
            onClick={() => setOnlyWithReminder((v) => !v)}
            aria-pressed={onlyWithReminder}
            className={`h-9 w-full sm:w-auto justify-center px-2 sm:px-3 rounded-lg text-[12px] sm:text-[13px] font-medium border flex items-center gap-1.5 transition cursor-pointer ${
              onlyWithReminder
                ? 'bg-warning-bg text-warning-text border-warning-border'
                : 'bg-surface text-muted border-line hover:text-ink'
            }`}
          >
            <Bell className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Has reminder</span>
          </button>

          <button
            type="button"
            onClick={() => setOnlyMessaged((v) => !v)}
            aria-pressed={onlyMessaged}
            title="Only leads whose customized message was already opened in WhatsApp / Email / Phone / Messenger"
            className={`h-9 w-full sm:w-auto justify-center px-2 sm:px-3 rounded-lg text-[12px] sm:text-[13px] font-medium border flex items-center gap-1.5 transition cursor-pointer ${
              onlyMessaged
                ? 'bg-brand-soft text-brand-active border-brand'
                : 'bg-surface text-muted border-line hover:text-ink'
            }`}
          >
            <Check className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Messaged</span>
          </button>
        </div>

        {/* ---- Color quick-filter chips ---- */}
        <div className="pt-3 border-t border-line-soft flex flex-wrap items-center gap-1.5">
          {settings.colorTags.map((c) => {
            const count = facets.colorCounts[c.id] || 0;
            const active = filterColor === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setFilterColor(active ? 'ALL' : c.id)}
                aria-pressed={active}
                className={`h-7 px-2.5 rounded-lg text-[12px] font-medium border flex items-center gap-1.5 transition cursor-pointer ${
                  active
                    ? 'bg-navy text-white border-navy'
                    : 'bg-surface text-muted border-line hover:text-ink'
                }`}
                title={c.meaning}
              >
                <Dot color={c.dotHex} />
                <span>{c.name}</span>
                <span className={`tnum ${active ? 'text-slate-300' : 'text-faint'}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      {/* ---- Leads table ---- */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table
            className="w-full table-fixed text-left border-collapse text-[13px]"
            style={{ minWidth: tableMinWidth }}
          >
            {/* One <col> per rendered column, in the same order as the <th>/<td>
                below — a long cell can no longer stretch its column. */}
            <colgroup>
              {TABLE_COLUMN_ORDER.filter((id) => isColVisible(id)).map((id) => (
                <col key={id} style={{ width: COLUMN_WIDTH_PX[id] ?? 150 }} />
              ))}
              {extraColumns
                .filter((c) => isColVisible(c.id))
                .map((c) => (
                  <col key={c.id} style={{ width: EXTRA_COLUMN_WIDTH_PX }} />
                ))}
            </colgroup>
            <thead className="sticky top-0">
              <tr className="bg-canvas border-b border-line">
                {isColVisible('colorTag') && (
                  <th className="py-2.5 px-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted whitespace-nowrap">
                    Color
                  </th>
                )}
                {isColVisible('businessName') && (
                  <th className="py-2.5 px-3.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted whitespace-nowrap">
                    Business
                  </th>
                )}
                {isColVisible('phone') && (
                  <th className="py-2.5 px-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted whitespace-nowrap">
                    Phone
                  </th>
                )}
                {isColVisible('status') && (
                  <th className="py-2.5 px-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted whitespace-nowrap">
                    Status
                  </th>
                )}
                {isColVisible('whatsapp') && (
                  <th className="py-2.5 px-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted whitespace-nowrap">
                    WhatsApp
                  </th>
                )}
                {isColVisible('email') && (
                  <th className="py-2.5 px-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted whitespace-nowrap">
                    Email
                  </th>
                )}
                {isColVisible('comment') && (
                  <th className="py-2.5 px-3.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted whitespace-nowrap">
                    Latest comment
                  </th>
                )}
                {isColVisible('customMessage') && (
                  <th className="py-2.5 px-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted whitespace-nowrap">
                    Customized message
                  </th>
                )}
                {isColVisible('website') && (
                  <th className="py-2.5 px-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted whitespace-nowrap">
                    Website
                  </th>
                )}
                {isColVisible('facebook') && (
                  <th className="py-2.5 px-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted whitespace-nowrap">
                    Facebook
                  </th>
                )}
                {isColVisible('address') && (
                  <th className="py-2.5 px-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted whitespace-nowrap">
                    Address
                  </th>
                )}
                {isColVisible('city') && (
                  <th className="py-2.5 px-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted whitespace-nowrap">
                    City
                  </th>
                )}
                {isColVisible('niche') && (
                  <th className="py-2.5 px-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted whitespace-nowrap">
                    Niche
                  </th>
                )}
                {isColVisible('rating') && (
                  <th className="py-2.5 px-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted whitespace-nowrap">
                    Rating
                  </th>
                )}
                {isColVisible('reviews') && (
                  <th className="py-2.5 px-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted whitespace-nowrap">
                    Reviews
                  </th>
                )}
                {isColVisible('source') && (
                  <th className="py-2.5 px-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted whitespace-nowrap">
                    Source
                  </th>
                )}
                {isColVisible('importedAt') && (
                  <th className="py-2.5 px-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted whitespace-nowrap">
                    Imported
                  </th>
                )}
                {isColVisible('lotName') && (
                  <th className="py-2.5 px-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted whitespace-nowrap">
                    Lot
                  </th>
                )}
                {isColVisible('handledBy') && (
                  <th className="py-2.5 px-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted whitespace-nowrap">
                    Handled by
                  </th>
                )}
                {isColVisible('nextReminder') && (
                  <th className="py-2.5 px-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted whitespace-nowrap">
                    Next reminder
                  </th>
                )}
                {extraColumns.map(
                  (col) =>
                    isColVisible(col.id) && (
                      <th
                        key={col.id}
                        className="py-2.5 px-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted whitespace-nowrap max-w-[220px] truncate"
                        title={col.label}
                      >
                        {col.label}
                      </th>
                    )
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {rows.length === 0 && !loading ? (
                <tr>
                  <td colSpan={visibleColumnCount || 1} className="p-0">
                    <EmptyState
                      title="No leads match these filters"
                      description="Try widening the lot selection or clearing a filter."
                      action={
                        <Button variant="secondary" size="sm" onClick={resetFilters}>
                          <RotateCcw className="w-3.5 h-3.5" /> Clear filters
                        </Button>
                      }
                    />
                  </td>
                </tr>
              ) : (
                rows.map((lead, index) => {
                  const colorConfig =
                    settings.colorTags.find((c) => c.id === lead.colorTag) ||
                    settings.colorTags[0];
                  const isBrandNew = lead.status === 'New';
                  // The dedicated WhatsApp column is WhatsApp-only; the
                  // Customized Message panel is what falls back to the phone.
                  const waDigits = cleanPhoneForWhatsApp(lead.whatsapp || '');

                  return (
                    <tr
                      key={lead.id}
                      onClick={() => onOpenLead(lead.id)}
                      style={
                        {
                          '--row-tint': colorConfig.rowTintHex,
                          ...(colorConfig.rowTintDarkHex
                            ? { '--row-tint-dark': colorConfig.rowTintDarkHex }
                            : {}),
                        } as React.CSSProperties
                      }
                      className="hover:bg-brand-soft/40 transition cursor-pointer group row-tint"
                    >
                      {/* Color Tag Cell */}
                      {isColVisible('colorTag') && (
                        <td
                          className="py-2.5 px-2 whitespace-nowrap"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <select
                            value={lead.colorTag || 'none'}
                            onChange={(e) =>
                              onQuickUpdateLead(lead.id, { colorTag: e.target.value })
                            }
                            aria-label={`Color for ${lead.businessName}`}
                            className="h-7 w-full min-w-0 pl-1 pr-4 rounded-md text-[11px] font-semibold border border-line bg-surface text-ink cursor-pointer"
                          >
                            {settings.colorTags.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </td>
                      )}

                      {/* 1. Business Name */}
                      {isColVisible('businessName') && (
                        <td className="py-2.5 px-3.5 font-semibold text-ink whitespace-nowrap max-w-[280px]">
                          <div className="flex items-center gap-2 min-w-0">
                            {isBrandNew && (
                              <Badge tone="success" className="uppercase tracking-wide">
                                New
                              </Badge>
                            )}
                            <span className="truncate group-hover:text-brand-active transition">
                              {lead.businessName}
                            </span>
                            {index < 2 && sortBy === 'newest' && (
                              <span className="text-[11px] text-faint font-normal shrink-0">
                                · recent
                              </span>
                            )}
                          </div>
                        </td>
                      )}

                      {/* 2. Phone — 11 local digits only, junk collapses to … */}
                      {isColVisible('phone') && (
                        <td
                          className="py-2.5 px-3 whitespace-nowrap overflow-hidden"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {lead.phone ? (
                            <a
                              href={`tel:${lead.phone}`}
                              title={lead.phone}
                              className="inline-flex items-center gap-1.5 max-w-full font-medium text-ink hover:text-brand-active tnum"
                            >
                              <Phone className="w-3.5 h-3.5 text-faint shrink-0" />
                              <span className="truncate">{displayPhoneDigits(lead.phone)}</span>
                            </a>
                          ) : (
                            <span className="text-faint">—</span>
                          )}
                        </td>
                      )}

                      {/* 13. Status */}
                      {isColVisible('status') && (
                        <td
                          className="py-2.5 px-3 whitespace-nowrap"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <select
                            value={lead.status}
                            onChange={(e) =>
                              onQuickUpdateLead(lead.id, { status: e.target.value })
                            }
                            aria-label={`Status for ${lead.businessName}`}
                            className="h-7 pl-1.5 pr-6 rounded-md border border-line bg-surface text-ink text-[12px] font-medium cursor-pointer"
                          >
                            {settings.statusOptions.map((st) => (
                              <option key={st} value={st}>
                                {st}
                              </option>
                            ))}
                          </select>
                        </td>
                      )}

                      {/* 7. WhatsApp — this column stays WhatsApp-only (no phone
                          fallback); the Customized Message panel handles that. */}
                      {isColVisible('whatsapp') && (
                        <td
                          className="py-2.5 px-3 whitespace-nowrap overflow-hidden"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {waDigits ? (
                            <a
                              href={`https://wa.me/${waDigits}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={lead.whatsapp}
                              className="inline-flex items-center gap-1.5 h-7 px-2.5 max-w-full rounded-md bg-success-bg hover:bg-success-border/60 text-success-text text-[12px] font-semibold tnum"
                            >
                              <MessageCircle className="w-3.5 h-3.5 shrink-0" />
                              <span className="truncate">
                                {displayPhoneDigits(lead.whatsapp)}
                              </span>
                            </a>
                          ) : (
                            <span className="text-faint">—</span>
                          )}
                        </td>
                      )}

                      {/* 4. Email */}
                      {isColVisible('email') && (
                        <td
                          className="py-2.5 px-3 text-muted whitespace-nowrap max-w-[220px] truncate"
                          onClick={(e) => e.stopPropagation()}
                          title={cleanEmail(lead.email) || undefined}
                        >
                          {cleanEmail(lead.email) ? (
                            <a
                              href={`mailto:${cleanEmail(lead.email)}`}
                              onClick={(e) => e.stopPropagation()}
                              className="text-brand hover:text-brand-hover font-medium"
                            >
                              {cleanEmail(lead.email)}
                            </a>
                          ) : (
                            '—'
                          )}
                        </td>
                      )}

                      {/* 3. Comment — the cell only offers the action; the thread
                          lives in the lead drawer, so the column stays narrow. */}
                      {isColVisible('comment') && (
                        <td className="py-2.5 px-3" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => onOpenLead(lead.id)}
                            title={
                              lead.latestComment
                                ? `${lead.latestCommentBy ? `${lead.latestCommentBy} · ` : ''}${formatRelativeTime(lead.latestCommentAt)}`
                                : 'Add a comment'
                            }
                            className="inline-flex items-center gap-1.5 h-7 max-w-full px-2 rounded-md border border-line bg-surface text-[12px] font-medium text-muted hover:text-brand-active hover:border-brand transition cursor-pointer"
                          >
                            <MessageSquare className="w-3.5 h-3.5 shrink-0" />
                            <span className="truncate">Add comment</span>
                            {lead.commentCount ? (
                              <span className="tnum text-[10.5px] text-faint shrink-0">
                                {lead.commentCount}
                              </span>
                            ) : null}
                          </button>
                        </td>
                      )}

                      {/* Customized message — click to pick a send channel */}
                      {isColVisible('customMessage') && (
                        <td
                          className="py-2.5 px-3 overflow-hidden"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center gap-1 min-w-0">
                          <ChannelSendButton
                            message={lead.customMessage}
                            businessName={lead.businessName}
                            phone={lead.phone}
                            whatsapp={lead.whatsapp}
                            email={cleanEmail(lead.email)}
                            facebook={lead.facebook}
                            templates={settings.whatsappTemplates.map((t) => ({
                              id: t.id,
                              name: t.name,
                              text: renderWhatsAppTemplate(t.content, lead),
                            }))}
                            onChannelSent={(channel) => void handleOutreach(lead.id, channel)}
                            lastOutreach={
                              lead.lastOutreachAt
                                ? {
                                    channel: lead.lastOutreachChannel || '',
                                    at: lead.lastOutreachAt,
                                  }
                                : null
                            }
                          />
                            <button
                              type="button"
                              aria-label={`Edit customized message for ${lead.businessName}`}
                              title="Edit customized message"
                              onClick={() => {
                                setMessageDraft(lead.customMessage || '');
                                setEditingMessageId(lead.id);
                              }}
                              className="shrink-0 inline-flex items-center justify-center w-6 h-7 rounded-md border border-line bg-canvas text-faint hover:text-brand-active hover:border-brand transition cursor-pointer"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                          </div>
                        </td>
                      )}

                      {/* 5. Website */}
                      {isColVisible('website') && (
                        <td
                          className="py-2.5 px-3 whitespace-nowrap"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {lead.website ? (
                            <a
                              href={
                                lead.website.startsWith('http')
                                  ? lead.website
                                  : `https://${lead.website}`
                              }
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-brand hover:text-brand-hover font-medium text-[13px]"
                            >
                              <Globe className="w-3.5 h-3.5" />
                              Visit
                            </a>
                          ) : (
                            <span className="text-faint">—</span>
                          )}
                        </td>
                      )}

                      {/* 6. Facebook */}
                      {isColVisible('facebook') && (
                        <td
                          className="py-2.5 px-3 whitespace-nowrap"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {lead.facebook ? (
                            <a
                              href={
                                lead.facebook.startsWith('http')
                                  ? lead.facebook
                                  : `https://${lead.facebook}`
                              }
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-info-text hover:underline font-medium text-[13px]"
                            >
                              <Facebook className="w-3.5 h-3.5" />
                              Page
                            </a>
                          ) : (
                            <span className="text-faint">—</span>
                          )}
                        </td>
                      )}

                      {/* 8. Address */}
                      {isColVisible('address') && (
                        <td className="py-2.5 px-3 text-muted max-w-[180px] truncate">
                          {lead.address || '—'}
                        </td>
                      )}

                      {/* 9. City */}
                      {isColVisible('city') && (
                        <td className="py-2.5 px-3 text-ink font-medium whitespace-nowrap">
                          {lead.city || '—'}
                        </td>
                      )}

                      {/* 10. Niche */}
                      {isColVisible('niche') && (
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          {lead.niche ? <Badge tone="neutral">{lead.niche}</Badge> : '—'}
                        </td>
                      )}

                      {/* 11. Rating */}
                      {isColVisible('rating') && (
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          {lead.rating ? (
                            <span className="tnum inline-flex items-center gap-1 font-semibold text-ink">
                              <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                              {lead.rating}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                      )}

                      {/* 12. Reviews */}
                      {isColVisible('reviews') && (
                        <td className="py-2.5 px-3 text-muted whitespace-nowrap tnum">
                          {lead.reviews || '—'}
                        </td>
                      )}

                      {/* 14. Source */}
                      {isColVisible('source') && (
                        <td className="py-2.5 px-3 text-muted whitespace-nowrap max-w-[160px] truncate">
                          {lead.source || '—'}
                        </td>
                      )}

                      {/* 15. Imported At */}
                      {isColVisible('importedAt') && (
                        <td className="py-2.5 px-3 text-muted whitespace-nowrap tnum text-[12px]">
                          {lead.importedAt || '—'}
                        </td>
                      )}

                      {/* Data Lot */}
                      {isColVisible('lotName') && (
                        <td className="py-2.5 px-3 whitespace-nowrap max-w-[200px]">
                          <span className="block truncate text-[12px] text-muted">
                            {lead.lotName}
                          </span>
                        </td>
                      )}

                      {/* Handled By */}
                      {isColVisible('handledBy') && (
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          {lead.handledByUserName ? (
                            <span className="inline-flex items-center gap-1.5 font-medium text-ink text-[13px]">
                              <span
                                className="w-5 h-5 rounded-full text-white text-[10px] font-semibold inline-flex items-center justify-center"
                                style={{
                                  backgroundColor: lead.handledByAvatarColor || '#6D5CE8',
                                }}
                              >
                                {lead.handledByUserName.charAt(0)}
                              </span>
                              {lead.handledByUserName}
                            </span>
                          ) : (
                            <span className="text-faint italic text-[13px]">Unclaimed</span>
                          )}
                        </td>
                      )}

                      {/* Next Reminder */}
                      {isColVisible('nextReminder') && (
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          {lead.nextReminderAt ? (
                            <Badge
                              tone={
                                new Date(lead.nextReminderAt).getTime() <= Date.now()
                                  ? 'danger'
                                  : 'warning'
                              }
                            >
                              <Clock className="w-3 h-3" />
                              <span className="tnum">
                                {new Date(lead.nextReminderAt).toLocaleString([], {
                                  month: 'short',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            </Badge>
                          ) : (
                            <span className="text-faint">—</span>
                          )}
                        </td>
                      )}

                      {/* This lot's own spreadsheet columns */}
                      {extraColumns.map((col) =>
                        isColVisible(col.id) ? (
                          <td
                            key={col.id}
                            className="py-2.5 px-3 text-muted whitespace-nowrap max-w-[220px] truncate"
                            title={lead.extra?.[col.key] || undefined}
                          >
                            {lead.extra?.[col.key] || '—'}
                          </td>
                        ) : null
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 border-t border-line">
          <p className="text-[12px] text-muted tnum">
            {loading && rows.length === 0
              ? 'Loading leads…'
              : total === 0
                ? 'No leads'
                : `Showing ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total} leads${loading ? ' (updating…)' : ''}`}
          </p>
          <div className="flex items-center gap-2">
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              aria-label="Rows per page"
              className="h-8 pl-2 pr-6 rounded-lg border border-line bg-surface text-[12px] text-ink cursor-pointer"
            >
              {[50, 100, 200, 500].map((n) => (
                <option key={n} value={n}>
                  {n} / page
                </option>
              ))}
            </select>
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              ← Prev
            </Button>
            <span className="tnum text-[12px] text-muted px-1">
              {page} / {totalPages}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next →
            </Button>
          </div>
        </div>
      </Card>

      {editingMessageLead && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-navy/40"
          onClick={() => {
            if (!savingMessage) setEditingMessageId(null);
          }}
        >
          <div
            className="w-full max-w-lg rounded-xl bg-surface border border-line shadow-pop p-4 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-[15px] font-semibold text-ink">Customized message</h3>
                <p className="text-[12px] text-muted truncate">
                  {editingMessageLead.businessName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingMessageId(null)}
                aria-label="Close"
                disabled={savingMessage}
                className="text-faint hover:text-ink text-[16px] leading-none cursor-pointer"
              >
                ×
              </button>
            </div>
            <textarea
              value={messageDraft}
              onChange={(e) => setMessageDraft(e.target.value)}
              rows={8}
              autoFocus
              placeholder="এই লিডের জন্য মেসেজ লিখুন…"
              className="w-full rounded-lg border border-line bg-canvas p-2.5 text-[12.5px] leading-relaxed text-ink outline-none focus:border-brand focus:ring-4 focus:ring-brand/15"
            />
            <div className="flex items-center justify-between gap-2">
              <span className="tnum text-[11.5px] text-faint">
                {messageDraft.length} characters
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={savingMessage}
                  onClick={() => setEditingMessageId(null)}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={savingMessage || !messageDraft.trim()}
                  onClick={async () => {
                    const id = editingMessageLead.id;
                    const next = messageDraft.trim();
                    setSavingMessage(true);
                    try {
                      await onQuickUpdateLead(id, { customMessage: next });
                      setEditingMessageId(null);
                    } finally {
                      setSavingMessage(false);
                    }
                  }}
                >
                  {savingMessage ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
