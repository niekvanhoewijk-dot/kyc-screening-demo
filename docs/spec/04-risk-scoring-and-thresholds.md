# 04 — Risk scoring and thresholds

Numbers live in `config/risk-matrix.yaml` and `config/country-risk.yaml`. This file is the algorithm. The reference oracle `tools/verify_golden.py` implements exactly this and passes all golden cases.

## 1. Total score
`total = country_points + deposit_12m + source_of_funds + employment_status + occupation_industry + annual_income + net_worth`
Points per tier: low 1, medium 2, high 3, auto_high 30, prohibited 100. Minimum possible total is 7.

## 2. Country resolution (first match wins)
1. FATF call-for-action list -> **prohibited** (100). Client not accepted.
2. FATF increased-monitoring list -> **auto_high** (30). Accepted, automatically High-Risk.
3. EU sanctions map -> **auto_high** (30). *(list still to be loaded)*
4. Demo seed "low" list -> low (1). *(placeholder, not a real assessment)*
5. Otherwise `default_tier` = medium (2), shown as "unassessed" to the analyst.
Test fixtures may bypass this with `country_tier_override`.

## 3. Band
Low 1-9, Medium 10-15, **High 16-29** (D1), Auto-High 30-99, Prohibited 100+.

## 4. Hard rules
- US tax resident = yes -> reject.
- PEP = yes -> band at least High (D9).
- Prohibited -> reject (no-go message D7).
- High or Auto-High -> EDD required.

## 5. Initial deposit threshold
```
initial_threshold = floor(min(
    deposit_band.max,                 // null = no limit
    sof_percent * income_band.max,    // null = no limit
    min(applicable caps),
    100000                            // D2 hard ceiling, initial only
))
```
Applicable caps: $10,000 if employment is student / unemployed / other; $40,000 if band is High or Auto-High; $100,000 otherwise (low/medium band and employed / self-employed / retired). Take the **minimum** of all that apply.
`sof_percent`: salary 80%; savings 80%; investment 100% (80% if it is the only source of wealth); inheritance 100% (80% if only source of wealth); pension and other **80% (assumption)**.

**Status:** formula inferred from the doc's three examples (39,999 / 19,999 / 100,000), all reproduced. Only the $100k ceiling is confirmed. Open points in 07.

## 6. Worked results (all pass)
| Case | Result |
|---|---|
| UK, savings, self-employed, financial services, high income and net worth | 15 Medium |
| "Albania" fixture (auto-high country), all else low | 36 Auto-High |
| Greece, IT | 8 Low |
| Iran | 107 Prohibited |
| Salary, employed, income < $50k, deposit $20-50k | threshold $39,999 |
| Same, deposit < $20k | $19,999 |
| Self-employed, investment, deposit > $1M | $100,000 |
