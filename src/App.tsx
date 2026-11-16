import React, { useCallback, useEffect, useState } from 'react';
import {
  History,
  RefreshCw,
  ShieldCheck,
  Cpu,
  Sparkles,
  ShieldAlert,
  GitMerge,
  BarChart3,
  Plus,
  CheckCircle2,
  AlertTriangle,
  Code2,
  ChevronDown,
  ChevronUp,
  Building2,
  Landmark,
} from 'lucide-react';
import { MetricsHeader, formatINR, formatINRCompact } from './components/MetricsHeader';
import { TriageQueueTable } from './components/TriageQueueTable';
import { SideBySideDiffModal } from './components/SideBySideDiffModal';
import { InvoiceUploadModal } from './components/InvoiceUploadModal';
import { AuditTrailDrawer } from './components/AuditTrailDrawer';
import type {
  AuditDisposition,
  LedgerRecord,
  ReasonFilterKey,
  Stage6MetricsSummary,
} from './types/ledger';

type WorkspaceSection = 'overview' | 'workbench' | 'architecture' | 'benchmarks';

const HERO_SAMPLE_RECORD: LedgerRecord = {
  record_id: 'AP-2026-09151',
  vendor_id: 'VND-002',
  vendor_name: 'Apex Precision Comp. P. Ltd.',
  gstin: '29KPLCB1037L1Z0',
  bank_ifsc: 'ICIC0001001',
  bank_account: '918000104729',
  invoice_no: 'INV-2O26-10452/A',
  po_number: 'PO-2026-002-114',
  invoice_date: '2026-02-12',
  service_period: '2026-02',
  hsn_code: '8504',
  quantity: 6,
  unit_price: 11800,
  subtotal: 70800,
  tax_amount: 12744,
  gross_total: 83544,
  ocr_confidence: 0.96,
  is_anomaly: 1,
  anomaly_typology: 'OCR_TYPO_NEAR_DUP',
  erp_baseline_flag: 0,
  erp_baseline_score: 0.02,
  hybrid_flag: 1,
  hybrid_risk_score: 0.94,
  reason_codes: 'NEAR_DUP_INV_NO_OR_ALIAS',
  recommended_action: 'HOLD_DUPLICATE_RESUBMISSION',
  matched_record_id: 'AP-2026-00151',
  vendor_median_unit_price: 11800,
  unit_price_ratio: 1.0,
  matched_record: {
    record_id: 'AP-2026-00151',
    vendor_id: 'VND-002',
    vendor_name: 'Apex Precision Components Pvt Ltd',
    gstin: '29KPLCB1037L1Z0',
    bank_ifsc: 'ICIC0001001',
    bank_account: '918000104729',
    invoice_no: 'INV-2026-10452',
    po_number: 'PO-2026-002-114',
    invoice_date: '2026-02-11',
    service_period: '2026-02',
    hsn_code: '8504',
    quantity: 6,
    unit_price: 11800,
    subtotal: 70800,
    tax_amount: 12744,
    gross_total: 83544,
    ocr_confidence: 0.98,
    is_anomaly: 0,
    anomaly_typology: 'CLEAN_NORMAL',
    hybrid_risk_score: 0.03,
    reason_codes: 'CLEAN_PASS',
    recommended_action: 'AUTO_APPROVE_CLEAN',
    matched_record_id: '',
  },
};

