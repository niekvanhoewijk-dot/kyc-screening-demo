# src/adapters

Vendor-style interfaces with mock implementations (no real vendors integrated). Swapping an implementation must not touch scoring.

| Interface | File | Mock | Status |
|---|---|---|---|
| `Mailer` | `mailer.ts` | `ConsoleMailer` prints OTP mails to the server console | Phase 2 |
| `FaceMatchProvider` | `face-match.ts` | Passes unless the selfie file name contains `spoof` / `mismatch` | Phase 2 |
| `FileStore` | `file-store.ts` | `LocalFileStore` under `data/uploads` | Phase 2 |
| `CountryRiskProvider` | `src/engine/country.ts` (`CountryRiskLookup`) | Config-backed resolver | Phase 1 |
| `ScreeningProvider` | `screening.ts` | Fictional watchlist (`fixtures/screening/watchlist.yaml`), fuzzy name + DOB + country | Phase 4 |
| `IDVProvider` | — | — | later |
| `DocumentReader` | `src/documents/reader.ts` | `ClaudeDocumentReader` (structured outputs, retry once, replay cache) | Phase 3 |
| `WalletVerifier` | `src/wallet/verifier.ts` | `SdJwtWalletVerifier` checks an SD-JWT VC presentation with `node:crypto`; a built-in test wallet and demo issuer (`src/wallet/test-wallet.ts`) stand in for a real EU Digital Identity wallet. Test mode only | Phase 9 |
