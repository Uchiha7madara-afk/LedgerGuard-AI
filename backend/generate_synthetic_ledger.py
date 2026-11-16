#!/usr/bin/env python3
"""
Deterministic Synthetic Indian Accounts Payable (AP) Ledger Generator.
Produces synthetic_ap_ledger.csv with 10,000 invoices across 80 Indian vendors:
- 8,800 CLEAN_NORMAL
- 200 CLEAN_RECURRING_HARD_NEG
- 150 EXACT_RESUBMISSION
- 220 OCR_TYPO_NEAR_DUP
- 180 DATE_SHIFT_VENDOR_ALIAS
- 150 SPLIT_THRESHOLD_BYPASS (50 clusters of 3 invoices)
- 100 SHARED_BANK_CROSS_VENDOR
- 100 TAX_MATH_MISMATCH
- 100 UNIT_PRICE_DRIFT
"""

import csv
import os
import random
from datetime import date, timedelta
from typing import Dict, List, Any

SEED = 42
GSTIN_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"

INDIAN_STATE_CODES = [
    "27",  # Maharashtra
    "29",  # Karnataka
    "07",  # Delhi
    "33",  # Tamil Nadu
    "36",  # Telangana
    "24",  # Gujarat
    "06",  # Haryana
    "09",  # Uttar Pradesh
    "19",  # West Bengal
    "32",  # Kerala
]

VENDOR_PREFIXES = [
    "Bharat", "Apex", "Vishwakarma", "Deccan", "Sahyadri", "Coromandel",
    "Indus", "Kaveri", "Aravalli", "Godavari", "Narmada", "Shivalik",
    "Konkan", "Malabar", "Vindhya", "Satpura", "Chola", "Pallava",
    "Maurya", "Gupta", "Maratha", "Rajputana", "Nilgiri", "Himalaya",
    "Ganga", "Yamuna", "Brahmaputra", "Mahanadi", "Krishna", "Tungabhadra",
    "Sabarmati", "Tapi", "Chambal", "Betwa", "Son", "Damodar",
    "Hooghly", "Teesta", "Barak", "Subarnarekha"
]

VENDOR_DOMAINS = [
    "Industrial Supplies Pvt Ltd",
    "Precision Components Pvt Ltd",
    "Logistics & Freight Services Pvt Ltd",
    "Cloud & IT Infrastructure Pvt Ltd",
    "Electrical Switchgear Pvt Ltd",
    "Packaging Solutions Pvt Ltd",
    "Chemical & Polymers Pvt Ltd",
    "Facility Management Services Pvt Ltd",
]

HSN_CATALOG = [
    ("8471", 12500.0),
    ("8504", 8400.0),
    ("3923", 3200.0),
    ("7308", 15600.0),
    ("9983", 22000.0),
    ("9965", 18500.0),
    ("8536", 6800.0),
    ("4819", 4500.0),
]

BANK_IFSC_PREFIXES = [
    "HDFC000", "ICIC000", "SBIN000", "AXIS000", "KKBK000", "PUNB000", "BARB000", "UTIB000"
]

FIELDNAMES = [
    "record_id",
    "vendor_id",
    "vendor_name",
    "gstin",
    "bank_ifsc",
    "bank_account",
    "invoice_no",
    "po_number",
    "invoice_date",
    "service_period",
    "hsn_code",
    "quantity",
    "unit_price",
    "subtotal",
    "tax_amount",
    "gross_total",
    "ocr_confidence",
    "is_anomaly",
    "anomaly_typology",
]


