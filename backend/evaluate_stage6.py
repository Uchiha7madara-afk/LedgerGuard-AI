#!/usr/bin/env python3
"""
Stage 6 Evaluation & Benchmark Suite comparing StandardERPBaseline vs. LedgerGuardHybridEngine
on the 10,000-row synthetic Indian AP ledger (synthetic_ap_ledger.csv).

Outputs:
- stage6_scored_audit_queue.csv
- stage6_metrics_summary.json

Verifies acceptance criteria:
1. Hybrid Near-Duplicate Recall >= 92% (vs ERP Baseline ~27%)
2. Hybrid Precision@100 >= 85%
3. Split-Invoice Detection Rate >= 88%
4. Hard-Negative Recurring Bill False-Hold Rate <= 2%
5. Batch Scoring Latency for 10,000 rows < 5.0 seconds
"""

import csv
import json
import os
import time
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Dict, List

from engine import LedgerGuardHybridEngine, StandardERPBaseline
from generate_synthetic_ledger import generate_synthetic_ledger

DUPLICATE_TYPOLOGIES = {
    "EXACT_RESUBMISSION",
    "OCR_TYPO_NEAR_DUP",
    "DATE_SHIFT_VENDOR_ALIAS",
}

ALL_ANOMALY_TYPOLOGIES = [
    "EXACT_RESUBMISSION",
    "OCR_TYPO_NEAR_DUP",
    "DATE_SHIFT_VENDOR_ALIAS",
    "SPLIT_THRESHOLD_BYPASS",
    "SHARED_BANK_CROSS_VENDOR",
    "TAX_MATH_MISMATCH",
    "UNIT_PRICE_DRIFT",
]


