# 05 — Enhanced Due Diligence (EDD)

Source: Full v3 sections 5-6.

## Triggers
1. Overall band High or Auto-High (doc section 5), or
2. The client **reaches or exceeds** the deposit threshold (doc section 6).
Decision node outcome: "Have further questions" -> EDD (D8).

## What the client is asked for
1. **Proof of Source of Funds** for the funds already deposited, with supporting documents where applicable (e.g. tax report, payslips, sale contract).
2. **Extra KYC**: an additional proof of ID or a photo of the person holding their ID/passport next to their face. Not needed again if the automated KYC already captured such a photo at the start (the demo's mandatory selfie, D5, covers this: show "already satisfied").

## Recalculation
`covered = floor(sof_percent(source_of_funds) * documented_annual_amount)`
- **covered > deposited_to_date** -> `new_threshold = covered`, `headroom = covered - deposited_to_date`. Transactions are monitored until the new threshold is reached, then EDD repeats.
  *Doc example: tax report shows $200k salary, 80% = $160,000; $100k already deposited -> client may deposit another $60k.*
- **covered <= deposited_to_date** (SoF does not cover what was deposited, client cannot provide more) -> the **excess** (`deposited - covered`) is **returned**, no further deposits allowed, report to AML and Compliance.
- **No SoF provided** (unable or unwilling) -> **all funds returned**, business relationship terminated, report to AML and Compliance.
AML and Compliance decide whether the case goes higher. Equality (`covered == deposited`) is not defined in the doc: demo treats it as new threshold = deposited, headroom 0.

## Notes
- The $100k hard ceiling (D2) applies to the **initial** threshold only; EDD can raise it.
- Guiding principle from the doc: all actions keep in mind the security of the company, protection of its reputation and the security of investors.
- The demo does not move money. "Return funds" is represented as an analyst-recorded instruction in the audit trail.
