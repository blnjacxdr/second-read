# Second Read: rules for anyone (human or AI) working on this repo

Second Read is a private consistency checker for a Common App application, built for
#BuildHybridAI 2026 (deadline Nov 30, 2026, 2:00 PM Pacific). It flags problems with
exact quotes from both places. It NEVER writes, rewrites or suggests application text.

For history, decisions, setup and the day-by-day plan, read `docs/HANDOFF.md` first.

## Privacy rules (non-negotiable)
1. Application text goes only to deterministic code and the on-device model
   (`InferenceMode.ONLY_ON_DEVICE`). Never `PREFER_ON_DEVICE` or `PREFER_IN_CLOUD`: both
   can silently send the prompt to the cloud. `test/guards.test.js` enforces this.
2. Only public names (organizations, programs, colleges) go to the cloud model
   (`ONLY_IN_CLOUD` + Google Search). Every string sent is recorded in the sent log first.
3. No on-device model: run the code checks only and say so. Never fall back to the cloud.
4. Firebase AI monitoring stays OFF.
5. Grounded answers must show `searchEntryPoint.renderedContent` and the sources
   (`groundingChunks`). Google requires both.
6. The App Check debug token is set only in `dev/`. Never in `src/`, never deployed.

## Quotes
Every AI flag quotes both places word for word and is checked with `verifyQuote`
(src/core/quotes.js, adapted from Hashmark's verifyCitation). A flag that fails is
dropped, not shown. Never loosen this to make a flag appear.

## Code style
- Pure functions for logic in `src/core/` (no DOM, no Firebase), tested with `node --test`.
- Firebase is imported only in `src/ai.js`. UI code only calls into `src/ai.js` and `src/core/`.
- Plain JavaScript ES modules, no framework, no bundler. Firebase SDK from the gstatic CDN, version pinned.
- Clear names and short comments that say why. A future developer should be able to take over.
- Run `npm test` before saying anything is done. Zero failing tests.

## Test data
Only the fictional applicant in `sample/`. Never commit a real person's application.
`sample/expected-flags.json` is the answer key; keep it in sync with `sample/application.json`.

## Scope
One-project rule until Nov 30. New ideas go in the builder's Parked ideas list, not in code.
