# src/adapters

Vendor-style interfaces with mock implementations (no real vendors integrated):
- `CountryRiskProvider` — country tier with `source`, `as_of`, `list_version`
- `ScreeningProvider` — sanctions / PEP / watchlist hits (mock)
- `FaceMatchProvider` — selfie + liveness, external supplier (mock)
- `IDVProvider` — identity document verification (mock)
- `DocumentReader` — POI/POR reading; Claude is one implementation (Phase 3)

Swapping an implementation must not touch scoring.
