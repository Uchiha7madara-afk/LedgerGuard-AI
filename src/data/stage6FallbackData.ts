import bundleJson from './stage6_bundle.json';
import type {
  AuditDisposition,
  LedgerRecord,
  LiveScoreResponse,
  ReasonFilterKey,
  Stage6MetricsSummary,
} from '../types/ledger';

export const FALLBACK_STAGE6_METRICS: Stage6MetricsSummary =
  bundleJson.metrics as unknown as Stage6MetricsSummary;

export const FALLBACK_AUDIT_QUEUE: LedgerRecord[] =
  bundleJson.queue as unknown as LedgerRecord[];

export const FALLBACK_AUDIT_TRAIL: AuditDisposition[] =
  bundleJson.audit_trail as unknown as AuditDisposition[];

const LOCAL_STORAGE_AUDIT_KEY = 'ledgerguard_audit_trail_v1';

export function getClientAuditTrail(): AuditDisposition[] {
  if (typeof window === 'undefined') return FALLBACK_AUDIT_TRAIL;
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_AUDIT_KEY);
    if (!raw) return FALLBACK_AUDIT_TRAIL;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
  } catch {
    // ignore storage errors
  }
  return FALLBACK_AUDIT_TRAIL;
}

export function saveClientAuditDisposition(
  record: LedgerRecord,
  auditorName: string,
  decision: 'HOLD_PAYMENT' | 'CONFIRM_DUPLICATE' | 'OVERRIDE_RELEASE',
  auditNote: string
): AuditDisposition {
  const current = getClientAuditTrail();
  const nextNum = current.length + 1;
  const entry: AuditDisposition = {
    disposition_id: `AUD-2026-${String(nextNum).padStart(4, '0')}`,
    record_id: record.record_id,
    vendor_name: record.vendor_name || 'Live Submitted Vendor',
    invoice_no: record.invoice_no || 'INV-LIVE',
    gross_total: Number(record.gross_total || 0),
    reason_codes: record.reason_codes || 'MANUAL_REVIEW',
    auditor_name: auditorName.trim(),
    decision,
    audit_note: auditNote.trim(),
    timestamp_utc: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };
  const updated = [
    entry,
    ...current.filter((d) => d.record_id !== entry.record_id),
  ];
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(LOCAL_STORAGE_AUDIT_KEY, JSON.stringify(updated));
    } catch {
      // ignore storage errors
    }
  }
  return entry;
}

const REASON_TOTAL_COUNTS: Record<string, number> = {
  ALL: 1000,
  NEAR_DUP: 550,
  SPLIT: 150,
  SHARED_BANK: 100,
  ABSTENTION: 100,
  PRICE_DRIFT: 100,
};

export function filterFallbackQueue(params: {
  reasonFilter: ReasonFilterKey;
  actionFilter: string;
  search: string;
  dispositions: AuditDisposition[];
}): { items: LedgerRecord[]; total_matching: number } {
  const { reasonFilter, actionFilter, search, dispositions } = params;
  const dispByRecord = new Map<string, AuditDisposition>();
  for (const d of dispositions) {
    if (!dispByRecord.has(d.record_id)) {
      dispByRecord.set(d.record_id, d);
    }
  }

  const q = search.trim().toLowerCase();
  const act = actionFilter.trim().toUpperCase();

  const filtered = FALLBACK_AUDIT_QUEUE.filter((row) => {
    const reasons = String(row.reason_codes || '');
    const action = String(row.recommended_action || '');

    if (reasonFilter !== 'ALL') {
      if (reasonFilter === 'NEAR_DUP') {
        if (
          !reasons.includes('EXACT_DUPLICATE_INVOICE') &&
          !reasons.includes('NEAR_DUP_INV_NO_OR_ALIAS')
        ) {
          return false;
        }
      } else if (reasonFilter === 'SPLIT') {
        if (!reasons.includes('SPLIT_THRESHOLD_BYPASS')) return false;
      } else if (reasonFilter === 'SHARED_BANK') {
        if (!reasons.includes('SHARED_BANK_IFSC_DIFF_VENDOR')) return false;
      } else if (reasonFilter === 'ABSTENTION') {
        if (
          !reasons.includes('EXTRACTION_MATH_MISMATCH') &&
          !reasons.includes('NEEDS_MANUAL_OCR_REVIEW') &&
          !reasons.includes('INVALID_GSTIN_CHECKSUM')
        ) {
          return false;
        }
      } else if (reasonFilter === 'PRICE_DRIFT') {
        if (!reasons.includes('UNIT_PRICE_COHORT_DRIFT')) return false;
      }
    }

    if (act !== 'ALL' && action.toUpperCase() !== act) {
      return false;
    }

    if (q) {
      const hay = [
        row.record_id,
        row.vendor_id,
        row.vendor_name,
        row.gstin,
        row.invoice_no,
        row.po_number,
        reasons,
      ]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }

    return true;
  }).map((row) => ({
    ...row,
    disposition: dispByRecord.get(row.record_id) || row.disposition || null,
  }));

  const hasCustomSearchOrAction = Boolean(q) || act !== 'ALL';
  const total_matching = hasCustomSearchOrAction
    ? filtered.length
    : REASON_TOTAL_COUNTS[reasonFilter] ?? filtered.length;

  return { items: filtered, total_matching };
}

