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
Nov 20: on-device and cloud prompts working (`dev/spike.html`).
Nov 21: reads real Common App preview PDFs for any college, and runs the code-only checks (`dev/pdf.html`).

## Layout

| Path | What it is |
| --- | --- |
| `src/core/` | Pure logic, no DOM, no Firebase. Tested. |
| `src/core/quotes.js` | `verifyQuote` / `locateQuote`: every quote must appear word for word in its section; flags show the student's own text. |
| `src/core/pdf-lines.js` | Turns pdf.js text pieces into rows of cells with position and boldness; drops page chrome. |
| `src/core/common-app.js` | Reads any college's Common App preview PDF by its template formatting: activities, honors, essays, college questions. |
| `src/core/checks.js` | Code-only checks: another college's name, mismatched start years, repeated passages, limits. |
| `src/core/ai-checks.js` | What Gemini Nano compares, the false-alarm guard per kind, and ordering other-college mentions. |
| `src/core/colleges.js` | College names and safe short names for the other-college check. |
| `src/core/sections.js` | Turns an application into `{ sectionId: text }`, plus Common App limits. |
| `src/core/privacy.js` | `assertOnDevice` and the on-device status messages. |
| `src/core/prompts.js` | Prompt text and the on-device JSON schema. |
| `src/core/grounding.js` | Reads search suggestions and sources from a grounded answer. |
| `src/core/sent-log.js` | The "What we sent to the cloud" record. |
| `src/ai.js` | The only file that uses Firebase. Creates the on-device and cloud models. |
| `src/pdf.js` | Reads a PDF in the browser with the vendored pdf.js. Nothing is uploaded. |
| `src/firebase-config.js` | Your Firebase web config and reCAPTCHA site key. |
| `dev/pdf.html` | Development page: pick a preview PDF and see what was read. |
| `dev/spike.html` | Development page. Turns on the App Check debug token; never deploy it. |
| `vendor/pdfjs/` | Mozilla pdf.js 6.5.438 (Apache-2.0), kept in the repo instead of a CDN. |
| `test/fixtures/` | Text pdf.js read from the sample PDFs, so PDF tests run without a browser. |
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
