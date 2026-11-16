import express from 'express';
import { createServer as createViteServer } from 'vite';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const ROOT_DIR = process.cwd();
const BACKEND_DIR = path.join(ROOT_DIR, 'backend');
const LEDGER_CSV = path.join(BACKEND_DIR, 'synthetic_ap_ledger.csv');
const QUEUE_CSV = path.join(BACKEND_DIR, 'stage6_scored_audit_queue.csv');
const METRICS_JSON = path.join(BACKEND_DIR, 'stage6_metrics_summary.json');
const AUDIT_JSON = path.join(BACKEND_DIR, 'audit_trail.json');

const VALID_DECISIONS = new Set([
  'HOLD_PAYMENT',
  'CONFIRM_DUPLICATE',
  'OVERRIDE_RELEASE',
]);

function parseCsvFile(filePath: string): Record<string, string>[] {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];

  const parseLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        out.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out;
  };

  const headers = parseLine(lines[0]);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseLine(lines[i]);
    const obj: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = cols[j] ?? '';
    }
    rows.push(obj);
  }
  return rows;
}

function ensureBackendArtifacts(): void {
  if (!fs.existsSync(METRICS_JSON) || !fs.existsSync(QUEUE_CSV) || !fs.existsSync(LEDGER_CSV)) {
    console.log('[LedgerGuard] Running Stage 6 evaluation to initialize ledger & queue artifacts...');
    execFileSync('python3', [path.join(BACKEND_DIR, 'evaluate_stage6.py')], {
      cwd: ROOT_DIR,
      stdio: 'inherit',
    });
  }

  if (!fs.existsSync(AUDIT_JSON)) {
    const seedAudit = [
      {
        disposition_id: 'AUD-2026-0001',
        record_id: 'AP-2026-09001',
        vendor_name: 'Bharat Industrial Supplies Pvt Ltd',
        invoice_no: 'INV-2025-010001',
        gross_total: 55106.0,
        reason_codes: 'EXACT_DUPLICATE_INVOICE',
        auditor_name: 'Meera Krishnan (Sr. AP Controller)',
        decision: 'CONFIRM_DUPLICATE',
        audit_note:
          'Confirmed exact duplicate resubmission against AP-2026-00001; payment voucher blocked prior to disbursement.',
        timestamp_utc: '2026-03-14T09:15:22Z',
      },
      {
        disposition_id: 'AUD-2026-0002',
        record_id: 'AP-2026-09151',
        vendor_name: 'Apex Industrial Supplies Pvt Ltd',
        invoice_no: 'INV-2O25-010151',
        gross_total: 67891.57,
        reason_codes: 'NEAR_DUP_INV_NO_OR_ALIAS',
        auditor_name: 'Rohan Deshmukh (Forensic Audit Lead)',
        decision: 'HOLD_PAYMENT',
        audit_note:
          'OCR character mutation 2O25 vs 2025 detected on resubmitted scan. Escalated to vendor desk.',
        timestamp_utc: '2026-03-14T11:42:10Z',
      },
    ];
    fs.writeFileSync(AUDIT_JSON, JSON.stringify(seedAudit, null, 2), 'utf-8');
  }
}

interface AuditEntry {
  disposition_id: string;
  record_id: string;
  vendor_name: string;
  invoice_no: string;
  gross_total: number;
  reason_codes: string;
  auditor_name: string;
  decision: string;
  audit_note: string;
  timestamp_utc: string;
}

function readAuditTrail(): AuditEntry[] {
  if (!fs.existsSync(AUDIT_JSON)) return [];
  try {
    return JSON.parse(fs.readFileSync(AUDIT_JSON, 'utf-8'));
  } catch {
    return [];
  }
}

