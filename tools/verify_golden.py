#!/usr/bin/env python3
"""Reference oracle for the screening rules.

Purpose: prove that config/*.yaml + the written rules reproduce every worked example in
the Ateaya requirements doc BEFORE any application code exists. The real implementation
(TypeScript) must produce identical results on tests/golden/*.json.
Do not extend this into the product; it is a spec check. Run: python3 tools/verify_golden.py
"""
import json
import math
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
matrix = yaml.safe_load((ROOT / "config/risk-matrix.yaml").read_text())
countries = yaml.safe_load((ROOT / "config/country-risk.yaml").read_text())

POINTS = matrix["points"]
TIER_ORDER = ["low", "medium", "high", "auto_high", "prohibited"]


# ---------- country ----------
def country_tier(code):
    codes = lambda key: {c["code"] for c in countries.get(key, [])}
    if code in codes("fatf_call_for_action"):
        return "prohibited"
    if code in codes("fatf_increased_monitoring") or code in codes("eu_sanctions_map"):
        return "auto_high"
    if code in codes("demo_seed_low"):
        return "low"
    return countries["default_tier"]


# ---------- scoring ----------
def lookup_tier(factor, answer):
    spec = matrix["factors"][factor]
    if isinstance(spec, dict):  # occupation_industry
        for v in spec["values"]:
            if v["id"] == answer:
                return v["tier"]
        return spec["default_tier"]
    for v in spec:
        if v["id"] == answer:
            return v["tier"]
    raise KeyError(f"{factor}={answer}")


def band_for(total):
    for b in matrix["bands"]:
        if total >= b["min"] and (b["max"] is None or total <= b["max"]):
            return b["id"]
    raise ValueError(total)


def score(inp):
    if inp.get("us_tax_resident"):
        return {"decision": "reject", "reason": "us_tax_resident"}
    tier = inp.get("country_tier_override") or country_tier(inp["country"])
    total = POINTS[tier]
    for f in ["deposit_12m", "source_of_funds", "employment_status",
              "occupation_industry", "annual_income", "net_worth"]:
        total += POINTS[lookup_tier(f, inp[f])]
    band = band_for(total)
    out = {"total": total, "band": band}
    if inp.get("pep") and TIER_ORDER.index(band) < TIER_ORDER.index("high"):
        out.update(band="high", forced_by="pep")
    return out


# ---------- threshold ----------
def band_max(factor, band_id):
    for v in matrix["factors"][factor]:
        if v["id"] == band_id:
            return v["max"]
    raise KeyError(band_id)


def sof_pct(sof, only):
    p = matrix["threshold"]["sof_percent"]
    if sof in ("investment", "inheritance"):
        return p[f"{sof}_only_wealth" if only else f"{sof}_not_only_wealth"]
    return p[sof]


def threshold(inp):
    t = matrix["threshold"]
    inf = math.inf
    dep = band_max("deposit_12m", inp["deposit_12m"])
    inc = band_max("annual_income", inp["annual_income"])
    pct = sof_pct(inp["source_of_funds"], inp.get("only_source_of_wealth", False))
    caps = [t["caps"]["standard"]]
    if inp["employment_status"] in t["restricted_employment"]:
        caps.append(t["caps"]["restricted_employment"])
    if inp["band"] in ("high", "auto_high"):
        caps.append(t["caps"]["high_or_auto_high_band"])
    value = min(
        inf if dep is None else dep,
        inf if inc is None else pct * inc,
        min(caps),
        t["hard_ceiling_initial"],
    )
    return {"threshold": math.floor(value + 1e-9)}


# ---------- EDD ----------
def edd(inp):
    amount = inp["documented_annual_amount"]
    dep = inp["deposited_to_date"]
    if amount is None:
        return {"outcome": "return_all_and_terminate", "amount_to_return": dep,
                "report_to": ["aml", "compliance"]}
    covered = math.floor(sof_pct(inp["source_of_funds"], False) * amount + 1e-9)
    if covered > dep:
        return {"outcome": "new_threshold", "new_threshold": covered, "headroom": covered - dep}
    return {"outcome": "return_excess_and_block", "excess_to_return": dep - covered,
            "report_to": ["aml", "compliance"]}


SUITES = [("risk-cases.json", score), ("threshold-cases.json", threshold), ("edd-cases.json", edd)]


def main():
    failures = 0
    for fname, fn in SUITES:
        for case in json.loads((ROOT / "tests/golden" / fname).read_text())["cases"]:
            got = fn(case["input"])
            ok = all(got.get(k) == v for k, v in case["expect"].items())
            failures += not ok
            print(f"{'PASS' if ok else 'FAIL'}  {case['id']:<40} {case['source'][:38]}")
            if not ok:
                print(f"      expected {case['expect']}\n      got      {got}")
    print(f"\n{'ALL GOLDEN CASES PASS' if not failures else str(failures) + ' FAILED'}")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
