import React, { useState } from 'react';
import {
  Layers,
  Upload,
  Users,
  Trash2,
  Eye,
  Check,
  Lock,
  FileSpreadsheet,
} from 'lucide-react';
import type { Lot, User } from '../types.ts';
import { Button, IconButton, Badge, PageHeader, Card, Avatar } from './ui.tsx';
import { authHeaders } from '../utils/api.ts';

interface LotsAccessViewProps {
  lots: Lot[];
  users: User[];
  currentUser: User;
  onRefresh: () => void;
  onOpenLotLeads: (lotId: number) => void;
  onOpenUploadModal: () => void;
}

export const LotsAccessView: React.FC<LotsAccessViewProps> = ({
  lots,
  users,
  currentUser,
  onRefresh,
  onOpenLotLeads,
  onOpenUploadModal,
}) => {
  const [savingLotId, setSavingLotId] = useState<number | null>(null);
  const teamMembers = users.filter((u) => u.role === 'member');

  const handleToggleUserForLot = async (lot: Lot, userId: number) => {
    if (currentUser.role !== 'admin') return;
    setSavingLotId(lot.id);
    try {
      const currentIds = (lot.assignedUsers || []).map((u) => u.id);
      const nextIds = currentIds.includes(userId)
        ? currentIds.filter((id) => id !== userId)
        : [...currentIds, userId];

      await fetch(`/api/lots/${lot.id}/access`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(),
        },
        body: JSON.stringify({ userIds: nextIds }),
      });
      onRefresh();
    } finally {
      setSavingLotId(null);
    }
  };

  const handleDeleteLot = async (lot: Lot) => {
    if (!window.confirm(`Delete "${lot.name}" and all ${lot.leadCount || 0} leads inside it?`)) {
      return;
    }
    await fetch(`/api/lots/${lot.id}`, {
      method: 'DELETE',
      headers: { ...authHeaders() },
    });
    onRefresh();
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Access control"
        title="Data lots"
        description="Each uploaded spreadsheet is a lot. Members only see leads in lots you explicitly assign to them — one member, or shared across several."
        actions={
          currentUser.role === 'admin' ? (
            <Button variant="primary" onClick={onOpenUploadModal}>
              <Upload className="w-4 h-4" />
              Upload lot
            </Button>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 gap-3">
        {lots.map((lot) => {
          const assignedIds = (lot.assignedUsers || []).map((u) => u.id);
          return (
            <Card key={lot.id} className="p-4 sm:p-5">
              <div className="flex flex-col xl:flex-row xl:items-center gap-4">
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-start gap-3 min-w-0">
                    <span className="w-9 h-9 rounded-lg bg-brand-soft text-brand flex items-center justify-center shrink-0">
                      <Layers className="w-4 h-4" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="text-[15px] font-semibold text-ink truncate">{lot.name}</h3>
                      <p className="text-[12px] text-muted truncate">
                        {lot.description || 'Uploaded lead batch'}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-muted pl-12">
                    <span className="inline-flex items-center gap-1.5 font-medium text-ink">
                      <FileSpreadsheet className="w-3.5 h-3.5 text-faint" />
                      {lot.sourceFileName || 'spreadsheet.xlsx'}
                    </span>
                    <span className="tnum">
                      <strong className="font-semibold text-ink">{lot.leadCount || 0}</strong>{' '}
                      leads
                    </span>
                    <span className="tnum">
                      <strong className="font-semibold text-success-text">{lot.newCount || 0}</strong>{' '}
                      new
                    </span>
                    <span className="tnum">
                      <strong className="font-semibold text-ink">{lot.contactedCount || 0}</strong>{' '}
                      contacted
                    </span>
                    <span className="tnum">
                      <strong className="font-semibold text-brand-active">
                        {lot.convertedCount || 0}
                      </strong>{' '}
                      hot / meetings
                    </span>
                  </div>
                </div>

                {/* Access toggles */}
                <div className="space-y-1.5 w-full xl:w-[340px] xl:shrink-0">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-faint flex items-center gap-1">
                      <Users className="w-3 h-3" /> Visible to
                    </span>
                    {savingLotId === lot.id && (
                      <span className="text-[12px] text-brand font-medium animate-pulse">
                        Saving…
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {teamMembers.map((member) => {
                      const hasAccess = assignedIds.includes(member.id);
                      return (
                        <button
                          key={member.id}
                          type="button"
                          disabled={currentUser.role !== 'admin'}
                          onClick={() => handleToggleUserForLot(lot, member.id)}
                          aria-pressed={hasAccess}
                          title={hasAccess ? 'Click to revoke access' : 'Click to grant access'}
                          className={`h-8 pl-1.5 pr-2.5 rounded-lg text-[12px] font-medium border flex items-center gap-1.5 transition cursor-pointer disabled:cursor-default ${
                            hasAccess
                              ? 'bg-brand-soft text-brand-active border-brand-border'
                              : 'bg-surface text-muted border-line hover:text-ink'
                          }`}
                        >
                          {hasAccess ? (
                            <span className="w-5 h-5 rounded-full bg-brand text-white inline-flex items-center justify-center">
                              <Check className="w-3 h-3" />
                            </span>
                          ) : (
                            <Avatar name={member.name} color={member.avatarColor} size="xs" />
                          )}
                          <span className="max-w-[120px] truncate">{member.name}</span>
                          {!hasAccess && <Lock className="w-3 h-3 text-faint" />}
                        </button>
                      );
                    })}
                    {teamMembers.length === 0 && (
                      <span className="text-[12px] text-faint">No team members yet.</span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button variant="secondary" size="sm" onClick={() => onOpenLotLeads(lot.id)}>
                    <Eye className="w-3.5 h-3.5" />
                    View leads
                  </Button>
                  {currentUser.role === 'admin' && (
                    <IconButton
                      label={`Delete lot ${lot.name}`}
                      onClick={() => handleDeleteLot(lot)}
                      className="text-danger-text border-danger-border hover:bg-danger-bg"
                    >
                      <Trash2 className="w-4 h-4" />
                    </IconButton>
                  )}
                </div>
              </div>
            </Card>
          );
        })}

        {lots.length === 0 && (
          <Card>
            <div className="p-12 text-center">
              <p className="text-[14px] font-semibold text-ink">No data lots yet</p>
              <p className="mt-1 text-[13px] text-muted">
                Upload your first spreadsheet to create a lot.
              </p>
              {currentUser.role === 'admin' && (
                <div className="mt-4">
                  <Button variant="primary" onClick={onOpenUploadModal}>
                    <Upload className="w-4 h-4" /> Upload lot
                  </Button>
                </div>
              )}
            </div>
          </Card>
        )}
      </div>

      {/* Keep Badge import referenced for access-state legend */}
      <div className="hidden">
        <Badge tone="neutral">legend</Badge>
      </div>
    </div>
  );
};
