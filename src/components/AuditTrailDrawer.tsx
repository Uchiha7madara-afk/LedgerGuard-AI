import React from 'react';
import { X, History, Download, CheckCircle2, ShieldCheck } from 'lucide-react';
import type { AuditDisposition } from '../types/ledger';
import { formatINR } from './MetricsHeader';

interface AuditTrailDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  dispositions: AuditDisposition[];
}

export const AuditTrailDrawer: React.FC<AuditTrailDrawerProps> = ({
  isOpen,
  onClose,
  dispositions,
}) => {
  if (!isOpen) return null;

  const handleExportAuditLog = () => {
    if (!dispositions.length) return;
    const headers = [
      'disposition_id',
      'record_id',
      'vendor_name',
      'invoice_no',
      'gross_total',
      'reason_codes',
      'auditor_name',
      'decision',
      'audit_note',
      'timestamp_utc',
    ];
    const rows = [
      headers.join(','),
      ...dispositions.map((d) =>
        headers
          .map(
            (h) =>
              `"${String((d as unknown as Record<string, unknown>)[h] ?? '').replace(
                /"/g,
                '""'
              )}"`
          )
          .join(',')
      ),
    ];
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ledgerguard_immutable_audit_trail.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="audit-drawer-title"
      className="fixed inset-0 z-50 flex justify-end bg-black/75 backdrop-blur-sm"
    >
      <div className="w-full max-w-xl bg-[#08090E]/95 backdrop-blur-2xl border-l border-white/[0.12] h-full flex flex-col justify-between shadow-[0_0_80px_rgba(0,0,0,0.9)]">
        {/* Drawer Header */}
        <div className="px-6 py-4 border-b border-white/[0.08] bg-[#050507]/90 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <History className="w-4 h-4" />
            </div>
            <div>
              <h2
                id="audit-drawer-title"
                className="text-sm sm:text-base font-semibold text-white font-mono tracking-tight"
              >
                IMMUTABLE AUDIT LEDGER // HUMAN SIGN-OFF LOG
              </h2>
              <p className="text-[11px] text-zinc-400 font-mono tabular-nums mt-0.5">
                {dispositions.length} COMMITTED DISPOSITIONS • SQLITE + JSON PERSISTENCE
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExportAuditLog}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono text-zinc-200 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] rounded-lg transition-all cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-indigo-400" />
              <span>Export CSV</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close audit trail drawer"
              className="p-2 text-zinc-400 hover:text-white hover:bg-white/[0.06] rounded-lg transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Cryptographic-Style Vertical Timeline List */}
        <div className="p-6 overflow-y-auto flex-1">
          {dispositions.length === 0 ? (
            <div className="text-center py-14 text-xs font-mono text-zinc-500">
              No human dispositions committed yet. Inspect any flagged voucher in the queue to commit a sign-off.
            </div>
          ) : (
            <div className="relative pl-6 border-l border-white/[0.1] space-y-5">
              {dispositions.map((item) => {
                const decisionBadge =
                  item.decision === 'CONFIRM_DUPLICATE'
                    ? 'text-amber-300 bg-amber-500/10 border-amber-500/25'
                    : item.decision === 'HOLD_PAYMENT'
                    ? 'text-rose-400 bg-rose-500/10 border-rose-500/25 shadow-[0_0_12px_rgba(244,63,94,0.12)]'
                    : 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25';

                const dotColor =
                  item.decision === 'CONFIRM_DUPLICATE'
                    ? 'bg-amber-400'
                    : item.decision === 'HOLD_PAYMENT'
                    ? 'bg-rose-500'
                    : 'bg-emerald-400';

                return (
                  <div key={item.disposition_id} className="relative group">
                    {/* Timeline Node Connector */}
                    <span
                      className={`absolute -left-[29px] top-4 h-2.5 w-2.5 rounded-full ring-4 ring-[#08090E] ${dotColor}`}
                    />

                    <div className="rounded-xl border border-white/[0.08] bg-[#0B0C10]/90 p-4 space-y-2.5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] hover:border-white/[0.16] transition-all">
                      <div className="flex items-center justify-between gap-2 text-xs font-mono tabular-nums">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-white">
                            {item.disposition_id}
                          </span>
                          <span className="text-zinc-500">//</span>
                          <span className="text-indigo-300">{item.record_id}</span>
                        </div>
                        <span
                          className={`px-2 py-0.5 text-[10px] font-mono rounded border ${decisionBadge}`}
                        >
                          {item.decision}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className="font-medium text-zinc-200">{item.vendor_name}</span>
                        <span className="font-mono tabular-nums text-zinc-300">
                          {item.invoice_no} • {formatINR(Number(item.gross_total))}
                        </span>
                      </div>

                      <blockquote className="text-xs text-zinc-300 font-mono bg-[#050507]/90 border border-white/[0.06] rounded-lg p-3 leading-relaxed">
                        &ldquo;{item.audit_note}&rdquo;
                      </blockquote>

                      <div className="flex items-center justify-between text-[11px] text-zinc-400 font-mono tabular-nums pt-1">
                        <span className="inline-flex items-center gap-1.5 text-zinc-300">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          <span>{item.auditor_name}</span>
                        </span>
                        <span className="text-zinc-500">{item.timestamp_utc}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-white/[0.08] bg-[#050507]/90 flex justify-between items-center text-xs font-mono text-zinc-400">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>SOX / ICFR PRE-DISBURSEMENT CONTROL LOG</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 text-xs font-mono text-zinc-200 bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] rounded-lg transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
