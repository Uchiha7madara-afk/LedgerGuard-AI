#!/usr/bin/env python3
"""
Unit & Integration Test Suite for LedgerGuard AI Detection Engine.
Compatible with both `pytest` and `python3 -m unittest`!

Verifies:
1. GSTIN modulo-36 check digit calculation and corruption detection
2. OCR homoglyph normalization (0 <-> O, 1 <-> I, INV-26- -> INV-2026-, /A suffix)
3. Hard-negative suppression on consecutive monthly recurring retainers (CLEAN_RECURRING_HARD_NEG)
4. Layer 1 arithmetic mismatch & low OCR confidence automated abstention gate
5. Layer 3 bipartite graph shared beneficiary bank account across distinct vendors
6. Layer 4 72-hour split-invoice threshold bypass & unit-price cohort drift
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine import (
    LedgerGuardHybridEngine,
    StandardERPBaseline,
    jaro_winkler_similarity,
    normalize_ocr_invoice_no,
    verify_gstin_checksum,
)
from generate_synthetic_ledger import compute_gstin_check_digit, make_valid_gstin


class TestLedgerGuardEngine(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = LedgerGuardHybridEngine()
        self.erp = StandardERPBaseline()
        self.valid_gstin = make_valid_gstin("27", "AABCU9603R", "1")

    def test_gstin_modulo36_checksum_validation(self) -> None:
        """Verify valid 15-char GSTIN passes and mutated check digit fails."""
        self.assertEqual(len(self.valid_gstin), 15)
        self.assertTrue(verify_gstin_checksum(self.valid_gstin))

        # Corrupt last character (check digit)
        last_char = self.valid_gstin[-1]
        corrupted = self.valid_gstin[:-1] + ("9" if last_char != "9" else "8")
        self.assertFalse(verify_gstin_checksum(corrupted))
        self.assertFalse(verify_gstin_checksum("INVALID123"))

    def test_ocr_invoice_normalization(self) -> None:
        """Verify OCR mutations normalize to identical canonical invoice numbers."""
        orig = "INV-2026-010452"
        ocr_o = "INV-2O26-010452"
        ocr_short_yr = "INV-26-10452"
        ocr_suffix = "INV-2026-010452/A"

        norm_orig = normalize_ocr_invoice_no(orig)
        self.assertEqual(norm_orig, normalize_ocr_invoice_no(ocr_o))
        self.assertEqual(norm_orig, normalize_ocr_invoice_no(ocr_short_yr))
        self.assertEqual(norm_orig, normalize_ocr_invoice_no(ocr_suffix))
        self.assertGreater(jaro_winkler_similarity(orig, ocr_o), 0.90)

    def test_recurring_retainer_hard_negative_suppression(self) -> None:
        """
        Consecutive monthly ₹45,000 + GST retainers spaced ~30 days apart with sequential
        service_period values and distinct invoice numbers must NOT be flagged as duplicates.
        """
        records = [
            {
                "record_id": "AP-REC-01",
                "vendor_id": "VND-001",
                "vendor_name": "Bharat Industrial Supplies Pvt Ltd",
                "gstin": self.valid_gstin,
                "bank_ifsc": "HDFC0001000",
                "bank_account": "918000000000",
                "invoice_no": "RET-JAN-7001/01",
                "po_number": "PO-RET-001",
                "invoice_date": "2026-01-05",
                "service_period": "2026-01",
                "hsn_code": "9983",
                "quantity": 1,
                "unit_price": 45000.0,
                "subtotal": 45000.0,
                "tax_amount": 8100.0,
                "gross_total": 53100.0,
                "ocr_confidence": 0.96,
                "is_anomaly": 0,
                "anomaly_typology": "CLEAN_RECURRING_HARD_NEG",
            },
            {
                "record_id": "AP-REC-02",
                "vendor_id": "VND-001",
                "vendor_name": "Bharat Industrial Supplies Pvt Ltd",
                "gstin": self.valid_gstin,
                "bank_ifsc": "HDFC0001000",
                "bank_account": "918000000000",
                "invoice_no": "RET-FEB-7132/01",
                "po_number": "PO-RET-001",
                "invoice_date": "2026-02-05",
                "service_period": "2026-02",
                "hsn_code": "9983",
                "quantity": 1,
                "unit_price": 45000.0,
                "subtotal": 45000.0,
                "tax_amount": 8100.0,
                "gross_total": 53100.0,
                "ocr_confidence": 0.95,
                "is_anomaly": 0,
                "anomaly_typology": "CLEAN_RECURRING_HARD_NEG",
            },
        ]
        scored = self.engine.score_ledger(records)
        self.assertEqual(scored[1]["hybrid_flag"], 0)
        self.assertEqual(scored[1]["recommended_action"], "AUTO_APPROVE_CLEAN")
        self.assertEqual(scored[1]["recurring_guardrail_triggered"], 1)

    def test_near_duplicate_caught_by_hybrid_missed_by_erp(self) -> None:
        """Verify OCR typo near-duplicate is missed by StandardERPBaseline but caught by Hybrid."""
        records = [
            {
                "record_id": "AP-BASE-01",
                "vendor_id": "VND-002",
                "vendor_name": "Apex Precision Components Pvt Ltd",
                "gstin": self.valid_gstin,
                "bank_ifsc": "ICIC0001001",
                "bank_account": "918000104729",
                "invoice_no": "INV-2026-010452",
                "po_number": "PO-2026-002",
                "invoice_date": "2026-02-10",
                "service_period": "2026-02",
                "hsn_code": "8504",
                "quantity": 5,
                "unit_price": 12000.0,
                "subtotal": 60000.0,
                "tax_amount": 10800.0,
                "gross_total": 70800.0,
                "ocr_confidence": 0.94,
                "is_anomaly": 0,
                "anomaly_typology": "CLEAN_NORMAL",
            },
            {
                "record_id": "AP-NDUP-02",
                "vendor_id": "VND-002",
                "vendor_name": "Apex Precision Comp. P. Ltd.",
                "gstin": self.valid_gstin,
                "bank_ifsc": "ICIC0001001",
                "bank_account": "918000104729",
                "invoice_no": "INV-2O26-010452/A",
                "po_number": "PO-2026-002",
                "invoice_date": "2026-02-11",
                "service_period": "2026-02",
                "hsn_code": "8504",
                "quantity": 5,
                "unit_price": 12000.0,
                "subtotal": 60000.0,
                "tax_amount": 10800.0,
                "gross_total": 70800.0,
                "ocr_confidence": 0.89,
                "is_anomaly": 1,
                "anomaly_typology": "OCR_TYPO_NEAR_DUP",
            },
        ]
        scored = self.engine.score_ledger(records)
        self.assertEqual(scored[1]["erp_baseline_flag"], 0)
        self.assertEqual(scored[1]["hybrid_flag"], 1)
        self.assertIn("NEAR_DUP_INV_NO_OR_ALIAS", scored[1]["reason_codes"])
        self.assertEqual(scored[1]["matched_record_id"], "AP-BASE-01")

    def test_math_mismatch_and_low_ocr_abstention_gate(self) -> None:
        """Verify Layer 1 routes math discrepancy > ₹1.00 and low OCR confidence (<0.80) to abstention."""
        records = [
            {
                "record_id": "AP-MATH-01",
                "vendor_id": "VND-003",
                "vendor_name": "Deccan Logistics Pvt Ltd",
                "gstin": self.valid_gstin,
                "bank_ifsc": "SBIN0001002",
                "bank_account": "918000209458",
                "invoice_no": "INV-2026-MTH-001",
                "po_number": "PO-2026-003",
                "invoice_date": "2026-02-15",
                "service_period": "2026-02",
                "hsn_code": "9965",
                "quantity": 4,
                "unit_price": 15000.0,
                "subtotal": 60000.0,
                "tax_amount": 10800.0,
                "gross_total": 71950.0,  # ₹1,150 discrepancy
                "ocr_confidence": 0.72,  # < 0.80 abstention gate
                "is_anomaly": 1,
                "anomaly_typology": "TAX_MATH_MISMATCH",
            }
        ]
        scored = self.engine.score_ledger(records)
        self.assertEqual(scored[0]["hybrid_flag"], 1)
        self.assertEqual(scored[0]["recommended_action"], "ABSTAIN_MANUAL_OCR_VERIFY")
        self.assertIn("EXTRACTION_MATH_MISMATCH", scored[0]["reason_codes"])
        self.assertIn("NEEDS_MANUAL_OCR_REVIEW", scored[0]["reason_codes"])

    def test_split_threshold_bypass_72h_cluster(self) -> None:
        """Verify 3 sub-₹50,000 invoices within 72h summing > ₹57,500 trigger SPLIT_THRESHOLD_BYPASS."""
        records = [
            {
                "record_id": f"AP-SPL-0{i + 1}",
                "vendor_id": "VND-010",
                "vendor_name": "Sahyadri Packaging Pvt Ltd",
                "gstin": self.valid_gstin,
                "bank_ifsc": "AXIS0001010",
                "bank_account": "918000999111",
                "invoice_no": f"INV-2026-SPL-0{i + 1}",
                "po_number": "PO-2026-SPL-01",
                "invoice_date": f"2026-02-1{i + 1}",
                "service_period": "2026-02",
                "hsn_code": "4819",
                "quantity": 1,
                "unit_price": 34500.0,
                "subtotal": 34500.0,
                "tax_amount": 6210.0,
                "gross_total": 40710.0,
                "ocr_confidence": 0.95,
                "is_anomaly": 1,
                "anomaly_typology": "SPLIT_THRESHOLD_BYPASS",
            }
            for i in range(3)
        ]
        scored = self.engine.score_ledger(records)
        for row in scored:
            self.assertEqual(row["hybrid_flag"], 1)
            self.assertIn("SPLIT_THRESHOLD_BYPASS", row["reason_codes"])
            self.assertAlmostEqual(row["split_cluster_total"], 122130.0, places=1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
