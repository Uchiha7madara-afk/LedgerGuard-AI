import React, { useState } from 'react';
import {
  X,
  Upload,
  Play,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Sparkles,
  ArrowRight,
} from 'lucide-react';
import type { LedgerRecord, LiveScoreResponse } from '../types/ledger';
import { formatINR } from './MetricsHeader';

interface InvoiceUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInspectScoredRecord: (record: LedgerRecord) => void;
}

const PRESET_SCENARIOS: Record<
  string,
  {
    title: string;
    subtitle: string;
    badge: string;
    badgeStyle: string;
    payload: Record<string, string | number>;
  }
> = {
  OCR_NEAR_DUP: {
    title: 'Preset 1: OCR Homoglyph Near-Duplicate',
    subtitle: 'Mutates INV-2025-010001 → INV-2O25-010001 on VND-001',
    badge: 'LAYER 2 // FUZZY BLOCK',
    badgeStyle: 'text-rose-300 bg-rose-500/10 border-rose-500/25',
    payload: {
      record_id: 'LIVE-OCR-9901',
      vendor_id: 'VND-001',
      vendor_name: 'Bharat Industrial Supplies Pvt Ltd',
      gstin: '27FMJCB1000K1Z3',
      bank_ifsc: 'HDFC0001000',
      bank_account: '918000000000',
      invoice_no: 'INV-2O25-010001',
      po_number: 'PO-2025-001-100',
      invoice_date: '2025-04-02',
      service_period: '2025-04',
      hsn_code: '8471',
      quantity: 4,
      unit_price: 11675.0,
      subtotal: 46700.0,
      tax_amount: 8406.0,
      gross_total: 55106.0,
      ocr_confidence: 0.91,
    },
  },
  MATH_OCR_ABSTENTION: {
    title: 'Preset 2: Low-OCR Math Mismatch Abstention',
    subtitle: 'Subtotal + GST ≠ Gross (+₹1,420 gap) & OCR 0.71 < 0.80',
    badge: 'LAYER 1 // ABSTAIN GATE',
    badgeStyle: 'text-amber-300 bg-amber-500/10 border-amber-500/25',
    payload: {
      record_id: 'LIVE-MTH-9904',
      vendor_id: 'VND-002',
      vendor_name: 'Apex Industrial Supplies Pvt Ltd',
      gstin: '29KPLCB1037L1Z0',
      bank_ifsc: 'ICIC0001001',
      bank_account: '918000104729',
      invoice_no: 'INV-2026-MTH-998',
      po_number: 'PO-2026-002-112',
      invoice_date: '2026-03-19',
      service_period: '2026-03',
      hsn_code: '8504',
      quantity: 6,
      unit_price: 8736.0,
      subtotal: 52416.0,
      tax_amount: 9434.88,
      gross_total: 63270.88,
      ocr_confidence: 0.71,
    },
  },
  SHARED_BANK_RING: {
    title: 'Preset 3: Shared Beneficiary Bank Ring',
    subtitle: 'VND-035 routing payout to VND-001 beneficiary account',
    badge: 'LAYER 3 // GRAPH IN-DEG > 1',
    badgeStyle: 'text-rose-400 bg-rose-500/10 border-rose-500/25',
    payload: {
      record_id: 'LIVE-BNK-9903',
      vendor_id: 'VND-035',
      vendor_name: 'Son Packaging Solutions Pvt Ltd',
      gstin: '36YTRCB2258Y1Z1',
      bank_ifsc: 'HDFC0001000',
      bank_account: '918000000000',
      invoice_no: 'INV-2026-LIVE-774',
      po_number: 'PO-2026-035-200',
      invoice_date: '2026-03-18',
      service_period: '2026-03',
      hsn_code: '4819',
      quantity: 12,
      unit_price: 5220.0,
      subtotal: 62640.0,
      tax_amount: 11275.2,
      gross_total: 73915.2,
      ocr_confidence: 0.95,
    },
  },
  RECURRING_CLEAN_HARD_NEG: {
    title: 'Preset 4: Clean Monthly SaaS Retainer',
    subtitle: '₹45,000 + GST monthly retainer on new service_period 2026-04',
    badge: 'HARD-NEG // AUTO PASS',
    badgeStyle: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25',
    payload: {
      record_id: 'LIVE-RET-9902',
      vendor_id: 'VND-001',
      vendor_name: 'Bharat Industrial Supplies Pvt Ltd',
      gstin: '27FMJCB1000K1Z3',
      bank_ifsc: 'HDFC0001000',
      bank_account: '918000000000',
      invoice_no: 'RET-APR-8950/01',
      po_number: 'PO-RET-001-ANNUAL',
      invoice_date: '2026-04-05',
      service_period: '2026-04',
      hsn_code: '9983',
      quantity: 1,
      unit_price: 12500.0,
      subtotal: 45000.0,
      tax_amount: 8100.0,
      gross_total: 53100.0,
      ocr_confidence: 0.96,
    },
  },
};

