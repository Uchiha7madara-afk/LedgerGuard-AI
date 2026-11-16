import React, { useEffect, useRef } from 'react';
import {
  Search,
  Download,
  ArrowRight,
  CheckCircle2,
  ShieldAlert,
  SlidersHorizontal,
} from 'lucide-react';
import type { LedgerRecord, ReasonFilterKey } from '../types/ledger';
import { formatINR } from './MetricsHeader';

interface TriageQueueTableProps {
  items: LedgerRecord[];
  totalMatching: number;
  loading: boolean;
  reasonFilter: ReasonFilterKey;
  onReasonFilterChange: (filter: ReasonFilterKey) => void;
  actionFilter: string;
  onActionFilterChange: (action: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onInspectRecord: (record: LedgerRecord) => void;
}

const FILTER_TABS: { key: ReasonFilterKey; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'NEAR_DUP', label: 'Near-Duplicate' },
  { key: 'SPLIT', label: 'Split PO > ₹50k' },
  { key: 'SHARED_BANK', label: 'Shared Bank' },
  { key: 'ABSTENTION', label: 'Needs OCR Check' },
  { key: 'PRICE_DRIFT', label: 'Price Drift' },
];

const FRIENDLY_REASON_BADGE: Record<
  string,
  { label: string; style: string }
> = {
  EXACT_DUPLICATE_INVOICE: {
    label: 'Exact Duplicate',
    style: 'text-rose-300 bg-rose-500/15 border-rose-500/30',
  },
  NEAR_DUP_INV_NO_OR_ALIAS: {
    label: 'OCR Typo Duplicate',
    style: 'text-rose-300 bg-rose-500/15 border-rose-500/30',
  },
  SPLIT_THRESHOLD_BYPASS: {
    label: 'Split Invoice (>₹50k)',
    style: 'text-amber-300 bg-amber-500/15 border-amber-500/30',
  },
  SHARED_BANK_IFSC_DIFF_VENDOR: {
    label: 'Shared Bank Account',
    style: 'text-rose-300 bg-rose-500/15 border-rose-500/30',
  },
  EXTRACTION_MATH_MISMATCH: {
    label: 'Tax Math / Low OCR',
    style: 'text-amber-300 bg-amber-500/15 border-amber-500/30',
  },
  NEEDS_MANUAL_OCR_REVIEW: {
    label: 'Low OCR Confidence',
    style: 'text-amber-300 bg-amber-500/15 border-amber-500/30',
  },
  INVALID_GSTIN_CHECKSUM: {
    label: 'Invalid GSTIN Checksum',
    style: 'text-rose-300 bg-rose-500/15 border-rose-500/30',
  },
  UNIT_PRICE_COHORT_DRIFT: {
    label: 'Unit Price Inflation',
    style: 'text-indigo-300 bg-indigo-500/15 border-indigo-500/30',
  },
};

