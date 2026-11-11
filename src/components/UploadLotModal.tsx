import React, { useState, useRef } from 'react';
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  Download,
  Users,
  FolderPlus,
  Layers,
} from 'lucide-react';
import type { Lot, User } from '../types.ts';
import {
  parseSpreadsheetFile,
  downloadSampleXlsxTemplate,
  type ParsedSpreadsheetRow,
  type ParsedColumn,
} from '../utils/spreadsheet.ts';
import { Button, Badge, Avatar, ModalShell, ModalHeader, Field, TextInput, InlineAlert } from './ui.tsx';
import { authHeaders } from '../utils/api.ts';

interface UploadLotModalProps {
  isOpen: boolean;
  onClose: () => void;
  lots: Lot[];
  users: User[];
  currentUserId: number;
  onImportSuccess: (lotId: number) => void;
}

export const UploadLotModal: React.FC<UploadLotModalProps> = ({
  isOpen,
  onClose,
  lots,
  users,
  currentUserId,
  onImportSuccess,
}) => {
  const [step, setStep] = useState<'select' | 'preview'>('select');
  const [fileName, setFileName] = useState('');
  const [parsedRows, setParsedRows] = useState<ParsedSpreadsheetRow[]>([]);
  const [parsedColumns, setParsedColumns] = useState<ParsedColumn[]>([]);
  const [detectedHeaders, setDetectedHeaders] = useState<string[]>([]);
  // Only asked when the file adds/removes columns on an existing lot.
  const [columnMode, setColumnMode] = useState<'merge' | 'replace'>('merge');
  const [duplicates, setDuplicates] = useState<any[]>([]);
  const [duplicateMode, setDuplicateMode] = useState<'skip_duplicates' | 'import_all'>('skip_duplicates');

  const [destinationType, setDestinationType] = useState<'new' | 'existing'>('new');
  const [targetLotId, setTargetLotId] = useState<number>(lots[0]?.id || 0);
  const [lotName, setLotName] = useState('');
  const [lotDescription, setLotDescription] = useState('');
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const teamMembers = users.filter((u) => u.role === 'member');

  // ---- Core vs lot-specific columns in the picked file ----
  const customColumns = parsedColumns.filter((c) => !c.coreField);
  const targetLot =
    destinationType === 'existing' ? lots.find((l) => l.id === targetLotId) : undefined;
  const targetLotColumnKeys = new Set((targetLot?.columns || []).map((c) => c.key));
  const parsedColumnKeys = new Set(parsedColumns.map((c) => c.key));
  const newCustomColumns = customColumns.filter((c) => !targetLotColumnKeys.has(c.key));
  const droppedCustomColumns = (targetLot?.columns || []).filter(
    (c) => !parsedColumnKeys.has(c.key)
  );

  const previewColumns: { label: string; value: (r: ParsedSpreadsheetRow) => string }[] = [
    { label: 'Business', value: (r) => r.businessName },
    { label: 'Phone', value: (r) => r.phone },
    { label: 'Comment', value: (r) => r.comment },
    { label: 'Email', value: (r) => r.email },
    { label: 'City', value: (r) => r.city },
    { label: 'Niche', value: (r) => r.niche },
    ...customColumns.slice(0, 4).map((c) => ({
      label: c.label,
      value: (r: ParsedSpreadsheetRow) => r.extra[c.key] || '—',
    })),
    { label: 'Status', value: (r) => r.status },
  ];

  const handleFileChange = async (file: File | null) => {
    if (!file) return;
    setError('');
    // Parsing happens in the browser — refuse monster files before freezing the tab.
    const MAX_FILE_BYTES = 15 * 1024 * 1024;
    if (file.size > MAX_FILE_BYTES) {
      setError(`This file is ${(file.size / 1048576).toFixed(1)} MB — please split it under 15 MB per upload.`);
      return;
    }
    setLoading(true);
    try {
      const { headers, columns, rows } = await parseSpreadsheetFile(file);
      if (rows.length === 0) {
        setError(
          'Could not find any rows with data. The first row is treated as the header row — every other heading is kept as a column of this lot.'
        );
        setLoading(false);
        return;
      }

      setFileName(file.name);
      const baseName = file.name.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ');
      if (!lotName) {
        setLotName(`Lot — ${baseName}`);
      }
      setDetectedHeaders(headers);
      setParsedColumns(columns);
      setParsedRows(rows);

      // Check duplicates against database
      const resp = await fetch('/api/lots/check-duplicates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(),
        },
        body: JSON.stringify({ rows }),
      });
      if (resp.ok) {
        const data = await resp.json();
        setDuplicates(data.duplicates || []);
      }

      setStep('preview');
    } catch (err: any) {
      setError(`Failed to parse spreadsheet: ${err?.message || String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  const toggleUserAccess = (uid: number) => {
    setSelectedUserIds((prev) =>
      prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid]
    );
  };

  const handleConfirmImport = async () => {
    if (destinationType === 'new' && !lotName.trim()) {
      setError('Please enter a Lot Name');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const resp = await fetch('/api/lots/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(),
        },
        body: JSON.stringify({
          targetLotId: destinationType === 'existing' ? targetLotId : 0,
          lotName,
          lotDescription,
          sourceFileName: fileName,
          assignedUserIds: selectedUserIds,
          leads: parsedRows,
          duplicateMode,
          columns: customColumns.map((c) => ({ key: c.key, label: c.label })),
          columnMode: destinationType === 'existing' ? columnMode : 'merge',
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || 'Import failed');
      }
      onImportSuccess(data.lotId);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Import error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalShell onClose={onClose} label="Upload leads spreadsheet" maxWidth="max-w-3xl">
      <ModalHeader
        onClose={onClose}
        title="Upload leads spreadsheet"
        description="Core headings (Business Name, Phone, Comment, …) map automatically. Any other heading is kept as a column of this lot, so every lot can have its own list."
      />

      <div className="p-5 sm:p-6 overflow-y-auto space-y-5 flex-1">
        {error && (
          <InlineAlert tone="danger">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </InlineAlert>
        )}

        {step === 'select' ? (
          <div className="space-y-4">
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files?.[0];
                if (f) handleFileChange(f);
              }}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
              }}
              role="button"
              tabIndex={0}
              aria-label="Choose spreadsheet file to upload"
              className="border border-dashed border-line rounded-lg p-8 text-center cursor-pointer hover:border-brand hover:bg-brand-soft/40 transition"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv,.tsv,.ods"
                className="hidden"
                onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
              />
              <div className="w-11 h-11 rounded-lg bg-brand-soft text-brand flex items-center justify-center mx-auto mb-3">
                <Upload className="w-5 h-5" />
              </div>
              <p className="text-[14px] font-semibold text-ink">
                Choose an Excel / CSV file or drag it here
              </p>
              <p className="text-[12px] text-muted mt-1">
                .xlsx, .xls, .csv, .tsv, .ods — the Comment column joins the lead timeline
              </p>
              {loading && (
                <p className="text-[13px] font-medium text-brand mt-3 animate-pulse">
                  Parsing spreadsheet and checking duplicates…
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-lg bg-canvas border border-line">
              <div>
                <p className="text-[13px] font-semibold text-ink">Need a test file?</p>
                <p className="text-[12px] text-muted">
                  Download a sample pre-formatted with the exact 15 columns.
                </p>
              </div>
              <Button variant="secondary" size="sm" onClick={downloadSampleXlsxTemplate}>
                <Download className="w-3.5 h-3.5" />
                Sample .xlsx
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Summary */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-lg bg-success-bg border border-success-border">
              <div className="flex items-center gap-2.5 min-w-0">
                <CheckCircle2 className="w-5 h-5 text-success-text shrink-0" />
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-success-text">
                    Parsed <span className="tnum">{parsedRows.length} leads</span> from{' '}
                    <span className="font-mono text-[12px]">{fileName}</span>
                  </p>
                  <p className="text-[12px] text-success-text/80 truncate">
                    {detectedHeaders.join(' · ')}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setStep('select');
                  setParsedRows([]);
                  setParsedColumns([]);
                }}
                className="text-[12px] font-medium text-success-text hover:underline cursor-pointer shrink-0"
              >
                Choose another file
              </button>
            </div>

            {/* Detected columns: core vs lot-specific */}
            <div className="rounded-lg border border-line p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                  Detected columns ({parsedColumns.length})
                </p>
                <span className="text-[11px] text-faint">
                  Unmatched headings become this lot&apos;s own columns
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto pr-1">
                {parsedColumns.map((col) => (
                  <span
                    key={col.key}
                    className={`inline-flex items-center gap-1.5 h-6 px-2 rounded-md border text-[11px] font-medium ${
                      col.coreField
                        ? 'bg-success-bg text-success-text border-success-border'
                        : 'bg-brand-soft text-brand-active border-brand-border'
                    }`}
                  >
                    <span className="truncate max-w-[150px]">{col.label}</span>
                    <span className="opacity-70">{col.coreField ? 'core' : 'extra'}</span>
                  </span>
                ))}
              </div>

              {destinationType === 'existing' &&
                (newCustomColumns.length > 0 || droppedCustomColumns.length > 0) && (
                  <div className="pt-3 border-t border-line-soft space-y-2.5">
                    <p className="text-[12px] text-muted">
                      This lot already has its own column layout.
                      {newCustomColumns.length > 0 && (
                        <>
                          {' '}
                          This file adds{' '}
                          <strong className="text-ink">{newCustomColumns.length}</strong> new column
                          {newCustomColumns.length === 1 ? '' : 's'}.
                        </>
                      )}
                      {droppedCustomColumns.length > 0 && (
                        <>
                          {' '}
                          <strong className="text-ink">{droppedCustomColumns.length}</strong> existing
                          column{droppedCustomColumns.length === 1 ? '' : 's'} are not in this file.
                        </>
                      )}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <button
                        type="button"
                        aria-pressed={columnMode === 'merge'}
                        onClick={() => setColumnMode('merge')}
                        className={`p-2.5 rounded-lg border text-left transition cursor-pointer ${
                          columnMode === 'merge'
                            ? 'border-brand-border bg-brand-soft/60'
                            : 'border-line bg-surface hover:bg-canvas'
                        }`}
                      >
                        <p className="text-[13px] font-semibold text-ink">Merge columns</p>
                        <p className="text-[11px] text-muted">
                          Keep the lot&apos;s existing columns and append the new ones.
                        </p>
                      </button>
                      <button
                        type="button"
                        aria-pressed={columnMode === 'replace'}
                        onClick={() => setColumnMode('replace')}
                        className={`p-2.5 rounded-lg border text-left transition cursor-pointer ${
                          columnMode === 'replace'
                            ? 'border-warning-border bg-warning-bg/60'
                            : 'border-line bg-surface hover:bg-canvas'
                        }`}
                      >
                        <p className="text-[13px] font-semibold text-ink">Replace columns</p>
                        <p className="text-[11px] text-muted">
                          Use only this file&apos;s headings (older extra values stay saved).
                        </p>
                      </button>
                    </div>
                    {newCustomColumns.length > 0 && (
                      <p className="text-[11px] text-muted">
                        New: {newCustomColumns.map((c) => c.label).join(' · ')}
                      </p>
                    )}
                    {droppedCustomColumns.length > 0 && (
                      <p className="text-[11px] text-muted">
                        Hidden if replaced: {droppedCustomColumns.map((c) => c.label).join(' · ')}
                      </p>
                    )}
                  </div>
                )}
            </div>

            {/* Destination + access */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-lg border border-line p-4 space-y-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                  1 · Destination
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    aria-pressed={destinationType === 'new'}
                    onClick={() => setDestinationType('new')}
                    className={`h-9 px-2 rounded-lg text-[13px] font-medium flex items-center justify-center gap-1.5 border transition cursor-pointer ${
                      destinationType === 'new'
                        ? 'bg-navy text-white border-navy'
                        : 'bg-surface text-muted border-line hover:text-ink'
                    }`}
                  >
                    <FolderPlus className="w-3.5 h-3.5" />
                    New lot
                  </button>
                  <button
                    type="button"
                    aria-pressed={destinationType === 'existing'}
                    onClick={() => setDestinationType('existing')}
                    className={`h-9 px-2 rounded-lg text-[13px] font-medium flex items-center justify-center gap-1.5 border transition cursor-pointer ${
                      destinationType === 'existing'
                        ? 'bg-navy text-white border-navy'
                        : 'bg-surface text-muted border-line hover:text-ink'
                    }`}
                  >
                    <Layers className="w-3.5 h-3.5" />
                    Existing lot
                  </button>
                </div>

                {destinationType === 'new' ? (
                  <div className="space-y-2.5 pt-1">
                    <Field label="Lot name">
                      <TextInput
                        type="text"
                        value={lotName}
                        onChange={(e) => setLotName(e.target.value)}
                        placeholder="e.g. Lot #104 — New York Dental Leads"
                      />
                    </Field>
                    <Field label="Description">
                      <TextInput
                        type="text"
                        value={lotDescription}
                        onChange={(e) => setLotDescription(e.target.value)}
                        placeholder="Optional campaign or source description"
                      />
                    </Field>
                  </div>
                ) : (
                  <div className="pt-1">
                    <Field label="Existing lot">
                      <select
                        value={targetLotId}
                        onChange={(e) => setTargetLotId(Number(e.target.value))}
                        className="h-9 pl-2.5 pr-7 w-full rounded-lg border border-line bg-surface text-[13px] text-ink"
                      >
                        {lots.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name} ({l.leadCount || 0} leads)
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-line p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                    2 · Team access
                  </p>
                  <span className="text-[11px] text-faint">Unchecked = no access</span>
                </div>
                <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                  {teamMembers.map((member) => {
                    const checked = selectedUserIds.includes(member.id);
                    return (
                      <label
                        key={member.id}
                        className={`flex items-center justify-between p-2 rounded-lg border cursor-pointer transition ${
                          checked
                            ? 'bg-brand-soft/60 border-brand-border'
                            : 'bg-surface border-line hover:bg-canvas'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleUserAccess(member.id)}
                            className="w-4 h-4 rounded border-line accent-[#6D5CE8] shrink-0"
                          />
                          <Avatar name={member.name} color={member.avatarColor} size="xs" />
                          <div className="min-w-0">
                            <p className="text-[13px] font-medium text-ink truncate">
                              {member.name}
                            </p>
                            <p className="text-[11px] text-faint truncate">{member.email}</p>
                          </div>
                        </div>
                        {checked && <Badge tone="brand">Granted</Badge>}
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Duplicates */}
            {duplicates.length > 0 && (
              <div className="p-4 rounded-lg bg-warning-bg border border-warning-border space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-warning-text">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span className="text-[13px] font-semibold">
                      <span className="tnum">{duplicates.length}</span> duplicate
                      {duplicates.length === 1 ? '' : 's'} found in older lots
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant={duplicateMode === 'skip_duplicates' ? 'primary' : 'secondary'}
                      onClick={() => setDuplicateMode('skip_duplicates')}
                    >
                      Skip ({parsedRows.length - duplicates.length} import)
                    </Button>
                    <Button
                      size="sm"
                      variant={duplicateMode === 'import_all' ? 'primary' : 'secondary'}
                      onClick={() => setDuplicateMode('import_all')}
                    >
                      Import all {parsedRows.length}
                    </Button>
                  </div>
                </div>
                <div className="text-[12px] text-warning-text max-h-24 overflow-y-auto space-y-1">
                  {duplicates.slice(0, 8).map((d, i) => (
                    <div key={i}>
                      • <strong>{d.businessName}</strong> ({d.phone}) already in{' '}
                      <span className="underline">{d.existingLotName}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Preview (core columns + this file's extra columns) */}
            <div>
              <h4 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted mb-2">
                Preview · first 5 of <span className="tnum">{parsedRows.length}</span>
              </h4>
              <div className="border border-line rounded-lg overflow-x-auto">
                <table className="w-full text-left border-collapse text-[13px]">
                  <thead>
                    <tr className="bg-canvas text-muted border-b border-line">
                      {previewColumns.map((col) => (
                        <th
                          key={col.label}
                          className="py-2 px-3 text-[11px] font-semibold uppercase tracking-[0.06em] whitespace-nowrap"
                        >
                          {col.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-soft">
                    {parsedRows.slice(0, 5).map((r, i) => (
                      <tr key={i} className="hover:bg-canvas/60">
                        {previewColumns.map((col, ci) => (
                          <td
                            key={col.label}
                            className={`py-2 px-3 whitespace-nowrap max-w-[220px] truncate ${
                              ci === 0 ? 'font-medium text-ink' : 'text-muted'
                            }`}
                            title={col.value(r)}
                          >
                            {col.value(r) || '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-5 sm:px-6 py-4 bg-canvas border-t border-line flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[12px] text-muted">
          <Users className="w-4 h-4 text-faint" />
          <span>
            {selectedUserIds.length === 0
              ? 'Only admins can see this lot until members are assigned'
              : `Sharing with ${selectedUserIds.length} member${selectedUserIds.length === 1 ? '' : 's'}`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {step === 'preview' && (
            <Button variant="primary" disabled={loading} onClick={handleConfirmImport}>
              <FileSpreadsheet className="w-4 h-4" />
              {loading ? 'Importing…' : 'Confirm import'}
            </Button>
          )}
        </div>
      </div>
    </ModalShell>
  );
};
