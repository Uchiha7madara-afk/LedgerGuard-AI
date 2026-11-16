# LedgerGuard AI — Supplier-Aware AP Duplicate Payment & Policy Anomaly Triage Workbench

**LedgerGuard AI** is a pre-disbursement Accounts Payable (AP) internal audit and duplicate payment prevention workbench built for Indian enterprise finance teams. It combines deterministic accounting rules, GSTIN modulo-36 check-digit verification, blocking fuzzy OCR string resolution, bipartite vendor-to-bank graph topology analysis, and 72-hour velocity clustering to catch complex duplicate resubmissions and policy bypasses that evade native ERP controls (SAP, Tally, Oracle).

---

## 1. System Architecture

```text
+-----------------------------------------------------------------------------------+
|                   INCOMING AP VOUCHER / MULTIMODAL PDF / LEDGER                   |
|        (pdf_extractor.py: Gemini Multimodal + Deterministic Regex Fallback)       |
+-----------------------------------------+-----------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
| LAYER 1: DETERMINISTIC ACCOUNTING & ABSTENTION GATE                               |
|  - 15-Char Indian GSTIN Modulo-36 Check Digit Verification (INVALID_GSTIN_CHECKSUM)|
|  - Tax Math Check: |subtotal + 18% GST - gross_total| <= ₹1.00                    |
|  - OCR Confidence Gate: ocr_confidence >= 0.80                                    |
|  -> Routes noisy / arithmetic-mismatched scans to ABSTAIN_MANUAL_OCR_VERIFY       |
+-----------------------------------------+-----------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
| LAYER 2: CANDIDATE BLOCKING & FUZZY RESOLUTION                                    |
|  - Blocks by (vendor_id, round(gross_total, 0)) to avoid O(N^2) comparisons       |
|  - Canonicalizes OCR homoglyphs (0<->O, 1<->I, INV-26->INV-2026, /A suffixes)     |
|  - Computes Jaro-Winkler normalized similarity on raw & canonical invoice_no      |
|  - HARD-NEGATIVE GUARDRAIL: Suppresses false holds on consecutive monthly         |
|    retainers (25-35 day spacing, distinct service_period & distinct invoice_no)   |
+-----------------------------------------+-----------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
| LAYER 3: BIPARTITE GRAPH LINK ANALYSIS (NetworkX)                                 |
|  - Links vendor_id nodes <-> bank_ifsc:bank_account nodes                         |
|  - Flags SHARED_BANK_IFSC_DIFF_VENDOR (0.93) when bank node in-degree > 1         |
+-----------------------------------------+-----------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
| LAYER 4: VELOCITY & STATISTICAL COHORT SCORING                                    |
|  - Rolling 72-hour sub-₹50,000 split-PO bypass clusters summing > ₹57,500 (0.91)  |
|  - IsolationForest + robust vendor median ratio > 1.20x unit_price drift (0.87)   |
+-----------------------------------------+-----------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
| AUDITOR TRIAGE WORKBENCH & IMMUTABLE HUMAN-IN-THE-LOOP DISPOSITION LOG            |
|  - Side-by-side character diff viewer + PDF bounding-box provenance coordinates   |
|  - Mandatory human sign-off (HOLD_PAYMENT | CONFIRM_DUPLICATE | OVERRIDE_RELEASE) |
+-----------------------------------------------------------------------------------+
```

---

## 2. Data Provenance & Synthetic Indian AP Corpus (`SEED = 42`)

`backend/generate_synthetic_ledger.py` deterministically generates `synthetic_ap_ledger.csv` containing **10,000 invoices across 80 Indian vendors** with valid 15-character state+PAN+Mod36 GSTINs, IFSC codes, HSN/SAC codes, and 18% GST tax calculations:

- **Base Clean Distribution (9,000 Rows — 90%)**:
  - `CLEAN_NORMAL` (**8,800 rows**): Standard commercial invoices across 80 Indian suppliers.
  - `CLEAN_RECURRING_HARD_NEG` (**200 rows**): Identical monthly ₹45,000 + 18% GST (₹53,100 gross) retainers billed on the 5th of consecutive months with sequential `service_period` values (`2025-06` through `2026-03`) to test false-positive suppression.