const ENGINE_STEPS = [
  {
    step: 1,
    shortTitle: 'Step 1: Tax & GSTIN Math',
    headline: 'Deterministic Accounting & Low-OCR Abstention Gate',
    plainEnglish:
      'Before running any AI or similarity models, LedgerGuard checks basic accounting math. It validates the 15th check-digit of the supplier’s Indian GSTIN, verifies that Subtotal + 18% GST equals the Gross Total within ₹1.00, and checks if the PDF scan is clear (OCR confidence ≥ 80%). Blurry or math-mismatched bills are safely routed to a human instead of being auto-approved.',
    impactStat: '100 noisy / math-mismatched invoices safely routed to manual OCR verify',
    speedStat: '0.003 ms per invoice',
    formula:
      'verify_gstin_mod36(gstin) == True AND abs((subtotal + tax_amount) - gross_total) <= 1.00 AND ocr_confidence >= 0.80',
  },
  {
    step: 2,
    shortTitle: 'Step 2: Fuzzy OCR Match',
    headline: 'Candidate Blocking, OCR Typo Resolution & Monthly Rent Guardrail',
    plainEnglish:
      'Standard ERPs fail when a scanner reads a zero (0) as the letter O, or when a vendor adds "/A" to an already-paid invoice. LedgerGuard groups invoices by supplier and rounded amount, normalizes OCR lookalikes, and compares them with Jaro-Winkler similarity—while using a 30-day calendar guardrail so legitimate monthly rent or SaaS retainers are never falsely blocked.',
    impactStat: '100% of OCR & alias near-duplicates caught • 0.00% false holds on monthly rent',
    speedStat: '0.008 ms per invoice (O(N) blocking)',
    formula:
      'block_key = (vendor_id, round(gross_total, 0)); JaroWinkler(normalize_ocr(inv_a), normalize_ocr(inv_b)) >= 0.88 AND NOT (25 <= day_gap <= 35 AND service_period_a != service_period_b)',
  },
  {
    step: 3,
    shortTitle: 'Step 3: Shared Bank Graph',
    headline: 'Bipartite Supplier-to-Bank Account Link Analysis',
    plainEnglish:
      'Colluding vendors or shell companies often register under different legal names and GSTINs, but route payouts to the exact same beneficiary bank account. LedgerGuard builds a live network graph connecting Supplier IDs to Bank IFSC + Account numbers and flags any bank account shared by two or more distinct suppliers.',
    impactStat: '100 cross-vendor shared bank payouts intercepted across 25 supplier rings',
    speedStat: '0.005 ms per invoice (NetworkX bipartite degree)',
    formula:
      'G = nx.Graph(); G.add_edge(vendor_id, f"{bank_ifsc}:{bank_account}"); flag if G.degree(bank_node) > 1 across distinct vendor_ids',
  },
  {
    step: 4,
    shortTitle: 'Step 4: Split-PO Velocity',
    headline: '72-Hour Split-Invoice Bypass & Unit-Price Inflation Scorer',
    plainEnglish:
      'To bypass the ₹50,000 manager approval rule, a supplier might split a ₹1,22,000 order into three ₹40,700 invoices submitted over 48 hours. Layer 4 scans rolling 72-hour windows per vendor to catch split clusters, and compares item unit prices against the supplier’s historical median rate to catch sudden >20% price inflation.',
    impactStat: '150 split-PO invoices (50 clusters) & 100 price-inflation bills caught',
    speedStat: '0.007 ms per invoice (Rolling window + IsolationForest)',
    formula:
      'sum(gross_total for inv in vendor_72h_window if gross_total < 50000) > 57500 OR (unit_price / vendor_median_unit_price) > 1.20',
  },
];

