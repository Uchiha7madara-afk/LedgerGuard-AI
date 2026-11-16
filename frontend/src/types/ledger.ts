export interface TypologyBreakdownItem {
  typology: string;
  total_injected: number;
  erp_caught: number;
  erp_recall_pct: number;
  hybrid_caught: number;
  hybrid_recall_pct: number;
}

export interface Stage6MetricsSummary {
  evaluated_at_utc: string;
  total_ledger_rows: number;
  total_vendors: number;
  total_clean_rows: number;
  total_injected_anomalies: number;
  total_flagged_alerts: number;
  batch_scoring_latency_sec: number;
  near_duplicate_recall: {
    hybrid_pct: number;
    erp_baseline_pct: number;
    hybrid_caught: number;
    erp_caught: number;
    total_duplicate_anomalies: number;
  };
  precision_at_100: {
    precision_pct: number;
    true_positives_in_top_100: number;
    false_holds_in_top_100: number;
  };
  split_invoice_capture: {
    detection_rate_pct: number;
    caught_rows: number;
    total_split_rows: number;
    total_clusters: number;
  };
  recurring_hard_negative: {
    false_hold_rate_pct: number;
    false_holds: number;
    total_recurring_rows: number;
  };
  abstention_gate: {
    routed_count: number;
    ocr_threshold: number;
    math_tolerance_inr: number;
  };
  overall_comparison: {
    hybrid_overall_recall_pct: number;
    erp_overall_recall_pct: number;
    hybrid_overall_precision_pct: number;
    hybrid_brier_score: number;
    erp_brier_score: number;
    hybrid_protected_inr: number;
    erp_protected_inr: number;
  };
  typology_breakdown: TypologyBreakdownItem[];
}

export interface SplitClusterPeer {
  record_id: string;
  invoice_no: string;
  invoice_date: string;
  po_number: string;
  gross_total: number;
}

export interface AuditDisposition {
  disposition_id: string;
  record_id: string;
  vendor_name: string;
  invoice_no: string;
  gross_total: number;
  reason_codes: string;
  auditor_name: string;
  decision: 'HOLD_PAYMENT' | 'CONFIRM_DUPLICATE' | 'OVERRIDE_RELEASE';
  audit_note: string;
  timestamp_utc: string;
}

export interface ProvenanceBox {
  field: string;
  value: string;
  page: number;
  bbox: [number, number, number, number];
  confidence: number;
}

export interface LedgerRecord {
  record_id: string;
  vendor_id: string;
  vendor_name: string;
  gstin: string;
  bank_ifsc: string;
  bank_account: string;
  invoice_no: string;
  po_number: string;
  invoice_date: string;
  service_period: string;
  hsn_code: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
  tax_amount: number;
  gross_total: number;
  ocr_confidence: number;
  is_anomaly: number | string;
  anomaly_typology: string;
  erp_baseline_flag?: number | string;
  erp_baseline_score?: number | string;
  erp_matched_record_id?: string;
  erp_reason_code?: string;
  hybrid_flag?: number | string;
  hybrid_risk_score: number;
  reason_codes: string;
  recommended_action: string;
  matched_record_id: string;
  vendor_median_unit_price?: number;
  unit_price_ratio?: number | string;
  split_cluster_total?: number;
  split_cluster_count?: number;
  split_cluster_ids?: string;
  split_cluster_records?: SplitClusterPeer[];
  matched_record?: LedgerRecord | null;
  disposition?: AuditDisposition | null;
}

export interface LiveScoreResponse {
  invoice: LedgerRecord;
  matched_record: LedgerRecord | null;
  provenance_boxes: ProvenanceBox[];
  extraction_engine?: string;
}

export type ReasonFilterKey =
  | 'ALL'
  | 'NEAR_DUP'
  | 'SPLIT'
  | 'SHARED_BANK'
  | 'ABSTENTION'
  | 'PRICE_DRIFT';
