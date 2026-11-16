#!/usr/bin/env python3
"""
LedgerGuard AI — FastAPI Pre-Disbursement AP Audit & Triage Service.

Exposes REST endpoints with CORS enabled (*):
- GET  /api/metrics     : Returns stage6_metrics_summary.json
- GET  /api/queue       : Filterable priority queue of flagged invoices (hybrid_risk_score >= 0.80)
                          with full matched_record payload for side-by-side visual diffing
- POST /api/score-single: Real-time scoring of a new JSON or uploaded PDF invoice against the ledger
- POST /api/disposition : Mandatory human-in-the-loop sign-off endpoint with SQLite + JSON audit persistence
- GET  /api/audit-trail : Immutable disposition history with UTC timestamps
"""

import csv
import json
import os
import sqlite3
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from engine import LedgerGuardHybridEngine
from evaluate_stage6 import run_stage6_evaluation
from generate_synthetic_ledger import generate_synthetic_ledger
from pdf_extractor import extract_invoice_multimodal

try:
    from fastapi import FastAPI, HTTPException, Query, UploadFile, File, Body
    from fastapi.middleware.cors import CORSMiddleware
    from pydantic import BaseModel, Field
except ImportError:
    FastAPI = None
    BaseModel = object  # type: ignore

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
LEDGER_CSV = os.path.join(BASE_DIR, "synthetic_ap_ledger.csv")
QUEUE_CSV = os.path.join(BASE_DIR, "stage6_scored_audit_queue.csv")
METRICS_JSON = os.path.join(BASE_DIR, "stage6_metrics_summary.json")
AUDIT_JSON = os.path.join(BASE_DIR, "audit_trail.json")
AUDIT_SQLITE = os.path.join(BASE_DIR, "audit_trail.db")

VALID_DECISIONS = {"HOLD_PAYMENT", "CONFIRM_DUPLICATE", "OVERRIDE_RELEASE"}


def init_audit_storage() -> None:
    """Initialize SQLite and JSON audit persistence with default seed dispositions if empty."""
    conn = sqlite3.connect(AUDIT_SQLITE)
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS dispositions (
            disposition_id TEXT PRIMARY KEY,
            record_id TEXT NOT NULL,
            vendor_name TEXT NOT NULL,
            invoice_no TEXT NOT NULL,
            gross_total REAL NOT NULL,
            reason_codes TEXT NOT NULL,
            auditor_name TEXT NOT NULL,
            decision TEXT NOT NULL,
            audit_note TEXT NOT NULL,
            timestamp_utc TEXT NOT NULL
        )
        """
    )
    conn.commit()

    if not os.path.exists(AUDIT_JSON):
        seed_entries = [
            {
                "disposition_id": "AUD-2026-0001",
                "record_id": "AP-2026-09001",
                "vendor_name": "Bharat Industrial Supplies Pvt Ltd",
                "invoice_no": "INV-2025-010001",
                "gross_total": 62319.91,
                "reason_codes": "EXACT_DUPLICATE_INVOICE",
                "auditor_name": "Meera Krishnan (Sr. AP Controller)",
                "decision": "CONFIRM_DUPLICATE",
                "audit_note": "Confirmed exact duplicate resubmission against AP-2026-00001; payment voucher blocked.",
                "timestamp_utc": "2026-03-14T09:15:22Z",
            },
            {
                "disposition_id": "AUD-2026-0002",
                "record_id": "AP-2026-09151",
                "vendor_name": "Apex Industrial Supplies Pvt Ltd",
                "invoice_no": "INV-2O25-010151",
                "gross_total": 67498.91,
                "reason_codes": "NEAR_DUP_INV_NO_OR_ALIAS",
                "auditor_name": "Rohan Deshmukh (Forensic Audit Lead)",
                "decision": "HOLD_PAYMENT",
                "audit_note": "OCR character mutation '2O25' vs '2025' detected on resubmitted scan. Escalated to vendor desk.",
                "timestamp_utc": "2026-03-14T11:42:10Z",
            },
        ]
        with open(AUDIT_JSON, "w", encoding="utf-8") as f:
            json.dump(seed_entries, f, indent=2)
        for item in seed_entries:
            cur.execute(
                """
                INSERT OR IGNORE INTO dispositions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    item["disposition_id"],
                    item["record_id"],
                    item["vendor_name"],
                    item["invoice_no"],
                    item["gross_total"],
                    item["reason_codes"],
                    item["auditor_name"],
                    item["decision"],
                    item["audit_note"],
                    item["timestamp_utc"],
                ),
            )
        conn.commit()
    conn.close()