export const InvoiceUploadModal: React.FC<InvoiceUploadModalProps> = ({
  isOpen,
  onClose,
  onInspectScoredRecord,
}) => {
  const [selectedPreset, setSelectedPreset] = useState<string>('OCR_NEAR_DUP');
  const [formState, setFormState] = useState<Record<string, string | number>>(
    PRESET_SCENARIOS.OCR_NEAR_DUP.payload
  );
  const [scoring, setScoring] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [scoreResult, setScoreResult] = useState<LiveScoreResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSelectPreset = (key: string) => {
    setSelectedPreset(key);
    setFormState({ ...PRESET_SCENARIOS[key].payload });
    setScoreResult(null);
    setErrorMsg(null);
  };

  const handleFieldChange = (field: string, value: string) => {
    const numericFields = [
      'quantity',
      'unit_price',
      'subtotal',
      'tax_amount',
      'gross_total',
      'ocr_confidence',
    ];
    setFormState((prev) => ({
      ...prev,
      [field]: numericFields.includes(field) ? Number(value) : value,
    }));
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setErrorMsg(null);
    try {
      if (file.name.endsWith('.json')) {
        const text = await file.text();
        const parsed = JSON.parse(text);
        setFormState((prev) => ({ ...prev, ...parsed }));
      } else {
        const reader = new FileReader();
        const base64Promise = new Promise<string>((resolve, reject) => {
          reader.onload = () => {
            const res = String(reader.result || '');
            const b64 = res.includes(',') ? res.split(',')[1] : res;
            resolve(b64);
          };
          reader.onerror = reject;
        });
        reader.readAsDataURL(file);
        const base64Data = await base64Promise;

        const resp = await fetch('/api/extract-pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: file.name,
            mimeType: file.type || 'application/pdf',
            base64Data,
          }),
        });
        const extracted = await resp.json();
        if (!resp.ok) {
          throw new Error(extracted.error || 'Document extraction failed');
        }
        setFormState((prev) => ({
          ...prev,
          ...extracted.extracted_fields,
        }));
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to parse file');
    } finally {
      setUploading(false);
    }
  };

  const handleRunLiveScore = async (e: React.FormEvent) => {
    e.preventDefault();
    setScoring(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/score-single', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formState),
      });
      const data: LiveScoreResponse = await res.json();
      if (!res.ok) {
        throw new Error('Failed to score live invoice');
      }
      setScoreResult(data);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Scoring request failed');
    } finally {
      setScoring(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="upload-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-3 sm:p-6 overflow-y-auto"
    >
      <div className="w-full max-w-4xl bg-[#08090E]/95 backdrop-blur-2xl border border-white/[0.12] rounded-2xl shadow-[0_25px_80px_rgba(0,0,0,0.85)] overflow-hidden my-6">
        {/* Studio Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.08] bg-[#050507]/90">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shadow-[0_0_20px_rgba(99,102,241,0.2)]">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h2
                id="upload-modal-title"
                className="text-sm sm:text-base font-semibold text-white font-mono tracking-tight"
              >
                LIVE INVOICE SANDBOX // MULTIMODAL PDF &amp; JSON SCORING
              </h2>
              <p className="text-[11px] text-zinc-400 font-mono mt-0.5">
                REAL-TIME 4-LAYER EVALUATION AGAINST 10,000-ROW AP CORPUS • BOUNDING-BOX PROVENANCE
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close live sandbox modal"
            className="p-2 text-zinc-400 hover:text-white hover:bg-white/[0.06] rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5 max-h-[82vh] overflow-y-auto">
          {/* 1-Click Load Preset Test Cases */}
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
              <span className="text-[11px] font-mono uppercase tracking-[0.12em] text-zinc-400">
                LOAD PRESET TEST CASES (1-CLICK CONFERENCE DEMO) OR UPLOAD PDF / JSON
              </span>
              <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono text-indigo-300 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 rounded-lg cursor-pointer transition-all">
                <Upload className="w-3.5 h-3.5" />
                <span>{uploading ? 'Extracting via Gemini...' : 'Upload PDF / Image / JSON'}</span>
                <input
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.json"
                  onChange={handleFileUpload}
                  className="sr-only"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {Object.entries(PRESET_SCENARIOS).map(([key, sc]) => {
                const active = selectedPreset === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleSelectPreset(key)}
                    className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                      active
                        ? 'border-indigo-500/60 bg-indigo-500/[0.12] shadow-[0_0_20px_rgba(99,102,241,0.15)]'
                        : 'border-white/[0.08] bg-[#0B0C10]/85 hover:bg-white/[0.03] hover:border-white/[0.15]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-white">{sc.title}</span>
                      <span
                        className={`px-1.5 py-0.5 text-[9px] font-mono rounded border ${sc.badgeStyle}`}
                      >
                        {sc.badge}
                      </span>
                    </div>
                    <div className="text-[11px] text-zinc-400 font-mono mt-1">{sc.subtitle}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {errorMsg && (
            <div className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-xs font-mono text-rose-300">
              {errorMsg}
            </div>
          )}

          {/* Editable Invoice Payload Form */}
          <form onSubmit={handleRunLiveScore} className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <label className="block text-[10px] font-mono uppercase tracking-[0.12em] text-zinc-400 mb-1">
                  Vendor ID
                </label>
                <input
                  type="text"
                  value={String(formState.vendor_id || '')}
                  onChange={(e) => handleFieldChange('vendor_id', e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-[#050507] border border-white/[0.1] rounded-lg text-zinc-100 font-mono focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-[10px] font-mono uppercase tracking-[0.12em] text-zinc-400 mb-1">
                  Invoice Number
                </label>
                <input
                  type="text"
                  value={String(formState.invoice_no || '')}
                  onChange={(e) => handleFieldChange('invoice_no', e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-[#050507] border border-white/[0.1] rounded-lg text-zinc-100 font-mono focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-[10px] font-mono uppercase tracking-[0.12em] text-zinc-400 mb-1">
                  Supplier GSTIN (15-Char)
                </label>
                <input
                  type="text"
                  value={String(formState.gstin || '')}
                  onChange={(e) => handleFieldChange('gstin', e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-[#050507] border border-white/[0.1] rounded-lg text-zinc-100 font-mono focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-[10px] font-mono uppercase tracking-[0.12em] text-zinc-400 mb-1">
                  Invoice Date
                </label>
                <input
                  type="text"
                  value={String(formState.invoice_date || '')}
                  onChange={(e) => handleFieldChange('invoice_date', e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-[#050507] border border-white/[0.1] rounded-lg text-zinc-100 font-mono focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-[10px] font-mono uppercase tracking-[0.12em] text-zinc-400 mb-1">
                  Bank IFSC
                </label>
                <input
                  type="text"
                  value={String(formState.bank_ifsc || '')}
                  onChange={(e) => handleFieldChange('bank_ifsc', e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-[#050507] border border-white/[0.1] rounded-lg text-zinc-100 font-mono focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-[10px] font-mono uppercase tracking-[0.12em] text-zinc-400 mb-1">
                  Bank Account
                </label>
                <input
                  type="text"
                  value={String(formState.bank_account || '')}
                  onChange={(e) => handleFieldChange('bank_account', e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-[#050507] border border-white/[0.1] rounded-lg text-zinc-100 font-mono focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-[10px] font-mono uppercase tracking-[0.12em] text-zinc-400 mb-1">
                  Subtotal (₹)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={Number(formState.subtotal || 0)}
                  onChange={(e) => handleFieldChange('subtotal', e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-[#050507] border border-white/[0.1] rounded-lg text-zinc-100 font-mono tabular-nums focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-[10px] font-mono uppercase tracking-[0.12em] text-zinc-400 mb-1">
                  18% GST Tax (₹)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={Number(formState.tax_amount || 0)}
                  onChange={(e) => handleFieldChange('tax_amount', e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-[#050507] border border-white/[0.1] rounded-lg text-zinc-100 font-mono tabular-nums focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-[10px] font-mono uppercase tracking-[0.12em] text-zinc-400 mb-1">
                  Gross Total (₹)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={Number(formState.gross_total || 0)}
                  onChange={(e) => handleFieldChange('gross_total', e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-[#050507] border border-white/[0.1] rounded-lg text-zinc-100 font-mono tabular-nums focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-[10px] font-mono uppercase tracking-[0.12em] text-zinc-400 mb-1">
                  Unit Price (₹)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={Number(formState.unit_price || 0)}
                  onChange={(e) => handleFieldChange('unit_price', e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-[#050507] border border-white/[0.1] rounded-lg text-zinc-100 font-mono tabular-nums focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-[10px] font-mono uppercase tracking-[0.12em] text-zinc-400 mb-1">
                  Service Period
                </label>
                <input
                  type="text"
                  value={String(formState.service_period || '')}
                  onChange={(e) => handleFieldChange('service_period', e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-[#050507] border border-white/[0.1] rounded-lg text-zinc-100 font-mono focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-[10px] font-mono uppercase tracking-[0.12em] text-zinc-400 mb-1">
                  OCR Confidence (0-1)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.50"
                  max="1.00"
                  value={Number(formState.ocr_confidence || 0.92)}
                  onChange={(e) => handleFieldChange('ocr_confidence', e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-[#050507] border border-white/[0.1] rounded-lg text-zinc-100 font-mono tabular-nums focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={scoring}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-black bg-white hover:bg-zinc-200 rounded-lg shadow-[0_0_20px_rgba(255,255,255,0.2)] transition-all cursor-pointer"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>
                  {scoring
                    ? 'Executing 4-Layer Scoring...'
                    : 'Execute Real-Time 4-Layer Scoring'}
                </span>
              </button>
            </div>
          </form>

          {/* Real-Time Scoring Output & Provenance Viewer */}
          {scoreResult && (
            <div className="rounded-xl border border-white/[0.1] bg-[#050507]/95 p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.08] pb-3.5">
                <div className="flex items-center gap-3">
                  {Number(scoreResult.invoice.hybrid_flag) === 1 ? (
                    <div className="h-9 w-9 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400">
                      <AlertTriangle className="w-4 h-4" />
                    </div>
                  ) : (
                    <div className="h-9 w-9 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                      <CheckCircle2 className="w-4 h-4" />
                    </div>
                  )}
                  <div>
                    <div className="text-sm font-semibold text-white font-mono">
                      {Number(scoreResult.invoice.hybrid_flag) === 1
                        ? `PRE-DISBURSEMENT HOLD // ${scoreResult.invoice.recommended_action}`
                        : 'CLEAN VOUCHER // AUTO-APPROVE ELIGIBLE (HARD-NEGATIVE GUARDRAIL PASSED)'}
                    </div>
                    <div className="text-xs text-zinc-400 font-mono tabular-nums mt-0.5">
                      REASON CODES: {scoreResult.invoice.reason_codes} • GROSS: {formatINR(Number(scoreResult.invoice.gross_total))}
                    </div>
                  </div>
                </div>
                <div className="text-right font-mono tabular-nums">
                  <div className="text-[10px] uppercase tracking-[0.12em] text-zinc-400">
                    CALIBRATED PROBABILITY
                  </div>
                  <div
                    className={`text-2xl font-bold ${
                      Number(scoreResult.invoice.hybrid_risk_score) >= 0.8
                        ? 'text-rose-400'
                        : 'text-emerald-400'
                    }`}
                  >
                    {Number(scoreResult.invoice.hybrid_risk_score).toFixed(4)}
                  </div>
                </div>
              </div>

              {/* Bounding-Box Provenance Coordinates */}
              <div>
                <div className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-[0.12em] text-zinc-400 mb-2">
                  <FileText className="w-3.5 h-3.5 text-indigo-400" />
                  <span>EXTRACTED DOCUMENT PROVENANCE BOUNDING BOXES</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                  {scoreResult.provenance_boxes.map((box) => (
                    <div
                      key={box.field}
                      className="p-2.5 rounded-lg border border-white/[0.08] bg-[#0B0C10] font-mono tabular-nums text-xs"
                    >
                      <div className="text-[10px] text-zinc-400 uppercase">{box.field}</div>
                      <div className="text-zinc-100 font-semibold truncate mt-0.5">{box.value}</div>
                      <div className="text-[10px] text-indigo-300 mt-1">
                        Page {box.page} • BBox [{box.bbox.join(', ')}] • Conf {box.confidence}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {Number(scoreResult.invoice.hybrid_flag) === 1 && (
                <div className="flex justify-end pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      const enriched: LedgerRecord = {
                        ...scoreResult.invoice,
                        matched_record: scoreResult.matched_record,
                      };
                      onClose();
                      onInspectScoredRecord(enriched);
                    }}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-black bg-white hover:bg-zinc-200 rounded-lg shadow-[0_0_20px_rgba(255,255,255,0.2)] transition-all cursor-pointer"
                  >
                    <span>Open Split-Pane Forensic Diff &amp; Commit Disposition</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
