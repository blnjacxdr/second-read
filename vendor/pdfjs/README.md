# pdf.js (vendored)

Mozilla pdf.js **6.5.438**, from the `pdfjs-dist` npm package (`build/pdf.min.mjs` and
`build/pdf.worker.min.mjs`). Apache License 2.0, see `LICENSE`.

Kept in the repo instead of loaded from a CDN so reading a user's PDF never depends on a
third-party website, and the app makes no requests besides its own files and Google's.
To update: `npm pack pdfjs-dist@<version>`, copy the same two files, and update this note.