export default function App() {
  const [activeSection, setActiveSection] = useState<WorkspaceSection>('overview');

  const [metrics, setMetrics] = useState<Stage6MetricsSummary | null>(null);
  const [metricsLoading, setMetricsLoading] = useState<boolean>(true);

  const [queueItems, setQueueItems] = useState<LedgerRecord[]>([]);
  const [totalMatching, setTotalMatching] = useState<number>(1000);
  const [queueLoading, setQueueLoading] = useState<boolean>(true);

  const [reasonFilter, setReasonFilter] = useState<ReasonFilterKey>('ALL');
  const [actionFilter, setActionFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const [selectedRecord, setSelectedRecord] = useState<LedgerRecord | null>(null);
  const [uploadModalOpen, setUploadModalOpen] = useState<boolean>(false);
  const [auditDrawerOpen, setAuditDrawerOpen] = useState<boolean>(false);
  const [dispositions, setDispositions] = useState<AuditDisposition[]>([]);
  const [rerunning, setRerunning] = useState<boolean>(false);

  // Interactive state for View 3 (4-Layer Engine Flow)
  const [selectedStepIdx, setSelectedStepIdx] = useState<number>(0);
  const [showFormula, setShowFormula] = useState<boolean>(false);

  const fetchMetrics = useCallback(async () => {
    setMetricsLoading(true);
    try {
      const res = await fetch('/api/metrics');
      if (res.ok) {
        const data: Stage6MetricsSummary = await res.json();
        setMetrics(data);
      }
    } catch (err) {
      console.error('Error loading Stage 6 metrics:', err);
    } finally {
      setMetricsLoading(false);
    }
  }, []);

  const fetchQueue = useCallback(async () => {
    setQueueLoading(true);
    try {
      const params = new URLSearchParams({
        limit: '150',
        reason_filter: reasonFilter,
        action_filter: actionFilter,
        search: searchQuery,
      });
      const res = await fetch(`/api/queue?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setQueueItems(data.items || []);
        setTotalMatching(data.total_matching || 0);
      }
    } catch (err) {
      console.error('Error loading triage queue:', err);
    } finally {
      setQueueLoading(false);
    }
  }, [reasonFilter, actionFilter, searchQuery]);

  const fetchAuditTrail = useCallback(async () => {
    try {
      const res = await fetch('/api/audit-trail');
      if (res.ok) {
        const data = await res.json();
        setDispositions(data.items || []);
      }
    } catch (err) {
      console.error('Error loading audit trail:', err);
    }
  }, []);

  useEffect(() => {
    fetchMetrics();
    fetchAuditTrail();
  }, [fetchMetrics, fetchAuditTrail]);

  useEffect(() => {
    fetchQueue();
  }, [fetchQueue]);

  const handleDispositionSubmitted = (newDisp: AuditDisposition) => {
    setDispositions((prev) => [
      newDisp,
      ...prev.filter((d) => d.disposition_id !== newDisp.disposition_id),
    ]);
    setQueueItems((prev) =>
      prev.map((item) =>
        item.record_id === newDisp.record_id
          ? { ...item, disposition: newDisp }
          : item
      )
    );
    if (selectedRecord && selectedRecord.record_id === newDisp.record_id) {
      setSelectedRecord({ ...selectedRecord, disposition: newDisp });
    }
  };

  const handleRerunEvaluation = async () => {
    setRerunning(true);
    try {
      const res = await fetch('/api/rerun-stage6', { method: 'POST' });
      if (res.ok) {
        await Promise.all([fetchMetrics(), fetchQueue()]);
      }
    } finally {
      setRerunning(false);
    }
  };

  const latencySec = metrics
    ? metrics.batch_scoring_latency_sec.toFixed(2)
    : '0.23';

  const protectedCrores = metrics
    ? formatINRCompact(metrics.overall_comparison.hybrid_protected_inr)
    : '₹15.93 Cr';

  const totalAlertsCount = metrics ? metrics.total_flagged_alerts : 1000;
  const activeStep = ENGINE_STEPS[selectedStepIdx];

  return (
    <div className="min-h-screen bg-[#050507] text-zinc-100 flex flex-col lg:flex-row selection:bg-indigo-500/30 selection:text-indigo-200">
      {/* 1. PERSISTENT LEFT SIDEBAR (w-64 on Desktop, Compact Top Strip on Mobile) */}
      <aside className="w-full lg:w-64 lg:fixed lg:inset-y-0 lg:left-0 bg-[#08090E] border-b lg:border-b-0 lg:border-r border-white/[0.07] flex flex-col justify-between p-4 select-none z-30 shrink-0">
        <div className="space-y-6">
          {/* Top Brand Header */}
          <div className="flex items-center justify-between lg:justify-start gap-3 px-2 pt-1">
            <button
              type="button"
              onClick={() => setActiveSection('overview')}
              className="flex items-center gap-3 text-left cursor-pointer"
            >
              <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-indigo-500/30 via-violet-500/20 to-emerald-500/20 border border-indigo-400/40 flex items-center justify-center shadow-[0_0_20px_rgba(99,102,241,0.25)] shrink-0">
                <Cpu className="w-4 h-4 text-indigo-300" />
              </div>
              <div>
                <div className="text-sm font-bold tracking-tight text-white">
                  LedgerGuard AI
                </div>
                <div className="text-[11px] text-zinc-400">
                  AP Audit Intelligence
                </div>
              </div>
            </button>

            {/* Mobile Quick Test Button */}
            <button
              type="button"
              onClick={() => setUploadModalOpen(true)}
              className="lg:hidden inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white text-black rounded-lg"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Test Invoice</span>
            </button>
          </div>

          {/* Primary Navigation Menu */}
          <nav aria-label="Workspace Views" className="space-y-1">
            <div className="px-2 pb-1.5 text-[11px] font-medium text-zinc-500 hidden lg:block">
              Workspace Views
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-1 gap-1.5">
              <button
                type="button"
                onClick={() => setActiveSection('overview')}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium transition-all cursor-pointer ${
                  activeSection === 'overview'
                    ? 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 shadow-xs'
                    : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.04] border border-transparent'
                }`}
              >
                <span className="flex items-center gap-2.5 truncate">
                  <Sparkles className="w-4 h-4 shrink-0" />
                  <span className="truncate">Overview &amp; Live Demo</span>
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveSection('workbench')}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium transition-all cursor-pointer ${
                  activeSection === 'workbench'
                    ? 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 shadow-xs'
                    : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.04] border border-transparent'
                }`}
              >
                <span className="flex items-center gap-2.5 truncate">
                  <ShieldAlert className="w-4 h-4 shrink-0" />
                  <span className="truncate">Triage Workbench</span>
                </span>
                <span className="ml-2 px-1.5 py-0.5 text-[10px] font-mono rounded-md bg-rose-500/15 text-rose-300 border border-rose-500/25 tabular-nums">
                  {totalAlertsCount.toLocaleString('en-IN')}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveSection('architecture')}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium transition-all cursor-pointer ${
                  activeSection === 'architecture'
                    ? 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 shadow-xs'
                    : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.04] border border-transparent'
                }`}
              >
                <span className="flex items-center gap-2.5 truncate">
                  <GitMerge className="w-4 h-4 shrink-0" />
                  <span className="truncate">4-Layer Engine Flow</span>
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveSection('benchmarks')}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium transition-all cursor-pointer ${
                  activeSection === 'benchmarks'
                    ? 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 shadow-xs'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04] border border-transparent'
                }`}
              >
                <span className="flex items-center gap-2.5 truncate">
                  <BarChart3 className="w-4 h-4 shrink-0" />
                  <span className="truncate">Benchmarks &amp; Proof</span>
                </span>
              </button>
            </div>
          </nav>
        </div>

        {/* Bottom Quick Actions & Sidebar Footer */}
        <div className="hidden lg:flex flex-col gap-4 pt-6 border-t border-white/[0.07]">
          <div className="space-y-2">
            <div className="px-1 text-[11px] font-medium text-zinc-500">
              Quick Actions
            </div>

            <button
              type="button"
              onClick={() => setUploadModalOpen(true)}
              className="w-full flex items-center justify-center gap-2 bg-white text-black hover:bg-zinc-200 font-semibold text-xs py-2.5 px-3 rounded-xl shadow-lg transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Test Live Invoice</span>
            </button>

            <button
              type="button"
              onClick={() => setAuditDrawerOpen(true)}
              className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-medium text-zinc-200 bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.08] rounded-xl transition-all cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <History className="w-3.5 h-3.5 text-indigo-400" />
                <span>Audit Decision Log</span>
              </span>
              <span className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 tabular-nums">
                {dispositions.length}
              </span>
            </button>

            <button
              type="button"
              onClick={handleRerunEvaluation}
              disabled={rerunning}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.03] rounded-xl transition-all cursor-pointer"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${
                  rerunning ? 'animate-spin text-indigo-400' : ''
                }`}
              />
              <span>{rerunning ? 'Scoring 10k rows...' : 'Re-Verify 10k Corpus'}</span>
            </button>
          </div>

          {/* Sidebar Footer: Live Engine Status Pill */}
          <div className="px-3 py-2.5 rounded-xl bg-[#050507] border border-white/[0.06] flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            <span className="text-[11px] font-mono text-zinc-300 tabular-nums whitespace-nowrap">
              Engine Online • {latencySec}s (10k)
            </span>
          </div>
        </div>
      </aside>

      {/* 2. MAIN WORKSPACE CANVAS */}
      <div className="flex-1 lg:pl-64 flex flex-col min-h-screen">
        <main className="max-w-6xl w-full mx-auto px-5 sm:px-8 py-8 sm:py-10 flex-1">
          {/* ================================================================
              VIEW 1: OVERVIEW & LIVE DEMO
             ================================================================ */}
          {activeSection === 'overview' && (
            <div className="space-y-10">
              {/* 1. Spacious Hero Header */}
              <div className="rounded-3xl border border-white/[0.08] bg-gradient-to-b from-[#0B0C10] to-[#08090E] py-10 px-6 sm:px-10 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] relative overflow-hidden">
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute -top-24 right-10 w-80 h-80 rounded-full bg-indigo-500/10 blur-[100px]"
                />

                <div className="relative max-w-3xl space-y-5">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/25 text-xs font-medium text-indigo-300">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>AI Pre-Disbursement Audit for Accounts Payable</span>
                  </div>

                  <h1 className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight text-white leading-[1.12]">
                    Stop Duplicate Payouts &amp; Invoice Fraud Before Money Leaves the Bank.
                  </h1>

                  <p className="text-base text-zinc-400 max-w-2xl leading-relaxed">
                    Standard ERPs like SAP and Tally only catch exact copy-paste duplicates. LedgerGuard AI catches OCR typos, split-invoice threshold bypasses, and shared bank accounts across 10,000 invoices in {latencySec} seconds.
                  </p>

                  <div className="flex flex-wrap items-center gap-3.5 pt-2">
                    <button
                      type="button"
                      onClick={() => setActiveSection('workbench')}
                      className="inline-flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold bg-white text-black hover:bg-zinc-200 shadow-[0_0_25px_rgba(255,255,255,0.2)] transition-all cursor-pointer"
                    >
                      <span>
                        Open Triage Workbench ({totalAlertsCount.toLocaleString('en-IN')} Alerts) &rarr;
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setUploadModalOpen(true)}
                      className="inline-flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-medium text-zinc-100 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.12] transition-all cursor-pointer"
                    >
                      <span>Try 1-Click Live Invoice Test</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* 2. Three Simple Summary Stat Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="rounded-2xl border border-white/[0.08] bg-[#0B0C10]/90 p-6 space-y-2 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)]">
                  <div className="text-3xl font-semibold text-emerald-400 font-mono tabular-nums">
                    {protectedCrores} Protected
                  </div>
                  <div className="text-sm font-medium text-white">
                    100% Near-Duplicate Capture
                  </div>
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    Caught 100% of near-duplicates vs. 27% in SAP/Tally across 80 Indian suppliers.
                  </p>
                </div>

                <div className="rounded-2xl border border-white/[0.08] bg-[#0B0C10]/90 p-6 space-y-2 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)]">
                  <div className="text-3xl font-semibold text-white font-mono tabular-nums">
                    0.00% False Holds
                  </div>
                  <div className="text-sm font-medium text-white">
                    Smart Monthly Retainer Guardrail
                  </div>
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    Never blocks legitimate monthly rent or SaaS retainers billed on 30-day cycles.
                  </p>
                </div>

                <div className="rounded-2xl border border-white/[0.08] bg-[#0B0C10]/90 p-6 space-y-2 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)]">
                  <div className="text-3xl font-semibold text-indigo-300 font-mono tabular-nums">
                    {latencySec} Seconds
                  </div>
                  <div className="text-sm font-medium text-white">
                    Real-Time Pre-Disbursement Speed
                  </div>
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    Full 10,000-voucher ledger verified on CPU with zero external database lag.
                  </p>
                </div>
              </div>

              {/* 3. Interactive "See It In Action" Visual Diff Card */}
              <div className="rounded-2xl border border-white/[0.09] bg-[#0B0C10]/90 p-6 sm:p-8 space-y-6 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)]">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <div className="text-xs font-medium text-indigo-400 uppercase tracking-wider">
                      See It In Action
                    </div>
                    <h2 className="text-xl font-semibold text-white mt-1">
                      How SAP Misses a ₹83,544 Duplicate vs. How LedgerGuard Catches It
                    </h2>
                  </div>

                  <button
                    type="button"
                    onClick={() => setSelectedRecord(HERO_SAMPLE_RECORD)}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold bg-indigo-500 hover:bg-indigo-400 text-white shadow-[0_0_20px_rgba(99,102,241,0.3)] transition-all cursor-pointer"
                  >
                    <span>Inspect Full Forensic Diff &rarr;</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Left: Incoming Mutated Invoice */}
                  <div className="rounded-xl border border-rose-500/30 bg-rose-500/[0.05] p-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-300">
                        <AlertTriangle className="w-4 h-4" />
                        Incoming Resubmitted Invoice
                      </span>
                      <span className="px-2.5 py-0.5 text-xs font-mono rounded-full bg-rose-500/15 text-rose-300 border border-rose-500/30">
                        Blocked • 94% Risk
                      </span>
                    </div>

                    <div className="space-y-2.5 text-sm">
                      <div className="flex items-center justify-between py-1.5 border-b border-white/[0.06]">
                        <span className="text-zinc-400">Invoice Number</span>
                        <span className="font-mono font-semibold text-white">
                          INV-2
                          <mark className="bg-rose-500/30 text-rose-200 border border-rose-400/50 px-1 rounded mx-0.5">
                            O
                          </mark>
                          26-10452
                          <mark className="bg-rose-500/30 text-rose-200 border border-rose-400/50 px-1 rounded ml-0.5">
                            /A
                          </mark>
                        </span>
                      </div>

                      <div className="flex items-center justify-between py-1.5 border-b border-white/[0.06]">
                        <span className="text-zinc-400">Supplier Name</span>
                        <span className="text-rose-200 font-medium">
                          Apex Precision Comp. P. Ltd.
                        </span>
                      </div>

                      <div className="flex items-center justify-between py-1.5">
                        <span className="text-zinc-400">Date &amp; Gross Amount</span>
                        <span className="font-mono text-white font-semibold">
                          2026-02-12 • {formatINR(83544)}
                        </span>
                      </div>
                    </div>

                    <div className="text-xs text-rose-200/90 bg-rose-500/10 border border-rose-500/20 rounded-lg p-3">
                      <strong>Why SAP Missed It:</strong> The digit <code className="font-mono">0</code> was OCR-scanned as the letter <code className="font-mono">O</code> and <code className="font-mono">/A</code> was appended, bypassing exact-string matching.
                    </div>
                  </div>

                  {/* Right: Already Paid Historical Invoice */}
                  <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.04] p-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-300">
                        <CheckCircle2 className="w-4 h-4" />
                        Already Paid Historical Voucher (AP-2026-00151)
                      </span>
                      <span className="px-2.5 py-0.5 text-xs font-mono rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                        Paid 1 Day Earlier
                      </span>
                    </div>

                    <div className="space-y-2.5 text-sm">
                      <div className="flex items-center justify-between py-1.5 border-b border-white/[0.06]">
                        <span className="text-zinc-400">Invoice Number</span>
                        <span className="font-mono font-semibold text-emerald-300">
                          INV-2026-10452
                        </span>
                      </div>

                      <div className="flex items-center justify-between py-1.5 border-b border-white/[0.06]">
                        <span className="text-zinc-400">Supplier Name</span>
                        <span className="text-zinc-200 font-medium">
                          Apex Precision Components Pvt Ltd
                        </span>
                      </div>

                      <div className="flex items-center justify-between py-1.5">
                        <span className="text-zinc-400">Date &amp; Gross Amount</span>
                        <span className="font-mono text-white font-semibold">
                          2026-02-11 • {formatINR(83544)}
                        </span>
                      </div>
                    </div>

                    <div className="text-xs text-emerald-200/90 bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3">
                      <strong>How LedgerGuard Caught It:</strong> Layer 2 blocked by <code className="font-mono">(VND-002, ₹83,544)</code> and matched the canonical invoice ID with 96% Jaro-Winkler similarity.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ================================================================
              VIEW 2: TRIAGE WORKBENCH
             ================================================================ */}
          {activeSection === 'workbench' && (
            <TriageQueueTable
              items={queueItems}
              totalMatching={totalMatching}
              loading={queueLoading}
              reasonFilter={reasonFilter}
              onReasonFilterChange={setReasonFilter}
              actionFilter={actionFilter}
              onActionFilterChange={setActionFilter}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              onInspectRecord={(rec) => setSelectedRecord(rec)}
            />
          )}

          {/* ================================================================
              VIEW 3: 4-LAYER ENGINE FLOW (INTERACTIVE STEPPER)
             ================================================================ */}
          {activeSection === 'architecture' && (
            <section aria-label="4-Layer Engine Flow" className="space-y-8">
              <div>
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/25 text-xs font-medium text-indigo-300 mb-3">
                  <GitMerge className="w-3.5 h-3.5" />
                  <span>Interactive Architecture Walkthrough • 0.023 ms per Invoice</span>
                </div>
                <h1 className="text-2xl sm:text-3xl font-semibold text-white tracking-tight">
                  How the 4-Layer Hybrid Detection Engine Works
                </h1>
                <p className="text-sm text-zinc-400 mt-1 max-w-2xl">
                  Click any step in the pipeline below to see what it checks in plain English and inspect a real visual example.
                </p>
              </div>

              {/* 4 Connected Visual Stepper Nodes */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                {ENGINE_STEPS.map((item, idx) => {
                  const active = selectedStepIdx === idx;
                  return (
                    <button
                      key={item.step}
                      type="button"
                      onClick={() => setSelectedStepIdx(idx)}
                      className={`p-4 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                        active
                          ? 'bg-indigo-500/15 border-indigo-500/50 text-white shadow-[0_0_25px_rgba(99,102,241,0.2)]'
                          : 'bg-[#0B0C10]/90 border-white/[0.08] text-zinc-400 hover:text-zinc-200 hover:border-white/[0.16]'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span
                          className={`h-7 w-7 rounded-lg flex items-center justify-center text-xs font-bold font-mono ${
                            active
                              ? 'bg-indigo-500 text-white'
                              : 'bg-white/[0.06] text-zinc-400'
                          }`}
                        >
                          0{item.step}
                        </span>
                        <span className="text-[11px] font-mono text-zinc-500">
                          {item.speedStat.split(' ')[0]} ms
                        </span>
                      </div>
                      <div className="mt-3 font-semibold text-sm text-white">
                        {item.shortTitle}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Active Step Visual Explanation Card */}
              <div className="rounded-2xl border border-white/[0.09] bg-[#0B0C10]/95 p-6 sm:p-8 space-y-6 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]">
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.07] pb-5">
                  <div>
                    <div className="text-xs font-mono text-indigo-400 uppercase tracking-wider">
                      {activeStep.shortTitle}
                    </div>
                    <h2 className="text-xl sm:text-2xl font-semibold text-white mt-1">
                      {activeStep.headline}
                    </h2>
                  </div>
                  <div className="px-3.5 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-xs font-medium text-emerald-300">
                    {activeStep.impactStat}
                  </div>
                </div>

                {/* Plain-English Explanation */}
                <p className="text-sm sm:text-base text-zinc-300 leading-relaxed max-w-3xl">
                  {activeStep.plainEnglish}
                </p>

                {/* Visual Mini-Example per Step */}
                <div className="rounded-xl border border-white/[0.08] bg-[#050507] p-5">
                  <div className="text-xs font-medium text-zinc-400 mb-4">
                    Visual Example — What Layer {activeStep.step} Sees:
                  </div>

                  {activeStep.step === 1 && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                      <div className="p-4 rounded-xl bg-[#0B0C10] border border-white/[0.07]">
                        <div className="text-xs text-zinc-400">Subtotal + 18% GST</div>
                        <div className="font-mono font-semibold text-white mt-1">
                          ₹60,000 + ₹10,800 = ₹70,800
                        </div>
                      </div>
                      <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30">
                        <div className="text-xs text-rose-300">Billed Gross Total on Scan</div>
                        <div className="font-mono font-semibold text-rose-200 mt-1">
                          ₹71,950 (₹1,150 Mismatch)
                        </div>
                      </div>
                      <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30">
                        <div className="text-xs text-amber-300">Layer 1 Decision</div>
                        <div className="font-semibold text-amber-200 mt-1">
                          Abstain &rarr; Route to Human OCR Check
                        </div>
                      </div>
                    </div>
                  )}

                  {activeStep.step === 2 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                      <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 space-y-1">
                        <div className="text-xs font-semibold text-rose-300">
                          Blocked Near-Duplicate (1 Day Apart)
                        </div>
                        <div className="font-mono text-white">
                          INV-2<mark className="bg-rose-500 text-white px-1 rounded">O</mark>26-10452 vs. INV-2026-10452
                        </div>
                        <div className="text-xs text-zinc-400">
                          Same service period (2026-02) &rarr; Flagged (94% Risk)
                        </div>
                      </div>
                      <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-1">
                        <div className="text-xs font-semibold text-emerald-300">
                          Allowed Monthly Retainer (30 Days Apart)
                        </div>
                        <div className="font-mono text-white">
                          RET-JAN-7001 (₹53,100) vs. RET-FEB-7132 (₹53,100)
                        </div>
                        <div className="text-xs text-zinc-400">
                          Sequential periods (2026-01 &rarr; 2026-02) &rarr; Auto-Approved
                        </div>
                      </div>
                    </div>
                  )}

                  {activeStep.step === 3 && (
                    <div className="flex flex-col md:flex-row items-center justify-center gap-6 py-2">
                      <div className="space-y-3 w-full md:w-64">
                        <div className="p-3.5 rounded-xl bg-[#0B0C10] border border-white/[0.1] flex items-center gap-3">
                          <Building2 className="w-5 h-5 text-emerald-400 shrink-0" />
                          <div className="text-xs">
                            <div className="font-semibold text-white">Vendor A (VND-001)</div>
                            <div className="text-zinc-400">Bharat Industrial Pvt Ltd</div>
                          </div>
                        </div>
                        <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center gap-3">
                          <Building2 className="w-5 h-5 text-rose-400 shrink-0" />
                          <div className="text-xs">
                            <div className="font-semibold text-white">Vendor B (VND-026)</div>
                            <div className="text-rose-200">Chola Switchgear Pvt Ltd</div>
                          </div>
                        </div>
                      </div>

                      <div className="text-xs font-mono text-rose-400 flex items-center gap-2">
                        <span>Both route payouts to &rarr;</span>
                      </div>

                      <div className="p-5 rounded-2xl bg-rose-500/15 border border-rose-500/40 flex items-center gap-3.5 shadow-[0_0_25px_rgba(244,63,94,0.2)]">
                        <Landmark className="w-6 h-6 text-rose-300 shrink-0" />
                        <div>
                          <div className="text-xs uppercase font-mono text-rose-300">
                            Shared Beneficiary Bank (In-Degree = 2)
                          </div>
                          <div className="text-sm font-mono font-bold text-white mt-0.5">
                            HDFC0001000 • Acct #918000000000
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {activeStep.step === 4 && (
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs font-mono">
                        <div className="p-3.5 rounded-xl bg-[#0B0C10] border border-amber-500/30">
                          <div className="text-zinc-400">Day 1 • PO-2026-SPL-001</div>
                          <div className="text-base font-bold text-white mt-1">₹40,710.00</div>
                          <div className="text-emerald-400 mt-0.5">Under ₹50k limit</div>
                        </div>
                        <div className="p-3.5 rounded-xl bg-[#0B0C10] border border-amber-500/30">
                          <div className="text-zinc-400">Day 2 • PO-2026-SPL-001</div>
                          <div className="text-base font-bold text-white mt-1">₹41,120.00</div>
                          <div className="text-emerald-400 mt-0.5">Under ₹50k limit</div>
                        </div>
                        <div className="p-3.5 rounded-xl bg-[#0B0C10] border border-amber-500/30">
                          <div className="text-zinc-400">Day 3 • PO-2026-SPL-001</div>
                          <div className="text-base font-bold text-white mt-1">₹40,300.00</div>
                          <div className="text-emerald-400 mt-0.5">Under ₹50k limit</div>
                        </div>
                      </div>
                      <div className="p-3 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-between text-xs">
                        <span className="font-medium text-amber-200">
                          72-Hour Combined Cluster Total on Same Vendor &amp; PO:
                        </span>
                        <span className="font-mono font-bold text-amber-300 text-sm">
                          ₹1,22,130.00 &gt; ₹50,000 Approval Limit (Flagged!)
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Collapsible Technical Formula Toggle */}
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => setShowFormula((prev) => !prev)}
                    className="inline-flex items-center gap-2 text-xs font-mono text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
                  >
                    <Code2 className="w-3.5 h-3.5 text-indigo-400" />
                    <span>{showFormula ? 'Hide Technical Rule Formula' : 'Show Technical Rule Formula'}</span>
                    {showFormula ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>

                  {showFormula && (
                    <div className="mt-2.5 p-3.5 rounded-xl bg-[#050507] border border-white/[0.08] font-mono text-xs text-indigo-200 overflow-x-auto">
                      {activeStep.formula}
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* ================================================================
              VIEW 4: BENCHMARKS & PROOF
             ================================================================ */}
          {activeSection === 'benchmarks' && (
            <MetricsHeader
              metrics={metrics}
              loading={metricsLoading}
              onSelectTypologyFilter={(filter) => {
                setReasonFilter(filter);
                setActiveSection('workbench');
              }}
            />
          )}
        </main>

        {/* Quiet Workspace Footer */}
        <footer className="border-t border-white/[0.07] px-5 sm:px-8 py-5 mt-auto">
          <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-4 text-xs text-zinc-500">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-indigo-400" />
              <span>LedgerGuard AI • Pre-Disbursement AP Duplicate &amp; Policy Anomaly Workbench</span>
            </div>
            <div className="font-mono">
              10,000 Synthetic Benchmark Invoices • 80 Indian Vendors • Seed 42
            </div>
          </div>
        </footer>
      </div>

      {/* Modals & Slide-Over Drawers */}
      <SideBySideDiffModal
        record={selectedRecord}
        onClose={() => setSelectedRecord(null)}
        onDispositionSubmitted={handleDispositionSubmitted}
      />

      <InvoiceUploadModal
        isOpen={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        onInspectScoredRecord={(rec) => setSelectedRecord(rec)}
      />

      <AuditTrailDrawer
        isOpen={auditDrawerOpen}
        onClose={() => setAuditDrawerOpen(false)}
        dispositions={dispositions}
      />
    </div>
  );
}