// ============================================================================
// Client-Side 4-Layer Hybrid Engine Fallback (mirrors backend/engine.py)
// ============================================================================

const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function verifyGstinChecksum(gstin: string): boolean {
  const clean = String(gstin || '').trim().toUpperCase();
  if (clean.length !== 15) return false;
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(clean)) {
    return false;
  }
  let total = 0;
  for (let i = 0; i < 14; i++) {
    const val = GSTIN_CHARS.indexOf(clean[i]);
    if (val < 0) return false;
    const factor = i % 2 === 0 ? 1 : 2;
    const prod = val * factor;
    total += Math.floor(prod / 36) + (prod % 36);
  }
  const rem = total % 36;
  const checkIdx = (36 - rem) % 36;
  return clean[14] === GSTIN_CHARS[checkIdx];
}

export function canonicalizeInvoiceNo(invNo: string): string {
  let s = String(invNo || '').trim().toUpperCase();
  s = s.replace(/\/[A-Z0-9]{1,2}$/, '');
  s = s.replace(/[-_/\s]+/g, '');
  s = s.replace(/INV26/g, 'INV2026').replace(/INV25/g, 'INV2025');
  if (s.startsWith('INV')) {
    const prefix = 'INV';
    const rest = s
      .slice(3)
      .replace(/O/g, '0')
      .replace(/I/g, '1')
      .replace(/L/g, '1')
      .replace(/S/g, '5')
      .replace(/B/g, '8');
    const stripped = rest.replace(/^0+/, '');
    s = prefix + (stripped || '0');
  }
  return s;
}

