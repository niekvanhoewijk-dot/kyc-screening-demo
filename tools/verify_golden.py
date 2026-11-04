#!/usr/bin/env python3
"""Reference oracle for the screening rules.

Purpose: prove that config/*.yaml + the written rules reproduce every worked example in
the Ateaya requirements doc BEFORE any application code exists. The real implementation
(TypeScript) must produce identical results on tests/golden/*.json.
Do not extend this into the product; it is a spec check. Run: python3 tools/verify_golden.py

Phase 8 (docs/spec/08 section 6): the same rules, read through a policy version, plus the lifecycle
(POR, periodic review, threshold reached) over the synthetic book. `--derive-scenarios` prints
tests/golden/scenarios.json with every `expect` derived here. Use it only to pin a NEW scenario,
never to make a failing test pass.
"""
import calendar
import copy
import datetime as dt
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
FULL_V3 = {"call_for_action_treatment": "all_prohibited", "recently_delisted_treatment": "normal_with_note"}


def resolve_country(code, cl=None, settings=FULL_V3):
    """(tier, reason code). First match wins (spec 04 section 2, spec 08 section 3.3)."""
    cl = cl or countries
    entry = lambda key: next((c for c in cl.get(key) or [] if c["code"] == code), None)
    cfa = entry("fatf_call_for_action")
    if cfa:
        edd_only = cfa.get("action") == "edd"  # no action = countermeasures (O-52)
        tier = "auto_high" if edd_only and settings["call_for_action_treatment"] == "follow_fatf" else "prohibited"
        return tier, "RC_COUNTRY_CALL_FOR_ACTION_EDD" if edd_only else "RC_COUNTRY_CALL_FOR_ACTION_COUNTERMEASURES"
    if entry("fatf_increased_monitoring"):
        return "auto_high", "RC_COUNTRY_INCREASED_MONITORING"
    if entry("eu_sanctions_map"):
        return "auto_high", "RC_COUNTRY_EU_SANCTIONS_MAP"
    delisted = entry("recently_delisted")
    if delisted and settings["recently_delisted_treatment"] == "hold_auto_high":
        return "auto_high", "RC_COUNTRY_RECENTLY_DELISTED_HELD"
    if entry("demo_seed_low"):
        return "low", "RC_COUNTRY_DEMO_SEED_LOW"
    return cl["default_tier"], "RC_COUNTRY_RECENTLY_DELISTED" if delisted else "RC_COUNTRY_UNASSESSED"


def country_tier(code):
    return resolve_country(code)[0]


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


def score(inp, cl=None, settings=FULL_V3):
    if inp.get("us_tax_resident"):
        return {"decision": "reject", "reason": "us_tax_resident"}
    tier = inp.get("country_tier_override") or resolve_country(inp["country"], cl, settings)[0]
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


def threshold_binding(inp):
    """(threshold, binding limit). Limits in a fixed order; the first smallest one binds."""
    t = matrix["threshold"]
    dep = band_max("deposit_12m", inp["deposit_12m"])
    inc = band_max("annual_income", inp["annual_income"])
    pct = sof_pct(inp["source_of_funds"], inp.get("only_source_of_wealth", False))
    caps = [t["caps"]["standard"]]
    if inp["employment_status"] in t["restricted_employment"]:
        caps.append(t["caps"]["restricted_employment"])
    if inp["band"] in ("high", "auto_high"):
        caps.append(t["caps"]["high_or_auto_high_band"])
    limits = [] if dep is None else [("deposit_band", dep)]
    if inc is not None:
        limits.append(("sof_of_income", pct * inc))
    limits += [("category_cap", min(caps)), ("hard_ceiling", t["hard_ceiling_initial"])]
    binding = limits[0]
    for limit in limits[1:]:
        if limit[1] < binding[1]:
            binding = limit
    return math.floor(binding[1] + 1e-9), binding[0]


def threshold(inp):
    return {"threshold": threshold_binding(inp)[0]}


# ---------- EDD ----------
def edd(inp):
    amount = inp["documented_annual_amount"]
    dep = inp["deposited_to_date"]
    if amount is None:
        return {"outcome": "return_all_and_terminate", "amount_to_return": dep,
                "report_to": ["aml", "compliance"]}
    covered = math.floor(sof_pct(inp["source_of_funds"], inp.get("only_source_of_wealth", False)) * amount + 1e-9)
    if covered >= dep:  # O-12: equality = new threshold with zero headroom
        return {"outcome": "new_threshold", "new_threshold": covered, "headroom": covered - dep}
    return {"outcome": "return_excess_and_block", "excess_to_return": dep - covered,
            "report_to": ["aml", "compliance"]}


# ---------- Phase 8: policy versions (spec 08 section 3) ----------
portal = yaml.safe_load((ROOT / "config/portal.yaml").read_text())
policies_file = yaml.safe_load((ROOT / "config/policy/policies.yaml").read_text())


