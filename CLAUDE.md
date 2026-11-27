# Loomis (formerly Second Read): rules for anyone (human or AI) working on this repo

Loomis is a private consistency checker for a Common App application, for counselors, educators
and parents, built for
#BuildHybridAI 2026 (deadline Nov 30, 2026, 2:00 PM Pacific). It flags problems with
exact quotes from both places. It NEVER writes, rewrites or suggests application text.

For history, decisions, setup and the day-by-day plan, read `private/HANDOFF.md` first. `private/` is kept off
GitHub on purpose (personal and security notes): never commit it, and never copy its contents into tracked files.

## Privacy rules
1. Application text goes to deterministic code and the on-device model (`InferenceMode.ONLY_ON_DEVICE`) by
   default. First exception, the picked cloud reading (the builder's decisions, Nov 24 and Nov 25): the start page's
   "How closely should it read?" picker starts on the private choice (Nano if present, else code checks only).
   Only when the user picks "Gemini in Google's cloud", with what it sends shown under the choices, does the app
   build a cloud model: `createConsentedHybridModels` (`PREFER_ON_DEVICE`) with no Nano, or
   `createChosenCloudModels` (`ONLY_IN_CLOUD`, no Search) with Nano. Second exception, the closer read (the builder's decision, Nov 24): on a laptop WITH Gemini Nano, after Nano's
   reading, the results page offers "Read it closer". Only after that click does `createCloserReadModel` build an
   `ONLY_IN_CLOUD` model (no Google Search) for one whole-application read. Every prompt goes in the sent log first.
   `PREFER_IN_CLOUD` is never used. `test/guards.test.js` enforces this.
2. Google Search grounding gets only public names (organizations, programs, colleges), never application text
   (`ONLY_IN_CLOUD` + Google Search). Every string sent is recorded in the sent log first.
3. No on-device model: ask first (src/core/consent.js). "No" means code checks only. Never fall back to the
   cloud without that explicit yes.
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

The scored test sets in `eval/` are fictional too. Rules for whoever tunes the checks:
- `eval/final-*`: the final test. Never open, read or print these files, and never tune on them. Run them once,
  after the feature freeze, and report totals only.
- `eval/heldout`: unseen so far. Totals and labels only.
- `eval/practice-*` and `eval/fresh`: practice sets. Tuning on them and reading their false alarms is fine.
- PDFs in `eval/` are rebuilt from the JSON by `node eval/score.mjs <set>` and aren't tracked by git.

## Scope
One-project rule until Nov 30. New ideas go in the builder's Parked ideas list, not in code.
