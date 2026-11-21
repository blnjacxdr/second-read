# Second Read

A private consistency checker for a Common App application. It finds contradictions
between sections (hours, roles, dates, awards), another college's name inside a
supplement, repeated passages and over-limit drafts, and shows the exact quotes from
both places. It never writes or rewrites your text.

Your application text never leaves your computer: it is checked by plain code and by
Gemini Nano running inside Chrome. Only public names (clubs, programs, colleges) are sent
to a cloud model with Google Search, to check they exist and are named correctly, and the
app lists every string it sent.

Built for #BuildHybridAI 2026 with Firebase AI Logic.

## Status
Nov 20 spike: one on-device prompt and one grounded cloud prompt (`dev/spike.html`).

## Layout

| Path | What it is |
| --- | --- |
| `src/core/` | Pure logic, no DOM, no Firebase. Tested. |
| `src/core/quotes.js` | `verifyQuote`: every quote must appear word for word in its section (adapted from Hashmark). |
| `src/core/sections.js` | Turns an application into `{ sectionId: text }`, plus Common App limits. |
| `src/core/privacy.js` | `assertOnDevice` and the on-device status messages. |
| `src/core/prompts.js` | Prompt text and the on-device JSON schema. |
| `src/core/grounding.js` | Reads search suggestions and sources from a grounded answer. |
| `src/core/sent-log.js` | The "What we sent to the cloud" record. |
| `src/ai.js` | The only file that uses Firebase. Creates the on-device and cloud models. |
| `src/firebase-config.js` | Your Firebase web config and reCAPTCHA site key. |
| `dev/spike.html` | Development page. Turns on the App Check debug token; never deploy it. |
| `sample/` | A fictional applicant: JSON source, one PDF per college (shared Common App sections + that college's supplement), paste-in drafts, and the answer key. |
| `tools/serve.js` | Tiny local dev server (Node built-ins only). |
| `tools/make-sample-pdf.js` | Rebuilds the per-college sample PDFs from the JSON. |
| `test/` | `node --test` suites, including privacy guards that scan the source. |

## Commands

```bash
npm install          # once (only needed for the sample PDF tool)
npm test             # all tests
npm run dev          # serves the repo at http://localhost:8080 (tools/serve.js, no downloads)
npm run sample:pdf   # rebuilds sample/application-<college>.pdf
```

Open `http://localhost:8080/dev/spike.html` in desktop Chrome.

## Requirements for the on-device model
Desktop Chrome 139 or newer with `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input`
enabled, at least 22 GB free disk, and either a GPU with more than 4 GB of VRAM or 16 GB of
RAM with 4+ CPU cores. Check the model at `chrome://on-device-internals`.

## License
MIT. See LICENSE.