export const TriageQueueTable: React.FC<TriageQueueTableProps> = ({
  items,
  totalMatching,
  loading,
  reasonFilter,
  onReasonFilterChange,
  actionFilter,
  onActionFilterChange,
  searchQuery,
  onSearchChange,
  onInspectRecord,
}) => {
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        (e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA'
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleExportCSV = () => {
    if (!items.length) return;
    const headers = [
      'record_id',
      'vendor_id',
      'vendor_name',
      'gstin',
      'invoice_no',
      'po_number',
      'invoice_date',
      'gross_total',
      'hybrid_risk_score',
      'reason_codes',
      'recommended_action',
      'matched_record_id',
    ];
    const csvRows = [
      headers.join(','),
      ...items.map((r) =>
        headers
          .map(
            (h) =>
              `"${String((r as unknown as Record<string, unknown>)[h] ?? '').replace(
                /"/g,
                '""'
              )}"`
          )
          .join(',')
      ),
    ];
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ledgerguard_triage_queue_${reasonFilter.toLowerCase()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // When filter is set to "ALL", interleave rows round-robin across anomaly typologies and distinct vendors
  // so the top visible rows showcase a diverse mix of anomaly types and suppliers.
  const displayItems = React.useMemo(() => {
    if (reasonFilter !== 'ALL' || items.length <= 1) {
      return items;
    }
    const bucketOrder = [
      'OCR_TYPO_NEAR_DUP',
      'SPLIT_THRESHOLD_BYPASS',
      'SHARED_BANK_CROSS_VENDOR',
      'TAX_MATH_MISMATCH',
      'UNIT_PRICE_DRIFT',
      'DATE_SHIFT_VENDOR_ALIAS',
      'EXACT_RESUBMISSION',
    ];
    const buckets = new Map<string, LedgerRecord[]>();
    for (const key of bucketOrder) {
      buckets.set(key, []);
    }
    const otherBucket: LedgerRecord[] = [];

    for (const item of items) {
      const typ = String(item.anomaly_typology || '');
      const codes = String(item.reason_codes || '');
      if (buckets.has(typ)) {
        buckets.get(typ)!.push(item);
      } else if (codes.includes('SPLIT_THRESHOLD_BYPASS')) {
        buckets.get('SPLIT_THRESHOLD_BYPASS')!.push(item);
      } else if (codes.includes('SHARED_BANK_IFSC_DIFF_VENDOR')) {
        buckets.get('SHARED_BANK_CROSS_VENDOR')!.push(item);
      } else if (
        codes.includes('EXTRACTION_MATH_MISMATCH') ||
        codes.includes('NEEDS_MANUAL_OCR_REVIEW')
      ) {
        buckets.get('TAX_MATH_MISMATCH')!.push(item);
      } else if (codes.includes('UNIT_PRICE_COHORT_DRIFT')) {
        buckets.get('UNIT_PRICE_DRIFT')!.push(item);
      } else if (codes.includes('NEAR_DUP_INV_NO_OR_ALIAS')) {
        buckets.get('OCR_TYPO_NEAR_DUP')!.push(item);
      } else if (codes.includes('EXACT_DUPLICATE_INVOICE')) {
        buckets.get('EXACT_RESUBMISSION')!.push(item);
      } else {
        otherBucket.push(item);
      }
    }

    // Within each bucket, sort or rotate so consecutive items have different vendor_ids
    const diversifyByVendor = (list: LedgerRecord[]): LedgerRecord[] => {
      const byVendor = new Map<string, LedgerRecord[]>();
      for (const rec of list) {
        const vid = String(rec.vendor_id || '');
        if (!byVendor.has(vid)) byVendor.set(vid, []);
        byVendor.get(vid)!.push(rec);
      }
      const vendorQueues = Array.from(byVendor.values());
      const out: LedgerRecord[] = [];
      let added = true;
      while (added) {
        added = false;
        for (const q of vendorQueues) {
          if (q.length > 0) {
            out.push(q.shift()!);
            added = true;
          }
        }
      }
      return out;
    };

    const diversifiedQueues = bucketOrder.map((k) =>
      diversifyByVendor(buckets.get(k) || [])
    );
    if (otherBucket.length > 0) {
      diversifiedQueues.push(diversifyByVendor(otherBucket));
    }

    const interleaved: LedgerRecord[] = [];
    let hasMore = true;
    while (hasMore) {
      hasMore = false;
      for (const q of diversifiedQueues) {
        if (q.length > 0) {
          interleaved.push(q.shift()!);
          hasMore = true;
        }
      }
    }
    return interleaved;
  }, [items, reasonFilter]);

  return (
    <section aria-label="Pre-Disbursement Priority Queue" className="space-y-5">
      {/* Clean Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white tracking-tight">
            Pre-Disbursement Priority Queue
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            Showing <span className="text-zinc-200 font-medium">{displayItems.length}</span> of{' '}
            <span className="text-zinc-200 font-medium">{totalMatching.toLocaleString('en-IN')}</span>{' '}
            flagged invoices requiring auditor review before payment release.
          </p>
        </div>

        {/* Search + Action Filter + Export CSV */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search supplier, GSTIN, or invoice..."
              aria-label="Search triage queue"
              className="pl-10 pr-12 py-2 w-64 sm:w-72 text-sm bg-[#0B0C10] border border-white/[0.09] hover:border-white/[0.16] rounded-xl text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500 transition-all"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 px-1.5 py-0.5 text-[10px] font-mono text-zinc-400 bg-white/[0.05] border border-white/[0.08] rounded pointer-events-none">
              /
            </span>
          </div>

          <div className="relative flex items-center">
            <SlidersHorizontal className="w-3.5 h-3.5 text-zinc-400 absolute left-3.5 pointer-events-none" />
            <select
              aria-label="Filter by recommended action"
              value={actionFilter}
              onChange={(e) => onActionFilterChange(e.target.value)}
              className="pl-9 pr-3.5 py-2 text-xs font-medium bg-[#0B0C10] border border-white/[0.09] hover:border-white/[0.16] rounded-xl text-zinc-200 focus:outline-none focus:border-indigo-500 transition-all cursor-pointer"
            >
              <option value="ALL">All Recommended Actions</option>
              <option value="HOLD_DUPLICATE_RESUBMISSION">Hold Duplicate Resubmission</option>
              <option value="ABSTAIN_MANUAL_OCR_VERIFY">Manual OCR &amp; Math Verify</option>
              <option value="ESCALATE_SPLIT_PO_BYPASS">Escalate Split-PO Bypass</option>
              <option value="HOLD_VENDOR_BANK_RING_AUDIT">Hold Shared Bank Audit</option>
              <option value="HOLD_RATE_CONTRACT_REVIEW">Hold Rate Contract Review</option>
            </select>
          </div>

          <button
            type="button"
            onClick={handleExportCSV}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-zinc-200 bg-[#0B0C10] hover:bg-white/[0.06] border border-white/[0.09] hover:border-white/[0.18] rounded-xl transition-all whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-indigo-400" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Reason Filter Pills */}
      <div
        role="tablist"
        aria-label="Filter queue by reason"
        className="flex flex-wrap items-center gap-1.5 bg-[#0B0C10] p-1.5 rounded-xl border border-white/[0.07] w-fit"
      >
        {FILTER_TABS.map((tab) => {
          const active = reasonFilter === tab.key;
          return (
            <button
              key={tab.key}
              role="tab"
              aria-selected={active}
              type="button"
              onClick={() => onReasonFilterChange(tab.key)}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-lg transition-all duration-150 whitespace-nowrap shrink-0 cursor-pointer ${
                active
                  ? 'bg-indigo-500/20 text-indigo-200 border border-indigo-500/40 shadow-xs'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04] border border-transparent'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Breathable, Readable Auditor Table Fitting 100% Within Viewport */}
      <div className="rounded-2xl border border-white/[0.08] bg-[#0B0C10]/90 backdrop-blur-xl shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] overflow-hidden">
        <div className="w-full overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-[#08090E] border-b border-white/[0.08]">
              <tr className="text-xs font-medium text-zinc-400">
                <th className="py-3.5 pl-4 pr-3.5 whitespace-nowrap">Voucher ID</th>
                <th className="py-3.5 px-3.5">Supplier Name &amp; GSTIN</th>
                <th className="py-3.5 px-3.5 whitespace-nowrap">Invoice No &amp; Date</th>
                <th className="py-3.5 px-3.5 text-right whitespace-nowrap">Amount (₹)</th>
                <th className="py-3.5 px-3.5 whitespace-nowrap">Why It Was Flagged</th>
                <th className="py-3.5 px-3.5 whitespace-nowrap">Risk Score</th>
                <th className="py-3.5 pl-3.5 pr-4 text-right whitespace-nowrap">Status / Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05] text-sm">
              {loading ? (
                Array.from({ length: 7 }).map((_, idx) => (
                  <tr key={idx} className="animate-pulse">
                    <td className="py-3.5 pl-4 pr-3.5"><div className="h-4 w-24 bg-white/[0.06] rounded" /></td>
                    <td className="py-3.5 px-3.5"><div className="h-4 w-40 bg-white/[0.06] rounded" /></td>
                    <td className="py-3.5 px-3.5"><div className="h-4 w-32 bg-white/[0.06] rounded" /></td>
                    <td className="py-3.5 px-3.5 text-right"><div className="h-4 w-20 bg-white/[0.06] rounded ml-auto" /></td>
                    <td className="py-3.5 px-3.5"><div className="h-6 w-32 bg-white/[0.06] rounded-full" /></td>
                    <td className="py-3.5 px-3.5"><div className="h-4 w-20 bg-white/[0.06] rounded" /></td>
                    <td className="py-3.5 pl-3.5 pr-4 text-right"><div className="h-8 w-24 bg-white/[0.06] rounded-lg ml-auto" /></td>
                  </tr>
                ))
              ) : displayItems.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-16 px-6 text-center">
                    <ShieldAlert className="w-7 h-7 text-zinc-500 mx-auto mb-2.5" />
                    <p className="text-base font-medium text-zinc-200">
                      No flagged vouchers match your current filter
                    </p>
                    <p className="text-xs text-zinc-500 mt-1">
                      Clear your search query or switch back to &ldquo;All&rdquo; to see all {totalMatching} alerts.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        onReasonFilterChange('ALL');
                        onActionFilterChange('ALL');
                        onSearchChange('');
                      }}
                      className="mt-4 px-4 py-2 text-xs font-medium text-black bg-white hover:bg-zinc-200 rounded-xl transition-colors cursor-pointer"
                    >
                      Reset Filters
                    </button>
                  </td>
                </tr>
              ) : (
                displayItems.map((row) => {
                  const codes = String(row.reason_codes || '')
                    .split('|')
                    .filter(Boolean);
                  const primaryCode = codes[0] || 'NEAR_DUP_INV_NO_OR_ALIAS';
                  const badgeInfo = FRIENDLY_REASON_BADGE[primaryCode] || {
                    label: primaryCode.replace(/_/g, ' '),
                    style: 'text-zinc-200 bg-white/[0.06] border-white/[0.12]',
                  };

                  const score = Number(row.hybrid_risk_score || 0);
                  const pct = Math.round(score * 100);
                  const isAbstention =
                    row.recommended_action === 'ABSTAIN_MANUAL_OCR_VERIFY';
                  const isCritical = score >= 0.9;

                  const barColor = isAbstention
                    ? 'bg-amber-400'
                    : isCritical
                    ? 'bg-rose-500'
                    : 'bg-indigo-400';

                  const textColor = isAbstention
                    ? 'text-amber-300'
                    : isCritical
                    ? 'text-rose-400'
                    : 'text-indigo-300';

                  return (
                    <tr
                      key={row.record_id}
                      onClick={() => onInspectRecord(row)}
                      className="group hover:bg-white/[0.03] transition-colors cursor-pointer"
                    >
                      {/* 1. Voucher ID */}
                      <td className="py-3.5 pl-4 pr-3.5 font-mono text-xs text-zinc-200 whitespace-nowrap font-medium">
                        {row.record_id}
                      </td>

                      {/* 2. Supplier Name & GSTIN */}
                      <td className="py-3.5 px-3.5 max-w-[200px]">
                        <div
                          className="font-medium text-white truncate"
                          title={row.vendor_name}
                        >
                          {row.vendor_name}
                        </div>
                        <div className="text-[11px] text-zinc-500 font-mono mt-0.5 truncate">
                          GSTIN: {row.gstin}
                        </div>
                      </td>

                      {/* 3. Invoice No & Date */}
                      <td className="py-3.5 px-3.5 whitespace-nowrap">
                        <div className="font-mono text-xs font-medium text-zinc-100">
                          {row.invoice_no}
                        </div>
                        <div className="text-[11px] text-zinc-500 mt-0.5">
                          {row.invoice_date}
                        </div>
                      </td>

                      {/* 4. Amount (₹) */}
                      <td className="py-3.5 px-3.5 text-right font-mono tabular-nums font-semibold text-white whitespace-nowrap">
                        {formatINR(Number(row.gross_total))}
                      </td>

                      {/* 5. Why It Was Flagged (1 clean human-readable badge) */}
                      <td className="py-3.5 px-3.5 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full border ${badgeInfo.style}`}
                        >
                          {badgeInfo.label}
                        </span>
                      </td>

                      {/* 6. Risk Score (Clean percentage + color bar) */}
                      <td className="py-3.5 px-3.5 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span
                            className={`font-mono text-xs font-semibold tabular-nums w-8 ${textColor}`}
                          >
                            {pct}%
                          </span>
                          <div className="w-16 h-1.5 bg-white/[0.07] rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${barColor}`}
                              style={{ width: `${Math.min(100, pct)}%` }}
                            />
                          </div>
                        </div>
                      </td>

                      {/* 7. Status / Action */}
                      <td className="py-3.5 pl-3.5 pr-4 text-right whitespace-nowrap">
                        {row.disposition ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 rounded-lg whitespace-nowrap">
                            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                            <span>
                              {row.disposition.decision === 'CONFIRM_DUPLICATE'
                                ? 'Confirmed'
                                : row.disposition.decision === 'HOLD_PAYMENT'
                                ? 'Held'
                                : 'Released'}
                            </span>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onInspectRecord(row);
                            }}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-white/[0.1] bg-white/[0.04] text-zinc-200 group-hover:bg-white group-hover:text-black group-hover:border-white transition-all whitespace-nowrap cursor-pointer"
                          >
                            <span>Review Diff</span>
                            <ArrowRight className="w-3.5 h-3.5 shrink-0 transition-transform group-hover:translate-x-0.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
};