export function jaroWinklerSimilarity(s1: string, s2: string): number {
  if (s1 === s2) return 1.0;
  const len1 = s1.length;
  const len2 = s2.length;
  if (len1 === 0 || len2 === 0) return 0.0;

  const matchDist = Math.max(0, Math.floor(Math.max(len1, len2) / 2) - 1);
  const s1Matches = new Array(len1).fill(false);
  const s2Matches = new Array(len2).fill(false);

  let matches = 0;
  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchDist);
    const end = Math.min(i + matchDist + 1, len2);
    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0.0;

  let t = 0;
  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) t++;
    k++;
  }
  const transpositions = t / 2;
  const jaro =
    (matches / len1 + matches / len2 + (matches - transpositions) / matches) / 3;

  let prefix = 0;
  for (let i = 0; i < Math.min(4, len1, len2); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

export function scoreSingleInvoiceClientFallback(
  payload: Record<string, string | number>
): LiveScoreResponse {
  const recordId = String(payload.record_id || 'LIVE-VOUCHER-01');
  const vendorId = String(payload.vendor_id || 'VND-001');
  const vendorName = String(
    payload.vendor_name || 'Bharat Industrial Supplies Pvt Ltd'
  );
  const gstin = String(payload.gstin || '27FMJCB1000K1Z3');
  const bankIfsc = String(payload.bank_ifsc || 'HDFC0001000');
  const bankAccount = String(payload.bank_account || '918000000000');
  const invoiceNo = String(payload.invoice_no || 'INV-2026-01001');
  const poNumber = String(payload.po_number || 'PO-2026-001-100');
  const invoiceDate = String(payload.invoice_date || '2026-03-15');
  const servicePeriod = String(payload.service_period || '2026-03');
  const hsnCode = String(payload.hsn_code || '8471');
  const quantity = Number(payload.quantity || 1);
  const unitPrice = Number(payload.unit_price || 0);
  const subtotal = Number(payload.subtotal || 0);
  const taxAmount = Number(payload.tax_amount || 0);
  const grossTotal = Number(payload.gross_total || 0);
  const ocrConfidence = Number(payload.ocr_confidence || 0.95);

  const reasons: string[] = [];
  let riskScore = 0.03;
  let erpScore = 0.02;
  let erpFlag = 0;
  let matchedRecord: LedgerRecord | null = null;

  // Build baseline pool from queue items + their matched historical records
  const historicalPool: LedgerRecord[] = [];
  const seenIds = new Set<string>();
  for (const item of FALLBACK_AUDIT_QUEUE) {
    if (item.matched_record && !seenIds.has(item.matched_record.record_id)) {
      seenIds.add(item.matched_record.record_id);
      historicalPool.push(item.matched_record);
    }
    if (!seenIds.has(item.record_id)) {
      seenIds.add(item.record_id);
      historicalPool.push(item);
    }
  }
  // Ensure AP-2026-00001 is always in pool for Preset 1
  if (!seenIds.has('AP-2026-00001')) {
    historicalPool.unshift({
      record_id: 'AP-2026-00001',
      vendor_id: 'VND-001',
      vendor_name: 'Bharat Industrial Supplies Pvt Ltd',
      gstin: '27FMJCB1000K1Z3',
      bank_ifsc: 'HDFC0001000',
      bank_account: '918000000000',
      invoice_no: 'INV-2025-010001',
      po_number: 'PO-2025-001-100',
      invoice_date: '2025-04-02',
      service_period: '2025-04',
      hsn_code: '8471',
      quantity: 4,
      unit_price: 11675.0,
      subtotal: 46700.0,
      tax_amount: 8406.0,
      gross_total: 55106.0,
      ocr_confidence: 0.98,
      is_anomaly: 0,
      anomaly_typology: 'CLEAN_NORMAL',
      hybrid_risk_score: 0.02,
      reason_codes: 'CLEAN_PASS',
      recommended_action: 'AUTO_APPROVE_CLEAN',
      matched_record_id: '',
    });
  }

  // Layer 1: Deterministic Accounting & Abstention Gate
  const mathDelta = Math.abs(subtotal + taxAmount - grossTotal);
  const gstinValid = verifyGstinChecksum(gstin);
  if (mathDelta > 1.0) {
    reasons.push('EXTRACTION_MATH_MISMATCH');
    riskScore = Math.max(riskScore, 0.89);
  }
  if (ocrConfidence < 0.8) {
    reasons.push('NEEDS_MANUAL_OCR_REVIEW');
    riskScore = Math.max(riskScore, 0.88);
  }
  if (!gstinValid) {
    reasons.push('INVALID_GSTIN_CHECKSUM');
    riskScore = Math.max(riskScore, 0.86);
  }

  // Layer 2: Candidate Blocking & Fuzzy OCR Homoglyph Resolution
  const canonTarget = canonicalizeInvoiceNo(invoiceNo);
  for (const cand of historicalPool) {
    if (cand.record_id === recordId) continue;
    const sameVendor = cand.vendor_id === vendorId;
    const sameAmount = Math.abs(Number(cand.gross_total) - grossTotal) <= 1.5;

    if (sameVendor && sameAmount) {
      // Recurring Monthly Retainer Hard-Negative Check
      const d1 = new Date(invoiceDate).getTime();
      const d2 = new Date(cand.invoice_date).getTime();
      const dayDiff = Math.abs(d1 - d2) / (1000 * 3600 * 24);
      const isRecurringRetainer =
        ((dayDiff >= 25 && dayDiff <= 35) || invoiceNo.startsWith('RET-')) &&
        servicePeriod !== cand.service_period &&
        invoiceNo !== cand.invoice_no;

      if (isRecurringRetainer) {
        continue;
      }

      if (cand.invoice_no === invoiceNo) {
        reasons.push('EXACT_DUPLICATE_INVOICE');
        riskScore = Math.max(riskScore, 0.99);
        erpScore = 1.0;
        erpFlag = 1;
        matchedRecord = cand;
        break;
      }

      const rawJw = jaroWinklerSimilarity(
        invoiceNo.toUpperCase(),
        cand.invoice_no.toUpperCase()
      );
      const canonCand = canonicalizeInvoiceNo(cand.invoice_no);
      const canonJw = jaroWinklerSimilarity(canonTarget, canonCand);

      if (canonJw >= 0.92 || rawJw >= 0.88) {
        reasons.push('NEAR_DUP_INV_NO_OR_ALIAS');
        riskScore = Math.max(riskScore, Number(Math.min(0.97, Math.max(0.91, canonJw * 0.97)).toFixed(2)));
        matchedRecord = cand;
        break;
      }
    }
  }

  // Layer 3: Bipartite Supplier-to-Bank Graph Link
  const bankKey = `${bankIfsc.trim().toUpperCase()}:${bankAccount.trim()}`;
  for (const cand of historicalPool) {
    const candBankKey = `${String(cand.bank_ifsc).trim().toUpperCase()}:${String(
      cand.bank_account
    ).trim()}`;
    if (candBankKey === bankKey && cand.vendor_id !== vendorId) {
      if (!reasons.includes('SHARED_BANK_IFSC_DIFF_VENDOR')) {
        reasons.push('SHARED_BANK_IFSC_DIFF_VENDOR');
      }
      riskScore = Math.max(riskScore, 0.93);
      if (!matchedRecord) matchedRecord = cand;
      break;
    }
  }

  // Layer 4: Unit Price Drift Check
  const vendorPeers = historicalPool.filter((c) => c.vendor_id === vendorId);
  let medianUnitPrice = unitPrice || 11675;
  if (vendorPeers.length > 0) {
    const prices = vendorPeers
      .map((p) => Number(p.unit_price || 0))
      .filter((p) => p > 0)
      .sort((a, b) => a - b);
    if (prices.length > 0) {
      medianUnitPrice = prices[Math.floor(prices.length / 2)];
    }
  }
  const unitPriceRatio =
    medianUnitPrice > 0 ? Number((unitPrice / medianUnitPrice).toFixed(2)) : 1.0;
  if (unitPriceRatio > 1.24 && ! invoiceNo.startsWith('RET-')) {
    reasons.push('UNIT_PRICE_COHORT_DRIFT');
    riskScore = Math.max(riskScore, 0.87);
  }

  let recommendedAction = 'AUTO_APPROVE_CLEAN';
  if (
    reasons.includes('EXTRACTION_MATH_MISMATCH') ||
    reasons.includes('NEEDS_MANUAL_OCR_REVIEW') ||
    reasons.includes('INVALID_GSTIN_CHECKSUM')
  ) {
    recommendedAction = 'ABSTAIN_MANUAL_OCR_VERIFY';
  } else if (
    reasons.includes('EXACT_DUPLICATE_INVOICE') ||
    reasons.includes('NEAR_DUP_INV_NO_OR_ALIAS')
  ) {
    recommendedAction = 'HOLD_DUPLICATE_RESUBMISSION';
  } else if (reasons.includes('SHARED_BANK_IFSC_DIFF_VENDOR')) {
    recommendedAction = 'ESCALATE_VENDOR_BANK_RING';
  } else if (reasons.includes('SPLIT_THRESHOLD_BYPASS')) {
    recommendedAction = 'ESCALATE_SPLIT_PO_BYPASS';
  } else if (reasons.includes('UNIT_PRICE_COHORT_DRIFT')) {
    recommendedAction = 'REVIEW_UNIT_PRICE_VARIANCE';
  }

  if (reasons.length === 0) {
    reasons.push('CLEAN_PASS');
    riskScore = 0.04;
  }

  const scoredRecord: LedgerRecord = {
    record_id: recordId,
    vendor_id: vendorId,
    vendor_name: vendorName,
    gstin,
    bank_ifsc: bankIfsc,
    bank_account: bankAccount,
    invoice_no: invoiceNo,
    po_number: poNumber,
    invoice_date: invoiceDate,
    service_period: servicePeriod,
    hsn_code: hsnCode,
    quantity,
    unit_price: unitPrice,
    subtotal,
    tax_amount: taxAmount,
    gross_total: grossTotal,
    ocr_confidence: ocrConfidence,
    is_anomaly: riskScore >= 0.8 ? 1 : 0,
    anomaly_typology: reasons[0],
    erp_baseline_flag: erpFlag,
    erp_baseline_score: erpScore,
    hybrid_flag: riskScore >= 0.8 ? 1 : 0,
    hybrid_risk_score: riskScore,
    reason_codes: reasons.join('|'),
    recommended_action: recommendedAction,
    matched_record_id: matchedRecord ? matchedRecord.record_id : '',
    vendor_median_unit_price: medianUnitPrice,
    unit_price_ratio: unitPriceRatio,
    matched_record: matchedRecord,
  };

  return {
    invoice: scoredRecord,
    matched_record: matchedRecord,
    provenance_boxes: [
      {
        field: 'invoice_no',
        value: invoiceNo,
        page: 1,
        bbox: [412, 188, 164, 28],
        confidence: Math.min(0.99, Number((ocrConfidence + 0.01).toFixed(2))),
      },
      {
        field: 'gstin',
        value: gstin,
        page: 1,
        bbox: [64, 124, 220, 24],
        confidence: Number(ocrConfidence.toFixed(2)),
      },
      {
        field: 'bank_account',
        value: `${bankIfsc} / ${bankAccount}`,
        page: 1,
        bbox: [64, 512, 260, 32],
        confidence: Math.min(0.99, Number((ocrConfidence + 0.02).toFixed(2))),
      },
      {
        field: 'gross_total',
        value: String(grossTotal),
        page: 1,
        bbox: [430, 610, 178, 36],
        confidence: Number(ocrConfidence.toFixed(2)),
      },
    ],
    extraction_engine: '4-layer-hybrid-engine',
  };
}
