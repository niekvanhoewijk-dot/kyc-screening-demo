# src/adapters

Vendor-style interfaces with mock implementations (no real vendors integrated). Swapping an implementation must not touch scoring.

| Interface | File | Mock | Status |
|---|---|---|---|
| `Mailer` | `mailer.ts` | `ConsoleMailer` prints OTP mails to the server console | Phase 2 |
| `FaceMatchProvider` | `face-match.ts` | Passes unless the selfie file name contains `spoof` / `mismatch` | Phase 2 |
| `FileStore` | `file-store.ts` | `LocalFileStore` under `data/uploads` | Phase 2 |
| `CountryRiskProvider` | `src/engine/country.ts` (`CountryRiskLookup`) | Config-backed resolver | Phase 1 |
| `ScreeningProvider` | — | Seeded fictional watchlist | Phase 4 |
| `IDVProvider` | — | — | later |
| `DocumentReader` | — | Claude implementation | Phase 3 |