def load_policy(pid):
    p = next(x for x in policies_file["policies"] if x["id"] == pid)
    assert p["risk_matrix"] == "risk-matrix.yaml", "the oracle reads one risk matrix"
    return {"id": pid, "countries": yaml.safe_load((ROOT / "config" / p["country_list"]).read_text()),
            "settings": copy.deepcopy(p["settings"])}


def resolve_policy(spec):
    """"P2", or {"base": "P2", "settings": {...}} for a draft (top-level settings replaced)."""
    if isinstance(spec, str):
        return load_policy(spec)
    p = load_policy(spec["base"])
    p["id"] = f"{spec['base']}-draft"
    p["settings"] = {**p["settings"], **spec["settings"]}
    return p


def policy_in_force(day):
    ordered = sorted(policies_file["policies"], key=lambda p: p["effective_from"])
    current = [p for p in ordered if p["effective_from"] <= day]
    return load_policy((current[-1] if current else ordered[0])["id"])


# ---------- Phase 8: existing customers (spec 08 section 5.3) ----------
THRESHOLD_CODE = {"deposit_band": "RC_THRESHOLD_DEPOSIT_BAND", "sof_of_income": "RC_THRESHOLD_SOF_OF_INCOME",
                  "category_cap": "RC_THRESHOLD_CATEGORY_CAP", "hard_ceiling": "RC_THRESHOLD_HARD_CEILING"}


def evaluate_customer(c, policy):
    if c.get("us_tax_resident"):
        return {"total": None, "band": None, "edd_required": False, "threshold": None, "route": "reject",
                "reason_codes": ["RC_US_TAX_RESIDENT"]}
    inp = {**c["factor_answers"], "country": c["country"], "pep": c["pep"]}
    s = score(inp, policy["countries"], policy["settings"])
    band = s["band"]
    edd_required = band in ("high", "auto_high")
    codes = [resolve_country(c["country"], policy["countries"], policy["settings"])[1]]
    if s.get("forced_by") == "pep":
        codes.append("RC_PEP_FORCES_HIGH")
    if band == "prohibited":
        codes.append("RC_BAND_PROHIBITED")
    if edd_required:
        codes.append("RC_BAND_EDD_REQUIRED")
    value = None
    if band != "prohibited":
        value, binding = threshold_binding({**inp, "only_source_of_wealth": c.get("only_source_of_wealth", False), "band": band})
        codes.append(THRESHOLD_CODE[binding])
    route = "reject" if band == "prohibited" else "edd_required" if edd_required else "standard"
    return {"total": s["total"], "band": band, "edd_required": edd_required, "threshold": value, "route": route,
            "reason_codes": codes}


CHANGE_FIELDS = [("band", "band"), ("edd", "edd_required"), ("threshold", "threshold"), ("route", "route")]


def diff_under_policy(book, a, b):
    rows = []
    for c in book:
        before, after = evaluate_customer(c, a), evaluate_customer(c, b)
        changed = [name for name, key in CHANGE_FIELDS if before[key] != after[key]]
        review = bool(changed) and after["route"] == "reject"  # D13: never auto-reject an existing customer
        if review:
            after = {**after, "route": "analyst_review", "reason_codes": after["reason_codes"] + ["LC_POLICY_CHANGE_REVIEW"]}
        rows.append({"subject": c["id"], "before": before, "after": after, "changed": changed, "analyst_review": review})
    n = lambda pred: sum(1 for r in rows if pred(r))
    summary = {
        "customers": len(rows),
        "changed": n(lambda r: r["changed"]),
        "band_changed": n(lambda r: "band" in r["changed"]),
        "newly_edd": n(lambda r: not r["before"]["edd_required"] and r["after"]["edd_required"]),
        "no_longer_edd": n(lambda r: r["before"]["edd_required"] and not r["after"]["edd_required"]),
        "threshold_changed": n(lambda r: "threshold" in r["changed"]),
        "analyst_review": n(lambda r: r["analyst_review"]),
        "unchanged": n(lambda r: not r["changed"]),
    }
    return {"rows": rows, "summary": summary}


# ---------- Phase 8: lifecycle (spec 08 sections 2, 5.3, 5.4) ----------
LIFECYCLE = {"por_notice_days": portal["por"]["renewal_notice_days"],
             "por_validity_months": portal["por"]["default_validity_months"]}


def add_months(day, months):
    d = dt.date.fromisoformat(day)
    index = d.month - 1 + months
    y, m = d.year + index // 12, index % 12 + 1
    return dt.date(y, m, min(d.day, calendar.monthrange(y, m)[1])).isoformat()


def add_days(day, days):
    return (dt.date.fromisoformat(day) + dt.timedelta(days=days)).isoformat()


def obligation(c, kind, code, due_on, basis, flag, effect=None):
    return {"subject": c["id"], "kind": kind, "code": code, "due_on": due_on, "basis": basis, "flag": flag, "effect": effect}