class AuditWorkbenchStore:
    """In-memory indexed store backed by CSV + SQLite/JSON persistence."""

    def __init__(self) -> None:
        init_audit_storage()
        if not os.path.exists(METRICS_JSON) or not os.path.exists(QUEUE_CSV):
            run_stage6_evaluation()

        self.engine = LedgerGuardHybridEngine()
        self.ledger_by_id: Dict[str, Dict[str, Any]] = {}
        self.ledger_rows: List[Dict[str, Any]] = []
        self.queue_rows: List[Dict[str, Any]] = []
        self._reload_data()

    def _reload_data(self) -> None:
        with open(LEDGER_CSV, "r", encoding="utf-8") as f:
            self.ledger_rows = list(csv.DictReader(f))
        for r in self.ledger_rows:
            self.ledger_by_id[str(r["record_id"])] = r

        with open(QUEUE_CSV, "r", encoding="utf-8") as f:
            self.queue_rows = list(csv.DictReader(f))
        for q in self.queue_rows:
            self.ledger_by_id[str(q["record_id"])] = q

    def get_metrics(self) -> Dict[str, Any]:
        with open(METRICS_JSON, "r", encoding="utf-8") as f:
            return json.load(f)

    def get_audit_trail(self) -> List[Dict[str, Any]]:
        if not os.path.exists(AUDIT_JSON):
            return []
        with open(AUDIT_JSON, "r", encoding="utf-8") as f:
            return json.load(f)

    def get_queue(
        self,
        limit: int = 100,
        reason_filter: str = "ALL",
        action_filter: str = "ALL",
        search: str = "",
    ) -> Dict[str, Any]:
        dispositions_by_rec = {
            d["record_id"]: d for d in self.get_audit_trail()
        }
        filtered: List[Dict[str, Any]] = []
        q_search = (search or "").strip().lower()
        r_filter = (reason_filter or "ALL").strip().upper()
        a_filter = (action_filter or "ALL").strip().upper()

        for row in self.queue_rows:
            score = float(row.get("hybrid_risk_score", 0.0))
            if score < 0.80:
                continue

            reasons = str(row.get("reason_codes", ""))
            action = str(row.get("recommended_action", ""))

            if r_filter and r_filter != "ALL":
                if r_filter == "NEAR_DUP":
                    if (
                        "EXACT_DUPLICATE_INVOICE" not in reasons
                        and "NEAR_DUP_INV_NO_OR_ALIAS" not in reasons
                    ):
                        continue
                elif r_filter == "SPLIT":
                    if "SPLIT_THRESHOLD_BYPASS" not in reasons:
                        continue
                elif r_filter == "SHARED_BANK":
                    if "SHARED_BANK_IFSC_DIFF_VENDOR" not in reasons:
                        continue
                elif r_filter == "ABSTENTION":
                    if (
                        "EXTRACTION_MATH_MISMATCH" not in reasons
                        and "NEEDS_MANUAL_OCR_REVIEW" not in reasons
                        and "INVALID_GSTIN_CHECKSUM" not in reasons
                    ):
                        continue
                elif r_filter == "PRICE_DRIFT":
                    if "UNIT_PRICE_COHORT_DRIFT" not in reasons:
                        continue
                elif r_filter not in reasons:
                    continue

            if a_filter and a_filter != "ALL" and a_filter != action.upper():
                continue

            if q_search:
                haystack = " ".join([
                    str(row.get("record_id", "")),
                    str(row.get("vendor_id", "")),
                    str(row.get("vendor_name", "")),
                    str(row.get("gstin", "")),
                    str(row.get("invoice_no", "")),
                    str(row.get("po_number", "")),
                    reasons,
                ]).lower()
                if q_search not in haystack:
                    continue

            enriched = dict(row)
            enriched["gross_total"] = float(row["gross_total"])
            enriched["subtotal"] = float(row["subtotal"])
            enriched["tax_amount"] = float(row["tax_amount"])
            enriched["unit_price"] = float(row["unit_price"])
            enriched["quantity"] = int(float(row["quantity"]))
            enriched["ocr_confidence"] = float(row["ocr_confidence"])
            enriched["hybrid_risk_score"] = float(row["hybrid_risk_score"])
            enriched["vendor_median_unit_price"] = float(
                row.get("vendor_median_unit_price", row["unit_price"])
            )
            enriched["split_cluster_total"] = float(row.get("split_cluster_total", 0.0))
            enriched["split_cluster_count"] = int(float(row.get("split_cluster_count", 0)))

            mid = str(row.get("matched_record_id", "")).strip()
            matched_rec = self.ledger_by_id.get(mid) if mid else None
            if matched_rec:
                m_copy = dict(matched_rec)
                m_copy["gross_total"] = float(matched_rec["gross_total"])
                m_copy["subtotal"] = float(matched_rec["subtotal"])
                m_copy["tax_amount"] = float(matched_rec["tax_amount"])
                m_copy["unit_price"] = float(matched_rec["unit_price"])
                m_copy["quantity"] = int(float(matched_rec["quantity"]))
                m_copy["ocr_confidence"] = float(matched_rec["ocr_confidence"])
                enriched["matched_record"] = m_copy
            else:
                enriched["matched_record"] = None

            # Include sibling records if part of a split cluster
            split_ids_str = str(row.get("split_cluster_ids", "")).strip()
            if split_ids_str:
                sibling_ids = [s for s in split_ids_str.split(",") if s]
                enriched["split_cluster_records"] = [
                    {
                        "record_id": sid,
                        "invoice_no": self.ledger_by_id[sid]["invoice_no"],
                        "invoice_date": self.ledger_by_id[sid]["invoice_date"],
                        "po_number": self.ledger_by_id[sid]["po_number"],
                        "gross_total": float(self.ledger_by_id[sid]["gross_total"]),
                    }
                    for sid in sibling_ids
                    if sid in self.ledger_by_id
                ]
            else:
                enriched["split_cluster_records"] = []

            disp = dispositions_by_rec.get(str(row["record_id"]))
            enriched["disposition"] = disp
            filtered.append(enriched)

        return {
            "total_matching": len(filtered),
            "returned_count": min(limit, len(filtered)),
            "items": filtered[:limit],
        }

    def record_disposition(
        self,
        record_id: str,
        auditor_name: str,
        decision: str,
        audit_note: str,
    ) -> Dict[str, Any]:
        if decision not in VALID_DECISIONS:
            raise ValueError(f"Invalid decision '{decision}'. Expected one of {VALID_DECISIONS}")
        if not auditor_name or len(auditor_name.strip()) < 2:
            raise ValueError("Auditor name is required.")
        if not audit_note or len(audit_note.strip()) < 5:
            raise ValueError("Mandatory audit rationale must be at least 5 characters.")

        target = self.ledger_by_id.get(record_id)
        vendor_name = target["vendor_name"] if target else "Live Submitted Vendor"
        invoice_no = target["invoice_no"] if target else "INV-LIVE"
        gross_total = float(target["gross_total"]) if target else 0.0
        reason_codes = str(target.get("reason_codes", "MANUAL_REVIEW")) if target else "MANUAL_REVIEW"

        trail = self.get_audit_trail()
        disp_id = f"AUD-2026-{len(trail) + 1:04d}"
        now_utc = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

        entry = {
            "disposition_id": disp_id,
            "record_id": record_id,
            "vendor_name": vendor_name,
            "invoice_no": invoice_no,
            "gross_total": gross_total,
            "reason_codes": reason_codes,
            "auditor_name": auditor_name.strip(),
            "decision": decision,
            "audit_note": audit_note.strip(),
            "timestamp_utc": now_utc,
        }

        trail.insert(0, entry)
        with open(AUDIT_JSON, "w", encoding="utf-8") as f:
            json.dump(trail, f, indent=2)

        conn = sqlite3.connect(AUDIT_SQLITE)
        cur = conn.cursor()
        cur.execute(
            """
            INSERT OR REPLACE INTO dispositions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                entry["disposition_id"],
                entry["record_id"],
                entry["vendor_name"],
                entry["invoice_no"],
                entry["gross_total"],
                entry["reason_codes"],
                entry["auditor_name"],
                entry["decision"],
                entry["audit_note"],
                entry["timestamp_utc"],
            ),
        )
        conn.commit()
        conn.close()
        return entry


if FastAPI is not None:
    app = FastAPI(
        title="LedgerGuard AI — Pre-Disbursement AP Audit Workbench API",
        version="1.0.0",
        description="Supplier-Aware Accounts Payable Duplicate Payment & Policy Anomaly Triage Service",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    store = AuditWorkbenchStore()

    class DispositionRequest(BaseModel):
        record_id: str = Field(..., description="Target AP Ledger Record ID")
        auditor_name: str = Field(..., min_length=2, description="Human Auditor Full Name")
        decision: str = Field(..., description="HOLD_PAYMENT | CONFIRM_DUPLICATE | OVERRIDE_RELEASE")
        audit_note: str = Field(..., min_length=5, description="Mandatory audit rationale (>= 5 chars)")

    @app.get("/api/metrics")
    def get_metrics() -> Dict[str, Any]:
        return store.get_metrics()

    @app.get("/api/queue")
    def get_queue(
        limit: int = Query(100, ge=1, le=1000),
        reason_filter: str = Query("ALL"),
        action_filter: str = Query("ALL"),
        search: str = Query(""),
    ) -> Dict[str, Any]:
        return store.get_queue(
            limit=limit,
            reason_filter=reason_filter,
            action_filter=action_filter,
            search=search,
        )

    @app.post("/api/score-single")
    def score_single(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
        extracted = extract_invoice_multimodal(preset_override=payload)
        result = store.engine.score_single_invoice(extracted, store.ledger_rows)
        return result

    @app.post("/api/disposition")
    def create_disposition(req: DispositionRequest) -> Dict[str, Any]:
        try:
            entry = store.record_disposition(
                record_id=req.record_id,
                auditor_name=req.auditor_name,
                decision=req.decision,
                audit_note=req.audit_note,
            )
            return {"status": "recorded", "disposition": entry}
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

    @app.get("/api/audit-trail")
    def get_audit_trail() -> Dict[str, Any]:
        items = store.get_audit_trail()
        return {"total": len(items), "items": items}