async function startServer() {
  ensureBackendArtifacts();

  let ledgerRows: Record<string, string>[] = [];
  let queueRows: Record<string, string>[] = [];
  let ledgerById = new Map<string, Record<string, string>>();

  const rebuildIndex = () => {
    ledgerRows = parseCsvFile(LEDGER_CSV);
    queueRows = parseCsvFile(QUEUE_CSV);
    ledgerById = new Map<string, Record<string, string>>();
    for (const r of ledgerRows) {
      ledgerById.set(r.record_id, r);
    }
    for (const q of queueRows) {
      ledgerById.set(q.record_id, q);
    }
  };
  rebuildIndex();

  const app = express();
  app.use(express.json({ limit: '15mb' }));

  // 1. GET /api/metrics
  app.get('/api/metrics', (_req, res) => {
    try {
      ensureBackendArtifacts();
      const data = JSON.parse(fs.readFileSync(METRICS_JSON, 'utf-8'));
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // 2. POST /api/rerun-stage6
  app.post('/api/rerun-stage6', (_req, res) => {
    try {
      execFileSync('python3', [path.join(BACKEND_DIR, 'evaluate_stage6.py')], {
        cwd: ROOT_DIR,
        stdio: 'inherit',
      });
      rebuildIndex();
      const data = JSON.parse(fs.readFileSync(METRICS_JSON, 'utf-8'));
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // 3. GET /api/queue
  app.get('/api/queue', (req, res) => {
    const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 100));
    const reasonFilter = String(req.query.reason_filter || 'ALL').trim().toUpperCase();
    const actionFilter = String(req.query.action_filter || 'ALL').trim().toUpperCase();
    const search = String(req.query.search || '').trim().toLowerCase();

    const auditTrail = readAuditTrail();
    const dispByRecord = new Map<string, AuditEntry>();
    for (const d of auditTrail) {
      if (!dispByRecord.has(d.record_id)) {
        dispByRecord.set(d.record_id, d);
      }
    }

    const coerceRecord = (raw: Record<string, string>) => ({
      ...raw,
      quantity: Number(raw.quantity || 1),
      unit_price: Number(raw.unit_price || 0),
      subtotal: Number(raw.subtotal || 0),
      tax_amount: Number(raw.tax_amount || 0),
      gross_total: Number(raw.gross_total || 0),
      ocr_confidence: Number(raw.ocr_confidence || 0.9),
      is_anomaly: Number(raw.is_anomaly || 0),
      erp_baseline_flag: Number(raw.erp_baseline_flag || 0),
      erp_baseline_score: Number(raw.erp_baseline_score || 0.02),
      hybrid_flag: Number(raw.hybrid_flag || 1),
      hybrid_risk_score: Number(raw.hybrid_risk_score || 0),
      vendor_median_unit_price: Number(raw.vendor_median_unit_price || raw.unit_price || 0),
      unit_price_ratio: Number(raw.unit_price_ratio || 1),
      split_cluster_total: Number(raw.split_cluster_total || 0),
      split_cluster_count: Number(raw.split_cluster_count || 0),
    });

    const filtered: Record<string, unknown>[] = [];
    for (const row of queueRows) {
      const score = Number(row.hybrid_risk_score || 0);
      if (score < 0.8) continue;

      const reasons = String(row.reason_codes || '');
      const action = String(row.recommended_action || '');

      if (reasonFilter !== 'ALL') {
        if (reasonFilter === 'NEAR_DUP') {
          if (
            !reasons.includes('EXACT_DUPLICATE_INVOICE') &&
            !reasons.includes('NEAR_DUP_INV_NO_OR_ALIAS')
          ) {
            continue;
          }
        } else if (reasonFilter === 'SPLIT') {
          if (!reasons.includes('SPLIT_THRESHOLD_BYPASS')) continue;
        } else if (reasonFilter === 'SHARED_BANK') {
          if (!reasons.includes('SHARED_BANK_IFSC_DIFF_VENDOR')) continue;
        } else if (reasonFilter === 'ABSTENTION') {
          if (
            !reasons.includes('EXTRACTION_MATH_MISMATCH') &&
            !reasons.includes('NEEDS_MANUAL_OCR_REVIEW') &&
            !reasons.includes('INVALID_GSTIN_CHECKSUM')
          ) {
            continue;
          }
        } else if (reasonFilter === 'PRICE_DRIFT') {
          if (!reasons.includes('UNIT_PRICE_COHORT_DRIFT')) continue;
        } else if (!reasons.includes(reasonFilter)) {
          continue;
        }
      }

      if (actionFilter !== 'ALL' && action.toUpperCase() !== actionFilter) {
        continue;
      }

      if (search) {
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
        if (!hay.includes(search)) continue;
      }

      const item = coerceRecord(row);
      const matchedId = String(row.matched_record_id || '').trim();
      const matchedRaw = matchedId ? ledgerById.get(matchedId) : undefined;

      const splitIds = String(row.split_cluster_ids || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const splitClusterRecords = splitIds
        .map((sid) => ledgerById.get(sid))
        .filter((r): r is Record<string, string> => Boolean(r))
        .map((r) => ({
          record_id: r.record_id,
          invoice_no: r.invoice_no,
          invoice_date: r.invoice_date,
          po_number: r.po_number,
          gross_total: Number(r.gross_total || 0),
        }));

      filtered.push({
        ...item,
        matched_record: matchedRaw ? coerceRecord(matchedRaw) : null,
        split_cluster_records: splitClusterRecords,
        disposition: dispByRecord.get(row.record_id) || null,
      });
    }

    // When reasonFilter === 'ALL', interleave across the 7 anomaly typologies and distinct vendors
    // so the top returned rows in the queue represent all anomaly types and diverse suppliers.
    let finalItems = filtered;
    if (reasonFilter === 'ALL' && filtered.length > 1) {
      const bucketOrder = [
        'OCR_TYPO_NEAR_DUP',
        'SPLIT_THRESHOLD_BYPASS',
        'SHARED_BANK_CROSS_VENDOR',
        'TAX_MATH_MISMATCH',
        'UNIT_PRICE_DRIFT',
        'DATE_SHIFT_VENDOR_ALIAS',
        'EXACT_RESUBMISSION',
      ];
      const buckets = new Map<string, typeof filtered>();
      for (const k of bucketOrder) buckets.set(k, []);
      const extra: typeof filtered = [];

      for (const item of filtered) {
        const typ = String((item as Record<string, unknown>).anomaly_typology || '');
        if (buckets.has(typ)) {
          buckets.get(typ)!.push(item);
        } else {
          extra.push(item);
        }
      }

      const diversifyVendors = (arr: typeof filtered) => {
        const byV = new Map<string, typeof filtered>();
        for (const it of arr) {
          const vid = String((it as Record<string, unknown>).vendor_id || '');
          if (!byV.has(vid)) byV.set(vid, []);
          byV.get(vid)!.push(it);
        }
        const queues = Array.from(byV.values());
        const resArr: typeof filtered = [];
        let more = true;
        while (more) {
          more = false;
          for (const q of queues) {
            if (q.length > 0) {
              resArr.push(q.shift()!);
              more = true;
            }
          }
        }
        return resArr;
      };

      const queues = bucketOrder.map((k) => diversifyVendors(buckets.get(k) || []));
      if (extra.length > 0) queues.push(diversifyVendors(extra));

      const interleaved: typeof filtered = [];
      let hasMore = true;
      while (hasMore) {
        hasMore = false;
        for (const q of queues) {
          if (q.length > 0) {
            interleaved.push(q.shift()!);
            hasMore = true;
          }
        }
      }
      finalItems = interleaved;
    }

    res.json({
      total_matching: finalItems.length,
      returned_count: Math.min(limit, finalItems.length),
      items: finalItems.slice(0, limit),
    });
  });

  // 4. POST /api/score-single
  app.post('/api/score-single', (req, res) => {
    try {
      const payloadJson = JSON.stringify(req.body || {});
      const pyScript = `
import csv, json, sys
sys.path.insert(0, 'backend')
from engine import LedgerGuardHybridEngine
with open('backend/synthetic_ap_ledger.csv', 'r', encoding='utf-8') as f:
    ledger = list(csv.DictReader(f))
incoming = json.loads(sys.argv[1])
engine = LedgerGuardHybridEngine()
result = engine.score_single_invoice(incoming, ledger)
print(json.dumps(result))
`;
      const out = execFileSync('python3', ['-c', pyScript, payloadJson], {
        cwd: ROOT_DIR,
        encoding: 'utf-8',
      });
      res.json(JSON.parse(out.trim()));
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // 5. POST /api/extract-pdf (Server-Side Gemini Multimodal Extraction + Deterministic Fallback)
  app.post('/api/extract-pdf', async (req, res) => {
    const { filename = 'invoice.pdf', mimeType = 'application/pdf', base64Data = '' } = req.body || {};
    const apiKey = process.env.GEMINI_API_KEY;

    if (apiKey && apiKey !== 'MY_GEMINI_API_KEY' && base64Data) {
      try {
        const ai = new GoogleGenAI({
          apiKey,
          httpOptions: {
            headers: {
              'User-Agent': 'aistudio-build',
            },
          },
        });

        const response = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: {
            parts: [
              {
                inlineData: {
                  mimeType,
                  data: base64Data,
                },
              },
              {
                text: 'Extract the Indian Accounts Payable invoice fields into JSON. If any field is missing, infer a realistic Indian AP value.',
              },
            ],
          },
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                vendor_id: { type: Type.STRING },
                vendor_name: { type: Type.STRING },
                gstin: { type: Type.STRING },
                bank_ifsc: { type: Type.STRING },
                bank_account: { type: Type.STRING },
                invoice_no: { type: Type.STRING },
                po_number: { type: Type.STRING },
                invoice_date: { type: Type.STRING },
                service_period: { type: Type.STRING },
                hsn_code: { type: Type.STRING },
                quantity: { type: Type.INTEGER },
                unit_price: { type: Type.NUMBER },
                subtotal: { type: Type.NUMBER },
                tax_amount: { type: Type.NUMBER },
                gross_total: { type: Type.NUMBER },
                ocr_confidence: { type: Type.NUMBER },
              },
            },
          },
        });

        const parsed = JSON.parse((response.text ?? '{}').trim());
        res.json({
          extraction_engine: 'gemini-4-hydrogen',
          filename,
          extracted_fields: parsed,
        });
        return;
      } catch (err) {
        console.warn('[LedgerGuard] Gemini extraction fallback triggered:', err);
      }
    }

    // Deterministic fallback via backend/pdf_extractor.py
    try {
      const pyScript = `
import base64, json, sys
sys.path.insert(0, 'backend')
from pdf_extractor import parse_invoice_with_deterministic_fallback
raw_bytes = base64.b64decode(sys.argv[1]) if sys.argv[1] else b""
raw_text = raw_bytes.decode('utf-8', errors='ignore')
res = parse_invoice_with_deterministic_fallback(raw_text=raw_text, filename=sys.argv[2])
print(json.dumps(res))
`;
      const out = execFileSync('python3', ['-c', pyScript, base64Data, filename], {
        cwd: ROOT_DIR,
        encoding: 'utf-8',
      });
      const parsed = JSON.parse(out.trim());
      res.json({
        extraction_engine: 'deterministic_fallback_v1',
        filename,
        extracted_fields: parsed,
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // 6. POST /api/disposition
  app.post('/api/disposition', (req, res) => {
    const { record_id, auditor_name, decision, audit_note } = req.body || {};
    if (!record_id || typeof record_id !== 'string') {
      res.status(400).json({ detail: 'record_id is required.' });
      return;
    }
    if (!auditor_name || typeof auditor_name !== 'string' || auditor_name.trim().length < 2) {
      res.status(400).json({ detail: 'Auditor name is required (min 2 chars).' });
      return;
    }
    if (!VALID_DECISIONS.has(decision)) {
      res.status(400).json({
        detail: 'Decision must be HOLD_PAYMENT, CONFIRM_DUPLICATE, or OVERRIDE_RELEASE.',
      });
      return;
    }
    if (!audit_note || typeof audit_note !== 'string' || audit_note.trim().length < 5) {
      res.status(400).json({
        detail: 'Mandatory audit rationale must be at least 5 characters.',
      });
      return;
    }

    const trail = readAuditTrail();
    const target = ledgerById.get(record_id);
    const entry: AuditEntry = {
      disposition_id: `AUD-2026-${String(trail.length + 1).padStart(4, '0')}`,
      record_id: record_id.trim(),
      vendor_name: target?.vendor_name || 'Live Submitted Vendor',
      invoice_no: target?.invoice_no || 'INV-LIVE',
      gross_total: Number(target?.gross_total || 0),
      reason_codes: target?.reason_codes || 'MANUAL_REVIEW',
      auditor_name: auditor_name.trim(),
      decision,
      audit_note: audit_note.trim(),
      timestamp_utc: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    };

    trail.unshift(entry);
    fs.writeFileSync(AUDIT_JSON, JSON.stringify(trail, null, 2), 'utf-8');
    res.json({ status: 'recorded', disposition: entry });
  });

  // 7. GET /api/audit-trail
  app.get('/api/audit-trail', (_req, res) => {
    const items = readAuditTrail();
    res.json({ total: items.length, items });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(ROOT_DIR, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[LedgerGuard AI] Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