def evaluate_lifecycle(c, policy, as_of):
    out = []
    expires = c.get("por_expires_at")
    if expires and as_of >= expires:
        out.append(obligation(c, "por_expired", "LC_POR_EXPIRED", expires, "full_v3_por", "in_force",
                              {"status": "expired_por", "blocks": ["deposits", "withdrawals"]}))
    elif expires and as_of >= add_days(expires, -LIFECYCLE["por_notice_days"]):
        out.append(obligation(c, "por_notice", "LC_POR_EXPIRY_NOTICE", expires, "full_v3_por", "in_force"))
    if c.get("threshold") is not None and c["deposited_to_date"] >= c["threshold"]:
        out.append(obligation(c, "threshold_reached", "LC_THRESHOLD_REACHED", None, "full_v3_edd", "in_force",
                              {"status": "edd_requested", "route": "edd"}))
    review = policy["settings"]["periodic_review"]
    if review["enabled"]:
        flag = "preview" if as_of < review["regulatory_effective_from"] else "in_force"
        edd_required = evaluate_customer(c, policy)["edd_required"]
        due = add_months(c["last_review_at"], review["interval_months"]["edd" if edd_required else "standard"])
        if as_of >= due:
            out.append(obligation(c, "review_due", "LC_REVIEW_DUE_EDD_ANNUAL" if edd_required else "LC_REVIEW_DUE_STANDARD_5Y",
                                  due, "amlr_26_2_a" if edd_required else "amlr_26_2_b", flag))
        event = c.get("event_review_at")
        if event and event > c["last_review_at"] and as_of >= event:
            out.append(obligation(c, "review_due", "LC_CIRCUMSTANCE_CHANGE", event, "amlr_26_3", flag))
    return out


def apply_event(c, event, policy):
    """Facts only. list_change is a simulator concern (a candidate policy), not a customer fact."""
    c = copy.deepcopy(c)
    kind = event["type"]
    if kind == "deposit":
        c["deposited_to_date"] += event["amount"]
    elif kind == "por_replaced":
        c["por_issued_at"] = event["issued_at"]
        c["por_expires_at"] = add_months(event["issued_at"], LIFECYCLE["por_validity_months"])
    elif kind == "circumstance_change":
        if event["field"] == "country":
            c["country"] = event["value"]
        else:
            c["factor_answers"][event["field"]] = event["value"]
        c["event_review_at"] = event["at"]
    elif kind == "pep_confirmed":
        c["pep"] = True
    elif kind == "edd_outcome":
        r = edd({"source_of_funds": c["factor_answers"]["source_of_funds"], "only_source_of_wealth": c.get("only_source_of_wealth", False),
                 "documented_annual_amount": event["documented_annual_amount"], "deposited_to_date": c["deposited_to_date"]})
        c["last_edd"] = r
        if r["outcome"] == "new_threshold":
            c["threshold"] = r["new_threshold"]
    else:
        raise ValueError(kind)
    return c


FACT_KEYS = ["country", "pep", "deposited_to_date", "threshold", "por_issued_at", "por_expires_at", "event_review_at", "last_edd"]


def run_scenario(inp):
    book = {c["id"]: c for c in json.loads((ROOT / inp["book"]).read_text())["customers"]}
    if inp["kind"] == "diff":
        return diff_under_policy(list(book.values()), resolve_policy(inp["baseline"]), resolve_policy(inp["candidate"]))
    subjects = list(book) if inp["subjects"] == "all" else inp["subjects"]
    as_of, steps = None, []
    for step in inp["steps"]:
        as_of = step.get("as_of", as_of)
        policy = policy_in_force(as_of) if inp["policy"] == "in_force" else resolve_policy(inp["policy"])
        if "event" in step:
            book[step["subject"]] = apply_event(book[step["subject"]], step["event"], policy)
        obligations = [o for s in subjects for o in evaluate_lifecycle(book[s], policy, as_of)
                       if "only" not in inp or o["kind"] in inp["only"]]
        out = {"as_of": as_of, "policy": policy["id"], "obligations": obligations}
        if inp.get("facts"):
            out["facts"] = {s: {k: book[s][k] for k in FACT_KEYS if k in book[s]} for s in subjects}
        steps.append(out)
    return {"steps": steps}


SCENARIOS = ROOT / "tests/golden/scenarios.json"
SUITES = [("risk-cases.json", score), ("threshold-cases.json", threshold), ("edd-cases.json", edd),
          ("scenarios.json", run_scenario)]


def derive_scenarios():
    data = json.loads(SCENARIOS.read_text())
    for case in data["cases"]:
        case["expect"] = run_scenario(case["input"])
    print(json.dumps(data, indent=2, ensure_ascii=False))


def main():
    if "--derive-scenarios" in sys.argv:
        return derive_scenarios()
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
