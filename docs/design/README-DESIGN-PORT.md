# Phase 7: port the Ateaya-look design into the app

Source of truth: the `*.dc.html` files in this folder (exported from the Claude Design file). Each is a 1280px-wide board.
Open them as text and read the inline styles; they are plain HTML/CSS plus `{{holes}}` for data.

## Rules
- Change presentation only. Do NOT change src/engine, src/documents, src/kyb, server actions, DB schema, config/*.yaml or tests/golden.
- Keep every existing form field, name, server action and validation message. Keep all accessible labels.
- Generic name only: "Demo Digital Assets Platform". No logos, no Ateaya or Polis X names.
- Synthetic data only. Keep the demo footer line.
- Risk bands are monochrome, always with a text label: Low = white with 1px black border; Medium = #E5E5E5; High = #595959 white text; Auto-High = #0A0A0A white text; Prohibited = black with diagonal stripe (repeating-linear-gradient 135deg #0A0A0A / #3A3A3A, 6px).
- No accent colours. Remove the blue accent and dark-mode palette from globals.css (the design is light only).

## Tokens
ink #0A0A0A, graphite #262626, mid-grey text #595959, hairline #D4D4D4, surface #F5F5F5, white #FFFFFF, input border #6B6B6B, on-dark greys #A3A3A3 / #BDBDBD.
Font: Alexandria (weights 300-700), load with next/font/google. Radius 2px everywhere. Buttons 52px high, black, white text, 15px/600, arrow icon. Inputs 52px, 1px #6B6B6B border.
Eyebrow labels: 12px, 500, letter-spacing .14em, uppercase, #595959. H1 36px/700.

## Screen map (route -> board)
| Route | Board |
|---|---|
| /apply | Main.dc.html (2.1.1 Create account) |
| /apply/verify | A02-Verify-Email |
| /apply/overview | A03-Overview |
| /apply/identity | A04-Proof-Of-Identity |
| /apply/residence | A05-Proof-Of-Residence |
| /apply/questionnaire | A06-Questionnaire |
| /apply/status (pending) | A07-Check |
| /apply/status (EDD requested) | A08-EDD-Request |
| /apply/status (approved) | A09-Confirmation |
| /apply/status (rejected) | A10-Not-Approved (exact D7 text) |
| /analyst | C01-Analyst-Queue |
| /analyst/cases/[id] (individual) | C02-Analyst-Case |
| /analyst/cases/[id] (company) | C03-Analyst-Company |
| /analyst/demo, other analyst pages | AnalystNav.dc.html frame, simple content |

Shared: LeftPanel.dc.html = black 440px panel with 8-step vertical stepper and grayscale dune SVG (applicant pages). AnalystNav.dc.html = black 260px nav (analyst pages).
Build these as React components (src/components/LeftPanel.tsx, AnalystNav.tsx) and use route-group layouts: applicant pages get LeftPanel + content column; analyst pages get AnalystNav + content. The root layout must stop rendering the old header/footer around them (move the demo footer line into the panels as in the boards).

## Data notes
The boards show sample values. Wire the real data: score breakdown, threshold limits (binding limit tagged), Claude pre-review checks and memo (MVP 2 only; hidden when mode is MVP 1), audit trail, document checklist. Where the app lacks a field the board shows, omit it rather than inventing data.
The applicant never sees risk reasons, PEP flags or band (D7, no tipping off).

## Done when
1. `npm run typecheck`, `npm run build`, `npm test` pass and tools/verify_golden.py still passes.
2. `npm run demo`, then walk /apply as Ada, Petros and the company, and /analyst for Tom and Sample Holdings. Compare each screen with its board at 1280px and at about 390px width (stack, no horizontal scroll).
3. Update docs/DEMO-SCRIPT.md if any click path changed. Commit as "Phase 7: Ateaya-look design port".