def load_or_generate_ledger(csv_path: str) -> List[Dict[str, Any]]:
    if not os.path.exists(csv_path):
        return generate_synthetic_ledger(csv_path)
    with open(csv_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
    if len(rows) != 10000:
        return generate_synthetic_ledger(csv_path)
    return rows


def compute_brier_score(scored_rows: List[Dict[str, Any]], score_key: str) -> float:
    total = 0.0
    for r in scored_rows:
        y = float(int(r["is_anomaly"]))
        p = float(r[score_key])
        total += (p - y) ** 2
    return round(total / max(1, len(scored_rows)), 5)


def run_stage6_evaluation() -> Dict[str, Any]:
    base_dir = os.path.dirname(os.path.abspath(__file__))
    ledger_path = os.path.join(base_dir, "synthetic_ap_ledger.csv")
    queue_out_path = os.path.join(base_dir, "stage6_scored_audit_queue.csv")
    metrics_out_path = os.path.join(base_dir, "stage6_metrics_summary.json")

    rows = load_or_generate_ledger(ledger_path)

    # Time the full 10,000-row batch scoring
    engine = LedgerGuardHybridEngine()
    t0 = time.perf_counter()
    scored_rows = engine.score_ledger(rows)
    latency_sec = round(time.perf_counter() - t0, 4)

    # Compute KPI metrics
    # 1. Near-Duplicate Recall (across EXACT_RESUBMISSION + OCR_TYPO_NEAR_DUP + DATE_SHIFT_VENDOR_ALIAS = 550 rows)
    dup_rows = [r for r in scored_rows if r["anomaly_typology"] in DUPLICATE_TYPOLOGIES]
    erp_dup_hits = sum(1 for r in dup_rows if int(r["erp_baseline_flag"]) == 1)
    hybrid_dup_hits = sum(1 for r in dup_rows if int(r["hybrid_flag"]) == 1)

    erp_dup_recall_pct = round(100.0 * erp_dup_hits / max(1, len(dup_rows)), 2)
    hybrid_dup_recall_pct = round(100.0 * hybrid_dup_hits / max(1, len(dup_rows)), 2)

    # 2. Overall Anomaly Recall & Precision across all 1,000 injected anomalies
    total_anomalies = sum(1 for r in scored_rows if int(r["is_anomaly"]) == 1)
    erp_tp = sum(1 for r in scored_rows if int(r["is_anomaly"]) == 1 and int(r["erp_baseline_flag"]) == 1)
    erp_fp = sum(1 for r in scored_rows if int(r["is_anomaly"]) == 0 and int(r["erp_baseline_flag"]) == 1)

    hybrid_tp = sum(1 for r in scored_rows if int(r["is_anomaly"]) == 1 and int(r["hybrid_flag"]) == 1)
    hybrid_fp = sum(1 for r in scored_rows if int(r["is_anomaly"]) == 0 and int(r["hybrid_flag"]) == 1)

    erp_overall_recall_pct = round(100.0 * erp_tp / max(1, total_anomalies), 2)
    hybrid_overall_recall_pct = round(100.0 * hybrid_tp / max(1, total_anomalies), 2)
    hybrid_overall_precision_pct = round(
        100.0 * hybrid_tp / max(1, hybrid_tp + hybrid_fp), 2
    )

    # 3. Precision@100 (Top 100 highest risk alerts in audit queue)
    flagged_sorted = sorted(
        [r for r in scored_rows if float(r["hybrid_risk_score"]) >= 0.80],
        key=lambda x: (-float(x["hybrid_risk_score"]), str(x["record_id"])),
    )
    top_100 = flagged_sorted[:100]
    top_100_tp = sum(1 for r in top_100 if int(r["is_anomaly"]) == 1)
    top_100_fp = len(top_100) - top_100_tp
    precision_at_100_pct = round(100.0 * top_100_tp / max(1, len(top_100)), 2)

    # 4. Split-Invoice Detection Rate (150 rows = 50 clusters of 3)
    split_rows = [r for r in scored_rows if r["anomaly_typology"] == "SPLIT_THRESHOLD_BYPASS"]
    split_hits = sum(
        1
        for r in split_rows
        if "SPLIT_THRESHOLD_BYPASS" in str(r["reason_codes"])
    )
    split_detection_rate_pct = round(100.0 * split_hits / max(1, len(split_rows)), 2)

    # 5. Hard-Negative Recurring Bill False-Hold Rate (200 rows of CLEAN_RECURRING_HARD_NEG)
    recurring_rows = [
        r for r in scored_rows if r["anomaly_typology"] == "CLEAN_RECURRING_HARD_NEG"
    ]
    recurring_false_holds = sum(1 for r in recurring_rows if int(r["hybrid_flag"]) == 1)
    recurring_false_hold_rate_pct = round(
        100.0 * recurring_false_holds / max(1, len(recurring_rows)), 2
    )

    # 6. Abstention & Math Gate Count
    abstention_rows = [
        r
        for r in scored_rows
        if r["recommended_action"] == "ABSTAIN_MANUAL_OCR_VERIFY"
    ]
    abstention_count = len(abstention_rows)

    # 7. Typology Recall Breakdown
    typology_breakdown: List[Dict[str, Any]] = []
    for typ in ALL_ANOMALY_TYPOLOGIES:
        sub = [r for r in scored_rows if r["anomaly_typology"] == typ]
        e_hits = sum(1 for r in sub if int(r["erp_baseline_flag"]) == 1)
        h_hits = sum(1 for r in sub if int(r["hybrid_flag"]) == 1)
        typology_breakdown.append({
            "typology": typ,
            "total_injected": len(sub),
            "erp_caught": e_hits,
            "erp_recall_pct": round(100.0 * e_hits / max(1, len(sub)), 2),
            "hybrid_caught": h_hits,
            "hybrid_recall_pct": round(100.0 * h_hits / max(1, len(sub)), 2),
        })

    # Save stage6_scored_audit_queue.csv (all flagged records + matched record reference)
    queue_fields = list(scored_rows[0].keys())
    with open(queue_out_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=queue_fields)
        writer.writeheader()
        writer.writerows(flagged_sorted)

    # Total rupee exposure protected
    total_flagged_inr = round(
        sum(float(r["gross_total"]) for r in flagged_sorted if int(r["is_anomaly"]) == 1),
        2,
    )
    erp_protected_inr = round(
        sum(float(r["gross_total"]) for r in scored_rows if int(r["erp_baseline_flag"]) == 1 and int(r["is_anomaly"]) == 1),
        2,
    )

    metrics_summary = {
        "evaluated_at_utc": datetime.now(timezone.utc).isoformat(),
        "total_ledger_rows": len(scored_rows),
        "total_vendors": 80,
        "total_clean_rows": len(scored_rows) - total_anomalies,
        "total_injected_anomalies": total_anomalies,
        "total_flagged_alerts": len(flagged_sorted),
        "batch_scoring_latency_sec": latency_sec,
        "near_duplicate_recall": {
            "hybrid_pct": hybrid_dup_recall_pct,
            "erp_baseline_pct": erp_dup_recall_pct,
            "hybrid_caught": hybrid_dup_hits,
            "erp_caught": erp_dup_hits,
            "total_duplicate_anomalies": len(dup_rows),
        },
        "precision_at_100": {
            "precision_pct": precision_at_100_pct,
            "true_positives_in_top_100": top_100_tp,
            "false_holds_in_top_100": top_100_fp,
        },
        "split_invoice_capture": {
            "detection_rate_pct": split_detection_rate_pct,
            "caught_rows": split_hits,
            "total_split_rows": len(split_rows),
            "total_clusters": 50,
        },
        "recurring_hard_negative": {
            "false_hold_rate_pct": recurring_false_hold_rate_pct,
            "false_holds": recurring_false_holds,
            "total_recurring_rows": len(recurring_rows),
        },
        "abstention_gate": {
            "routed_count": abstention_count,
            "ocr_threshold": engine.ocr_abstention_threshold,
            "math_tolerance_inr": engine.math_tolerance_inr,
        },
        "overall_comparison": {
            "hybrid_overall_recall_pct": hybrid_overall_recall_pct,
            "erp_overall_recall_pct": erp_overall_recall_pct,
            "hybrid_overall_precision_pct": hybrid_overall_precision_pct,
            "hybrid_brier_score": compute_brier_score(scored_rows, "hybrid_risk_score"),
            "erp_brier_score": compute_brier_score(scored_rows, "erp_baseline_score"),
            "hybrid_protected_inr": total_flagged_inr,
            "erp_protected_inr": erp_protected_inr,
        },
        "typology_breakdown": typology_breakdown,
    }

    with open(metrics_out_path, "w", encoding="utf-8") as f:
        json.dump(metrics_summary, f, indent=2)

    print("=" * 78)
    print("STAGE 6 BENCHMARK EVALUATION SUMMARY — LEDGERGUARD AI vs. STANDARD ERP")
    print("=" * 78)
    print(f"Total Ledger Rows Scored     : {len(scored_rows):,}")
    print(f"Batch Scoring Latency        : {latency_sec:.4f}s (< 5.0s target)")
    print(f"Near-Duplicate Recall        : Hybrid {hybrid_dup_recall_pct:.2f}% vs. ERP Baseline {erp_dup_recall_pct:.2f}% (>= 92% target)")
    print(f"Precision@100 (Audit Queue)  : {precision_at_100_pct:.2f}% ({top_100_fp} false holds in top 100, >= 85% target)")
    print(f"Split-Invoice Detection Rate : {split_detection_rate_pct:.2f}% ({split_hits}/{len(split_rows)} rows, >= 88% target)")
    print(f"Recurring Bill False-Hold    : {recurring_false_hold_rate_pct:.2f}% ({recurring_false_holds}/{len(recurring_rows)} rows, <= 2% target)")
    print(f"Abstention & Math Gate Count : {abstention_count} invoices routed to manual OCR verification")
    print(f"Overall Recall (All 7 Types) : Hybrid {hybrid_overall_recall_pct:.2f}% vs. ERP Baseline {erp_overall_recall_pct:.2f}%")
    print(f"Protected Disbursement Value : ₹{total_flagged_inr:,.2f} (vs. ERP ₹{erp_protected_inr:,.2f})")
    print("=" * 78)

    # Mandatory Stage 6 Acceptance Criteria Assertions
    assert hybrid_dup_recall_pct >= 92.0, f"Hybrid Near-Duplicate Recall {hybrid_dup_recall_pct}% < 92%"
    assert precision_at_100_pct >= 85.0, f"Hybrid Precision@100 {precision_at_100_pct}% < 85%"
    assert split_detection_rate_pct >= 88.0, f"Split-Invoice Detection Rate {split_detection_rate_pct}% < 88%"
    assert recurring_false_hold_rate_pct <= 2.0, f"Recurring Bill False-Hold Rate {recurring_false_hold_rate_pct}% > 2%"
    assert latency_sec < 5.0, f"Batch Scoring Latency {latency_sec}s >= 5.0s"

    print("[PASS] All 5 Stage 6 benchmark acceptance assertions passed successfully.")
    return metrics_summary


if __name__ == "__main__":
    run_stage6_evaluation()