def compute_gstin_check_digit(base14: str) -> str:
    """Compute the mathematically valid 15th modulo-36 check digit for an Indian GSTIN."""
    if len(base14) != 14:
        raise ValueError(f"Expected 14-char GSTIN base, got {len(base14)}: {base14}")
    total = 0
    for idx, ch in enumerate(base14.upper()):
        val = GSTIN_ALPHABET.index(ch)
        factor = 1 if (idx % 2 == 0) else 2
        prod = val * factor
        term = (prod // 36) + (prod % 36)
        total += term
    rem = total % 36
    check_idx = (36 - rem) % 36
    return GSTIN_ALPHABET[check_idx]


def make_valid_gstin(state_code: str, pan: str, entity_code: str = "1") -> str:
    """Construct a 15-character valid GSTIN from a 2-digit state code and 10-char PAN."""
    base14 = f"{state_code}{pan}{entity_code}Z"
    return base14 + compute_gstin_check_digit(base14)


def mutate_vendor_alias(vendor_name: str, rng: random.Random) -> str:
    """Create realistic trade-name alias variations."""
    mutated = vendor_name
    if "Industrial Supplies" in mutated:
        mutated = mutated.replace("Industrial Supplies", "Ind. Supplies")
    elif "Precision Components" in mutated:
        mutated = mutated.replace("Precision Components", "Precision Comp.")
    elif "Logistics & Freight Services" in mutated:
        mutated = mutated.replace("Logistics & Freight Services", "Logistics & Freight")
    elif "Cloud & IT Infrastructure" in mutated:
        mutated = mutated.replace("Cloud & IT Infrastructure", "Cloud & IT Infra")
    elif "Electrical Switchgear" in mutated:
        mutated = mutated.replace("Electrical Switchgear", "Elect. Switchgear")
    elif "Packaging Solutions" in mutated:
        mutated = mutated.replace("Packaging Solutions", "Packaging Solns")
    elif "Chemical & Polymers" in mutated:
        mutated = mutated.replace("Chemical & Polymers", "Chem & Polymers")
    elif "Facility Management Services" in mutated:
        mutated = mutated.replace("Facility Management Services", "Facility Mgmt Svcs")

    if "Pvt Ltd" in mutated:
        replacement = rng.choice(["P. Ltd.", "Private Limited", "Pvt. Ltd."])
        mutated = mutated.replace("Pvt Ltd", replacement)
    return mutated


def mutate_invoice_ocr(inv_no: str, idx: int) -> str:
    """Deterministically apply realistic OCR character mutations to an invoice number."""
    mode = idx % 4
    if mode == 0 and "2026" in inv_no:
        return inv_no.replace("2026", "2O26", 1)
    if mode == 1 and "INV-2026-" in inv_no:
        return inv_no.replace("INV-2026-", "INV-26-", 1)
    if mode == 2:
        # Replace first '1' with 'I' or '0' with 'O'
        if "1" in inv_no:
            return inv_no.replace("1", "I", 1)
        if "0" in inv_no:
            return inv_no.replace("0", "O", 1)
    if mode == 3:
        # Drop leading zero after hyphen or swap 5 -> S
        if "-0" in inv_no:
            return inv_no.replace("-0", "-", 1)
        if "2025" in inv_no:
            return inv_no.replace("2025", "2O25", 1)
    # Fallback OCR mutation
    return inv_no[:-1] + ("O" if inv_no[-1] != "O" else "0")


def build_vendors(rng: random.Random) -> List[Dict[str, Any]]:
    """Generate 80 deterministic Indian vendor master profiles."""
    vendors: List[Dict[str, Any]] = []
    for i in range(80):
        vendor_id = f"VND-{i + 1:03d}"
        prefix = VENDOR_PREFIXES[i % len(VENDOR_PREFIXES)]
        domain = VENDOR_DOMAINS[i // 10]
        suffix_tag = "" if i < 40 else f" ({INDIAN_STATE_CODES[i % len(INDIAN_STATE_CODES)]})"
        vendor_name = f"{prefix}{suffix_tag} {domain}".replace("  ", " ")
        state_code = INDIAN_STATE_CODES[i % len(INDIAN_STATE_CODES)]
        pan_letters = "".join(rng.choices("ABCDEFGHJKLMNPQRSTUVWXYZ", k=5))
        pan_digits = f"{1000 + i * 37:04d}"
        pan_last = GSTIN_ALPHABET[10 + (i % 20)]
        pan = f"{pan_letters[:3]}C{pan_letters[3]}{pan_digits}{pan_last}"
        gstin = make_valid_gstin(state_code, pan, entity_code="1")

        ifsc_prefix = BANK_IFSC_PREFIXES[i % len(BANK_IFSC_PREFIXES)]
        bank_ifsc = f"{ifsc_prefix}{1000 + i:04d}"
        bank_account = f"91{8000000000 + i * 104729:010d}"

        hsn_code, base_unit_price = HSN_CATALOG[i % len(HSN_CATALOG)]
        # Give each vendor a distinct baseline unit price
        vendor_unit_price = round(base_unit_price * (1.0 + ((i % 7) * 0.04)), 2)

        vendors.append({
            "vendor_id": vendor_id,
            "vendor_name": vendor_name,
            "gstin": gstin,
            "bank_ifsc": bank_ifsc,
            "bank_account": bank_account,
            "hsn_code": hsn_code,
            "base_unit_price": vendor_unit_price,
        })
    return vendors


def generate_synthetic_ledger(output_path: str = None) -> List[Dict[str, Any]]:
    """Generate the 10,000-row synthetic Indian AP ledger with 8 anomaly typologies."""
    rng = random.Random(SEED)
    vendors = build_vendors(rng)

    rows: List[Dict[str, Any]] = []
    start_date = date(2025, 4, 1)

    # 1. CLEAN_NORMAL (8,800 rows)
    # Assign clean invoices across the 80 vendors (110 per vendor).
    # Ensure gross_total >= 54,000 OR spaced >= 7 days apart and unique rounded gross_total per vendor
    # so clean rows never accidentally collide or form false 72h sub-50k split clusters.
    clean_normal_Pool: List[Dict[str, Any]] = []
    seq_counter = 10000
    for v_idx, v in enumerate(vendors):
        for k in range(110):
            seq_counter += 1
            inv_date = start_date + timedelta(days=(k * 3 + (v_idx % 3)) % 340)
            service_period = inv_date.strftime("%Y-%m")
            # Vary quantity and fine price delta so each clean invoice for a vendor has a distinct rounded gross_total
            qty = 4 + (k % 18)
            price_Load = 1.0 + ((k - 55) * 0.0012)  # Within ±6.6% of vendor median
            unit_price = round(v["base_unit_price"] * price_Load, 2)
            subtotal = round(qty * unit_price + (k * 13.37), 2)
            # Keep clean normal subtotal >= 46,000 so gross_total >= 54,280 (above 50k split-Invoice threshold)
            if subtotal < 46500.0:
                qty = int(46500.0 // unit_price) + 1 + (k % 9)
                subtotal = round(qty * unit_price + (k * 17.25), 2)
            tax_amount = round(subtotal * 0.18, 2)
            gross_total = round(subtotal + tax_amount, 2)
            year_tag = inv_date.year
            inv_no = f"INV-{year_tag}-0{seq_counter}"
            po_no = f"PO-{year_tag}-{v['vendor_id'][-3:]}-{100 + (k // 4):03d}"

            row = {
                "record_id": "",  # Assigned after full assembly
                "vendor_id": v["vendor_id"],
                "vendor_name": v["vendor_name"],
                "gstin": v["gstin"],
                "bank_ifsc": v["bank_ifsc"],
                "bank_account": v["bank_account"],
                "invoice_no": inv_no,
                "po_number": po_no,
                "invoice_date": inv_date.isoformat(),
                "service_period": service_period,
                "hsn_code": v["hsn_code"],
                "quantity": qty,
                "unit_price": unit_price,
                "subtotal": subtotal,
                "tax_amount": tax_amount,
                "gross_total": gross_total,
                "ocr_confidence": round(rng.uniform(0.86, 0.99), 2),
                "is_anomaly": 0,
                "anomaly_typology": "CLEAN_NORMAL",
            }
            rows.append(row)
            clean_normal_Pool.append(row)

    # 2. CLEAN_RECURRING_HARD_NEG (200 rows)
    # 20 vendors x 10 consecutive monthly retainers on the 5th of each month (2025-06 to 2026-03)
    # Identical monthly ₹45,000 + 18% GST (₹8,100) = ₹53,100 gross_total
    recurring_months = [
        date(2025, 6, 5),
        date(2025, 7, 5),
        date(2025, 8, 5),
        date(2025, 9, 5),
        date(2025, 10, 5),
        date(2025, 11, 5),
        date(2025, 12, 5),
        date(2026, 1, 5),
        date(2026, 2, 5),
        date(2026, 3, 5),
    ]
    # Use fundamentally distinct invoice codes per month so Jaro-Winkler never confuses monthly bills
    month_alpha_codes = ["JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC", "JAN", "FEB", "MAR"]
    for v_idx in range(20):
        v = vendors[v_idx]
        for m_idx, m_date in enumerate(recurring_months):
            srv_period = m_date.strftime("%Y-%m")
            alpha = month_alpha_codes[m_idx]
            inv_no = f"RET-{alpha}-{7000 + m_idx * 131 + v_idx * 17}/{v['vendor_id'][-2:]}"
            po_no = f"PO-RET-{v['vendor_id'][-3:]}-ANNUAL"
            subtotal = 45000.00
            tax_amount = 8100.00
            gross_total = 53100.00
            rows.append({
                "record_id": "",
                "vendor_id": v["vendor_id"],
                "vendor_name": v["vendor_name"],
                "gstin": v["gstin"],
                "bank_ifsc": v["bank_ifsc"],
                "bank_account": v["bank_account"],
                "invoice_no": inv_no,
                "po_number": po_no,
                "invoice_date": m_date.isoformat(),
                "service_period": srv_period,
                "hsn_code": "9983",
                "quantity": 1,
                "unit_price": v["base_unit_price"],
                "subtotal": subtotal,
                "tax_amount": tax_amount,
                "gross_total": gross_total,
                "ocr_confidence": round(rng.uniform(0.91, 0.99), 2),
                "is_anomaly": 0,
                "anomaly_typology": "CLEAN_RECURRING_HARD_NEG",
            })

    # Select distinct clean base invoices for duplicate/near-duplicate injection so each has a 1-to-1 clean match
    candidate_bases = clean_normal_Pool[:600]

    # 3. EXACT_RESUBMISSION (150 rows)
    for idx in range(150):
        base = candidate_bases[idx]
        dup = dict(base)
        dup["record_id"] = ""
        dup["ocr_confidence"] = round(rng.uniform(0.88, 0.99), 2)
        dup["is_anomaly"] = 1
        dup["anomaly_typology"] = "EXACT_RESUBMISSION"
        rows.append(dup)

    # 4. OCR_TYPO_NEAR_DUP (220 rows)
    for idx in range(220):
        base = candidate_bases[150 + idx]
        dup = dict(base)
        dup["record_id"] = ""
        dup["invoice_no"] = mutate_invoice_ocr(base["invoice_no"], idx)
        dup["ocr_confidence"] = round(rng.uniform(0.82, 0.95), 2)
        dup["is_anomaly"] = 1
        dup["anomaly_typology"] = "OCR_TYPO_NEAR_DUP"
        rows.append(dup)

    # 5. DATE_SHIFT_VENDOR_ALIAS (180 rows)
    for idx in range(180):
        base = candidate_bases[370 + idx]
        dup = dict(base)
        dup["record_id"] = ""
        orig_date = date.fromisoformat(base["invoice_date"])
        shifted_date = orig_date + timedelta(days=1 if (idx % 2 == 0) else 2)
        dup["invoice_date"] = shifted_date.isoformat()
        dup["vendor_name"] = mutate_vendor_alias(base["vendor_name"], rng)
        dup["invoice_no"] = f"{base['invoice_no']}/A"
        dup["ocr_confidence"] = round(rng.uniform(0.85, 0.97), 2)
        dup["is_anomaly"] = 1
        dup["anomaly_typology"] = "DATE_SHIFT_VENDOR_ALIAS"
        rows.append(dup)

    # 6. SPLIT_THRESHOLD_BYPASS (150 rows = 50 clusters of 3 invoices)
    # Same vendor and PO submitting three ₹39,500–₹42,000 gross invoices within a 72-hour window
    # to bypass the ₹50,000 manager approval threshold (combined total > ₹1,18,000)
    for cluster_idx in range(50):
        v = vendors[(cluster_idx * 3) % len(vendors)]
        base_day = date(2026, 1, 10) + timedelta(days=(cluster_idx * 5) % 70)
        po_no = f"PO-2026-SPL-{cluster_idx + 1:03d}"
        for part_idx in range(3):
            inv_date = base_day + timedelta(days=part_idx)  # 0h, 24h, 48h (within 72h)
            gross_target = round(rng.uniform(39600.0, 41900.0), 2)
            subtotal = round(gross_target / 1.18, 2)
            tax_amount = round(gross_target - subtotal, 2)
            gross_total = round(subtotal + tax_amount, 2)
            inv_no = f"INV-2026-SPL{cluster_idx + 1:03d}-{part_idx + 1}"
            rows.append({
                "record_id": "",
                "vendor_id": v["vendor_id"],
                "vendor_name": v["vendor_name"],
                "gstin": v["gstin"],
                "bank_ifsc": v["bank_ifsc"],
                "bank_account": v["bank_account"],
                "invoice_no": inv_no,
                "po_number": po_no,
                "invoice_date": inv_date.isoformat(),
                "service_period": inv_date.strftime("%Y-%m"),
                "hsn_code": v["hsn_code"],
                "quantity": 1,
                "unit_price": v["base_unit_price"],
                "subtotal": subtotal,
                "tax_amount": tax_amount,
                "gross_total": gross_total,
                "ocr_confidence": round(rng.uniform(0.88, 0.98), 2),
                "is_anomaly": 1,
                "anomaly_typology": "SPLIT_THRESHOLD_BYPASS",
            })

    # 7. SHARED_BANK_CROSS_VENDOR (100 rows)
    # Two distinct vendor_ids routing payouts to the exact same beneficiary bank_ifsc + bank_account.
    for idx in range(100):
        primary_v = vendors[idx % 25]
        secondary_v = vendors[25 + (idx % 25)]
        # Use primary_v's bank_ifsc and bank_account on secondary_v's invoice
        inv_date = date(2026, 2, 1) + timedelta(days=idx % 25)
        qty = 5 + (idx % 6)
        unit_price = secondary_v["base_unit_price"]
        subtotal = round(qty * unit_price + 31000.0 + idx * 43.0, 2)
        tax_amount = round(subtotal * 0.18, 2)
        gross_total = round(subtotal + tax_amount, 2)
        rows.append({
            "record_id": "",
            "vendor_id": secondary_v["vendor_id"],
            "vendor_name": secondary_v["vendor_name"],
            "gstin": secondary_v["gstin"],
            "bank_ifsc": primary_v["bank_ifsc"],
            "bank_account": primary_v["bank_account"],
            "invoice_no": f"INV-2026-SBK-{idx + 1:04d}",
            "po_number": f"PO-2026-SBK-{idx + 1:03d}",
            "invoice_date": inv_date.isoformat(),
            "service_period": inv_date.strftime("%Y-%m"),
            "hsn_code": secondary_v["hsn_code"],
            "quantity": qty,
            "unit_price": unit_price,
            "subtotal": subtotal,
            "tax_amount": tax_amount,
            "gross_total": gross_total,
            "ocr_confidence": round(rng.uniform(0.89, 0.98), 2),
            "is_anomaly": 1,
            "anomaly_typology": "SHARED_BANK_CROSS_VENDOR",
        })

    # 8. TAX_MATH_MISMATCH (100 rows)
    # subtotal + tax_amount != gross_total (discrepancy > ₹450) paired with low ocr_confidence (< 0.78)
    # Also corrupt GSTIN checksum on every 5th row to exercise Layer 1 GSTIN checksum verification in live queue
    for idx in range(100):
        v = vendors[idx % len(vendors)]
        inv_date = date(2026, 2, 10) + timedelta(days=idx % 20)
        qty = 6 + (idx % 5)
        unit_price = v["base_unit_price"]
        subtotal = round(qty * unit_price + 25000.0, 2)
        tax_amount = round(subtotal * 0.18, 2)
        discrepancy = round(rng.uniform(480.0, 2450.0), 2)
        gross_total = round(subtotal + tax_amount + discrepancy, 2)
        gstin = v["gstin"]
        if idx % 5 == 0:
            # Flip last check digit so modulo-36 checksum fails
            bad_last = "A" if gstin[-1] != "A" else "B"
            gstin = gstin[:-1] + bad_last
        rows.append({
            "record_id": "",
            "vendor_id": v["vendor_id"],
            "vendor_name": v["vendor_name"],
            "gstin": gstin,
            "bank_ifsc": v["bank_ifsc"],
            "bank_account": v["bank_account"],
            "invoice_no": f"INV-2026-MTH-{idx + 1:04d}",
            "po_number": f"PO-2026-MTH-{idx + 1:03d}",
            "invoice_date": inv_date.isoformat(),
            "service_period": inv_date.strftime("%Y-%m"),
            "hsn_code": v["hsn_code"],
            "quantity": qty,
            "unit_price": unit_price,
            "subtotal": subtotal,
            "tax_amount": tax_amount,
            "gross_total": gross_total,
            "ocr_confidence": round(rng.uniform(0.65, 0.77), 2),
            "is_anomaly": 1,
            "anomaly_typology": "TAX_MATH_MISMATCH",
        })

    # 9. UNIT_PRICE_DRIFT (100 rows)
    # unit_price inflated 28%–55% above the vendor's historical median unit price.
    for idx in range(100):
        v = vendors[idx % len(vendors)]
        inv_date = date(2026, 3, 1) + timedelta(days=idx % 25)
        drift_multiplier = rng.uniform(1.28, 1.55)
        inflated_unit_price = round(v["base_unit_price"] * drift_multiplier, 2)
        qty = max(4, int(52000.0 // inflated_unit_price) + 1 + (idx % 4))
        subtotal = round(qty * inflated_unit_price, 2)
        tax_amount = round(subtotal * 0.18, 2)
        gross_total = round(subtotal + tax_amount, 2)
        rows.append({
            "record_id": "",
            "vendor_id": v["vendor_id"],
            "vendor_name": v["vendor_name"],
            "gstin": v["gstin"],
            "bank_ifsc": v["bank_ifsc"],
            "bank_account": v["bank_account"],
            "invoice_no": f"INV-2026-DRF-{idx + 1:04d}",
            "po_number": f"PO-2026-DRF-{idx + 1:03d}",
            "invoice_date": inv_date.isoformat(),
            "service_period": inv_date.strftime("%Y-%m"),
            "hsn_code": v["hsn_code"],
            "quantity": qty,
            "unit_price": inflated_unit_price,
            "subtotal": subtotal,
            "tax_amount": tax_amount,
            "gross_total": gross_total,
            "ocr_confidence": round(rng.uniform(0.89, 0.99), 2),
            "is_anomaly": 1,
            "anomaly_typology": "UNIT_PRICE_DRIFT",
        })

    assert len(rows) == 10000, f"Expected 10,000 rows, got {len(rows)}"

    # Assign sequential record_id values (AP-2026-00001 .. AP-2026-10000)
    for idx, r in enumerate(rows):
        r["record_id"] = f"AP-2026-{idx + 1:05d}"

    if output_path is None:
        output_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "synthetic_ap_ledger.csv")

    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        writer.writeheader()
        writer.writerows(rows)

    print(f"[LedgerGuard] Generated {len(rows):,} AP ledger records across {len(vendors)} vendors -> {output_path}")
    return rows


if __name__ == "__main__":
    generate_synthetic_ledger()
