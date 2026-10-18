# src/engine

Deterministic rules engine (Phase 1). Pure functions; every number comes from `config/*.yaml`, validated by Zod at load time.

| File | What |
|---|---|
| `config.ts` | `loadEngineConfig()`: parses and validates both YAML files (tiers have points, bands contiguous, no country on two lists, `as_of`/`list_version` present) |
| `country.ts` | `resolveCountry()`: first-match resolution (spec 04 §2) with `source`, `as_of`, `list_version`, `unassessed` |
| `factors.ts` | Answer → tier lookups, band maxima, SoF percentage |
| `scoring.ts` | `scoreApplicant()`: total, band, per-factor breakdown, hard rules (US tax resident, PEP, prohibited), `edd_required` |
| `threshold.ts` | `initialThreshold()`: min of limits (spec 04 §5) with the binding limit named |
| `edd.ts` | `recalculateEdd()` (spec 05) and `depositTriggersEdd()` |
| `money.ts` | Whole-dollar flooring with a float-precision tolerance |

Contract: `tests/golden/engine.test.ts` must match `tools/verify_golden.py`. `tests/engine/no-numbers.test.ts` fails on numeric literals other than 0/1 in this folder.