- **Injected Fraud & Error Typologies (1,000 Rows — 10% Base Rate)**:
  1. `EXACT_RESUBMISSION` (**150 rows**): Exact collision on `(vendor_id, invoice_no, gross_total)`.
  2. `OCR_TYPO_NEAR_DUP` (**220 rows**): Resubmitted invoice with OCR character mutations (`0 <-> O`, `1 <-> I`, dropped leading zeros, `INV-2026-` -> `INV-26-`).
  3. `DATE_SHIFT_VENDOR_ALIAS` (**180 rows**): Resubmitted invoice with `+1` or `+2` day date shift, trade-name alias variation (`Pvt Ltd` -> `P. Ltd.`, `Industrial Supplies` -> `Ind. Supplies`), and `/A` amendment suffix.
  4. `SPLIT_THRESHOLD_BYPASS` (**150 rows = 50 clusters of 3 invoices**): Same vendor and PO submitting three ₹39,500–₹42,000 gross invoices within 72 hours to bypass the ₹50,000 manager approval limit (combined cluster > ₹1,18,000).
  5. `SHARED_BANK_CROSS_VENDOR` (**100 rows**): Two distinct `vendor_id`s routing payouts to the exact same beneficiary `bank_ifsc` + `bank_account`.
  6. `TAX_MATH_MISMATCH` (**100 rows**): `subtotal + tax_amount != gross_total` (discrepancy > ₹450) paired with low `ocr_confidence` (< 0.78) and corrupted GSTIN check digits to trigger Layer 1 automated abstention.
  7. `UNIT_PRICE_DRIFT` (**100 rows**): `unit_price` inflated 28%–55% above the vendor's historical median unit price.

---

## 3. Stage 6 Benchmark Evaluation Results

Executed via `python3 backend/evaluate_stage6.py` on the 10,000-row corpus:

| Benchmark Metric / Acceptance Criterion | Standard ERP Baseline (SAP/Tally Exact Rule) | LedgerGuard AI (4-Layer Hybrid Engine) | Stage 6 Target | Status |
| :--- | :---: | :---: | :---: | :---: |
| **Near-Duplicate Recall** (`550` dup/OCR/alias rows) | `27.27%` (`150 / 550`) | **`100.00%` (`550 / 550`)** | `&ge; 92.0%` | **PASS** |
| **Precision@100** (Top 100 Triage Alerts) | `100.00%` | **`100.00%` (`0` false holds)** | `&ge; 85.0%` | **PASS** |
| **Split-Invoice Detection Rate** (`50` clusters / `150` rows) | `0.00%` (`0 / 150`) | **`100.00%` (`150 / 150`)** | `&ge; 88.0%` | **PASS** |
| **Recurring Bill False-Hold Rate** (`200` hard negatives) | `0.00%` | **`0.00%` (`0 / 200` held)** | `&le; 2.0%` | **PASS** |
| **Abstention & Math Gate Routing** (`100` noisy/mismatch rows) | `0` routed | **`100` routed to manual OCR verify** | Deterministic Gate | **PASS** |
| **Overall Recall Across All 7 Typologies** (`1,000` rows) | `15.00%` (`150 / 1,000`) | **`100.00%` (`1,000 / 1,000`)** | Comprehensive | **PASS** |
| **Batch Scoring Latency** (`10,000` rows) | `0.04s` | **`0.24s`** | `< 5.0s` | **PASS** |
| **Protected Disbursement Exposure** | `₹2.50 Cr` (`₹24,959,213`) | **`₹15.93 Cr` (`₹159,307,361`)** | Max Protection | **PASS** |

---

## 4. Quickstart & Verification Commands

### A. Generate Dataset, Run Stage 6 Benchmark & Execute Test Suite
```bash
# 1. Generate the deterministic 10,000-row Indian AP ledger
python3 backend/generate_synthetic_ledger.py

# 2. Run the Stage 6 Benchmark Evaluation (asserts all 5 acceptance gates)
python3 backend/evaluate_stage6.py

# 3. Run the unit & edge-case test suite (GSTIN Mod-36, OCR normalization, hard-negative suppression)
python3 backend/tests/test_engine.py
```

### B. Launch the Full-Stack Workbench Server (Port 3000)
```bash
npm install
npm run dev
```

### C. Optional Standalone FastAPI Backend (Port 8000)
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```
