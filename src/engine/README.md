# src/engine

The deterministic rules engine lands here in Phase 1: config loader (Zod-validated), country resolver, scoring, threshold, EDD.
It reads every number from `config/*.yaml` and must match `tools/verify_golden.py` on `tests/golden/*.json`. No numeric constants in this folder.
